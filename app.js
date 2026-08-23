/* ============================================================
   DarkPDF — an eye-friendly dark-mode PDF reader.
   Built on PDF.js. Pages are rendered in original colors to
   canvas; a CSS filter chain on the canvas holder produces the
   dark theme, so text selection, search and image passthrough
   all keep working on the untouched bitmap underneath.
   ============================================================ */
"use strict";

const pdfjsLib = window.pdfjsLib || window["pdfjs-dist/build/pdf"];

/* Worker: standalone build embeds the worker as base64 → Blob URL.
   Dev build loads it from libs/. */
if (window.__PDFJS_WORKER_B64__) {
  const bin = atob(window.__PDFJS_WORKER_B64__);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
  window.__PDFJS_WORKER_B64__ = null;
} else {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "libs/pdf.worker.min.js";
}

const CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";

/* ---------- themes (CSS filter chains applied to page canvases) ----------
   Rationale: invert < 100% keeps the background at a dark gray rather than
   pure black and caps text luminance below pure white (halation guard for
   astigmatism); hue-rotate(180deg) restores original hues after inversion;
   sepia warms the light text, cutting the blue component. */
const THEMES = {
  warm:  "invert(0.90) hue-rotate(180deg) sepia(0.22)",
  gray:  "invert(0.90) hue-rotate(180deg)",
  night: "invert(0.96) hue-rotate(180deg) brightness(0.92)",
  paper: null,
};

const PAGE_GAP = 14;          // must match #viewer gap in CSS
const MAX_CANVAS_PIXELS = 2 ** 24;
const THUMB_WIDTH = 128;

const $ = (id) => document.getElementById(id);
const els = {
  toolbar: $("toolbar"), sidebar: $("sidebar"), thumbs: $("thumbs"),
  viewerWrap: $("viewerWrap"), viewer: $("viewer"), welcome: $("welcome"),
  fileInput: $("fileInput"), fileName: $("fileName"),
  pageInput: $("pageInput"), pageCount: $("pageCount"),
  zoomLevel: $("zoomLevel"),
  searchInput: $("searchInput"), searchCount: $("searchCount"),
  themeSelect: $("themeSelect"), brightSlider: $("brightSlider"),
  imgToggle: $("imgToggle"), refToggle: $("refToggle"),
  progressBar: $("progressBar"), progressFill: $("progressFill"),
  dropOverlay: $("dropOverlay"), toast: $("toast"),
};

const state = {
  pdf: null,
  loadingTask: null,
  fileKey: "",
  numPages: 0,
  pages: [],            // 1-based; see makePageEntry()
  scale: 1,
  zoomMode: "fit-width",// 'fit-width' | 'fit-page' | 'custom'
  rotation: 0,          // extra user rotation, multiples of 90
  currentPage: 1,
  theme: "warm",
  brightness: 1,
  preserveImages: true,
  search: { query: "", matches: [], index: -1, indexing: false },
  refs: { on: true, indexing: false, indexed: false, count: 0 },
  docSeq: 0,            // bumped per document; async guards
};

/* ================= settings persistence ================= */

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("darkpdf.settings") || "{}");
    if (THEMES.hasOwnProperty(s.theme)) state.theme = s.theme;
    if (s.brightness >= 0.7 && s.brightness <= 1.15) state.brightness = s.brightness;
    if (typeof s.preserveImages === "boolean") state.preserveImages = s.preserveImages;
    if (typeof s.verseRefs === "boolean") state.refs.on = s.verseRefs;
    if (s.sidebar) els.sidebar.classList.add("open");
    if (s.zoomMode === "fit-page") state.zoomMode = "fit-page";
  } catch (e) { /* fresh start */ }
  els.themeSelect.value = state.theme;
  els.brightSlider.value = Math.round(state.brightness * 100);
  els.imgToggle.checked = state.preserveImages;
  els.refToggle.checked = state.refs.on;
}

function saveSettings() {
  try {
    localStorage.setItem("darkpdf.settings", JSON.stringify({
      theme: state.theme,
      brightness: state.brightness,
      preserveImages: state.preserveImages,
      verseRefs: state.refs.on,
      sidebar: els.sidebar.classList.contains("open"),
      zoomMode: state.zoomMode === "fit-page" ? "fit-page" : "fit-width",
    }));
  } catch (e) { /* private mode etc. */ }
}

function rememberPosition() {
  if (!state.pdf || !state.fileKey) return;
  try { localStorage.setItem("darkpdf.pos." + state.fileKey, String(state.currentPage)); }
  catch (e) {}
}

function recallPosition() {
  try { return parseInt(localStorage.getItem("darkpdf.pos." + state.fileKey), 10) || 0; }
  catch (e) { return 0; }
}

/* ================= theme ================= */

function applyTheme() {
  const base = THEMES[state.theme];
  let filter = "none";
  if (base) {
    filter = base;
    if (Math.abs(state.brightness - 1) > 0.005) filter += ` brightness(${state.brightness})`;
  } else if (Math.abs(state.brightness - 1) > 0.005) {
    filter = `brightness(${state.brightness})`;
  }
  document.documentElement.style.setProperty("--page-filter", filter);
}

/* ================= toast ================= */

let toastTimer = 0;
function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("on"), ms);
}

/* ================= document open ================= */

async function openFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    toast("That doesn't look like a PDF.");
    return;
  }
  const buf = await file.arrayBuffer();
  await openDocument(new Uint8Array(buf), file.name, `${file.name}|${file.size}`);
}

async function openUrl(url) {
  try {
    setProgress(0.1);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const name = decodeURIComponent(url.split("/").pop().split("?")[0]) || "document.pdf";
    await openDocument(new Uint8Array(buf), name, `${name}|${buf.byteLength}`);
  } catch (err) {
    setProgress(-1);
    toast("Couldn't load PDF from URL: " + err.message);
  }
}

function setProgress(frac) {
  if (frac < 0 || frac >= 1) {
    els.progressFill.style.width = frac >= 1 ? "100%" : "0";
    setTimeout(() => {
      els.progressBar.classList.remove("on");
      els.progressFill.style.width = "0";
    }, 250);
  } else {
    els.progressBar.classList.add("on");
    els.progressFill.style.width = Math.round(frac * 100) + "%";
  }
}

async function openDocument(data, name, fileKey) {
  const seq = ++state.docSeq;

  // tear down previous document
  if (state.loadingTask) { try { state.loadingTask.destroy(); } catch (e) {} }
  for (const p of state.pages) if (p) releasePage(p, true);
  state.pages = [];
  els.viewer.innerHTML = "";
  els.thumbs.innerHTML = "";
  clearSearch(true);
  hidePop(true);
  state.refs.indexed = false;
  state.refs.indexing = false;
  state.refs.count = 0;

  const loadingTask = pdfjsLib.getDocument({
    data,
    cMapUrl: CDN + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: CDN + "standard_fonts/",
  });
  state.loadingTask = loadingTask;

  loadingTask.onProgress = ({ loaded, total }) => {
    if (total) setProgress(Math.min(0.95, loaded / total));
  };
  loadingTask.onPassword = (updatePassword, reason) => {
    const msg = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD
      ? "Wrong password — try again:" : "This PDF is password-protected.\nPassword:";
    const pw = prompt(msg);
    if (pw === null) { loadingTask.destroy(); setProgress(-1); }
    else updatePassword(pw);
  };

  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    setProgress(-1);
    if (!/destroyed|aborted/i.test(String(err && err.message))) {
      toast("Couldn't open PDF: " + (err.message || err));
    }
    return;
  }
  if (seq !== state.docSeq) { pdf.destroy(); return; }

  state.pdf = pdf;
  state.numPages = pdf.numPages;
  state.fileKey = fileKey || name;
  state.rotation = 0;
  state.currentPage = 1;

  els.fileName.textContent = name;
  els.fileName.title = name;
  els.pageCount.textContent = "/ " + pdf.numPages;
  els.pageInput.value = "1";
  document.title = name + " — DarkPDF";
  els.welcome.classList.add("hidden");

  // First page defines placeholder geometry until real sizes stream in.
  const first = await pdf.getPage(1);
  if (seq !== state.docSeq) return;
  const fv = first.getViewport({ scale: 1 });

  for (let i = 1; i <= pdf.numPages; i++) {
    state.pages[i] = makePageEntry(i, fv.width, fv.height);
    if (i === 1) { state.pages[1].pdfPage = first; state.pages[1].baseW = fv.width; state.pages[1].baseH = fv.height; }
  }

  computeFitScale();
  buildPageShells();
  buildThumbShells();
  setProgress(1);

  // Stream in true page sizes (they may differ per page).
  fetchPageGeometry(seq);

  const back = recallPosition();
  if (back > 1 && back <= state.numPages) {
    scrollToPage(back);
    toast(`Resumed at page ${back}`, 1800);
  }

  // Reference indexing reads every page's text, so let the visible pages
  // render first rather than competing with them.
  if (state.refs.on) {
    const start = () => { if (seq === state.docSeq) buildRefIndex(); };
    if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 1200 });
    else setTimeout(start, 400);
  }
}

function makePageEntry(num, w, h) {
  return {
    num, pdfPage: null,
    baseW: w, baseH: h,        // viewport at scale 1, page's own rotation
    wrapper: null, holder: null, canvas: null,
    textLayerDiv: null, overlayDiv: null,
    thumbEl: null, thumbCanvas: null, thumbRendered: false,
    rendered: false, rendering: false,
    renderTask: null, textLayerTask: null,
    renderedScale: 0, renderedRotation: -1,
    textDivs: null, textItems: null, pageText: null,
    refs: null,                // scripture references found in pageText
    decorated: null,           // text-item indices decoratePage() rewrote
    imageRects: undefined,     // page-space quads, cached
  };
}

async function fetchPageGeometry(seq) {
  const pdf = state.pdf;
  let dirty = false;
  for (let i = 2; i <= state.numPages; i++) {
    if (seq !== state.docSeq) return;
    try {
      const page = await pdf.getPage(i);
      if (seq !== state.docSeq) return;
      const p = state.pages[i];
      p.pdfPage = page;
      const v = page.getViewport({ scale: 1 });
      if (Math.abs(v.width - p.baseW) > 0.5 || Math.abs(v.height - p.baseH) > 0.5) {
        p.baseW = v.width; p.baseH = v.height;
        dirty = true;
      }
    } catch (e) { /* page fetch failed; keep placeholder */ }
    if (dirty && (i % 20 === 0)) { layout(); dirty = false; }
  }
  if (dirty) layout();
}

/* ================= geometry & layout ================= */

function pageDims(p) {
  const rot = state.rotation % 180 !== 0;
  const w = rot ? p.baseH : p.baseW;
  const h = rot ? p.baseW : p.baseH;
  return { w: w * state.scale, h: h * state.scale };
}

function computeFitScale() {
  const p = state.pages[1];
  if (!p) return;
  const rot = state.rotation % 180 !== 0;
  const bw = rot ? p.baseH : p.baseW;
  const bh = rot ? p.baseW : p.baseH;
  const availW = els.viewerWrap.clientWidth - 48 - 14; // padding + scrollbar
  const availH = els.viewerWrap.clientHeight - 36;
  if (availW <= 0 || bw <= 0) return;
  if (state.zoomMode === "fit-width") {
    state.scale = availW / bw;
  } else if (state.zoomMode === "fit-page") {
    state.scale = Math.min(availW / bw, availH / bh);
  }
  state.scale = clampScale(state.scale);
  updateZoomLabel();
}

function clampScale(s) { return Math.min(6, Math.max(0.2, s)); }

function updateZoomLabel() {
  els.zoomLevel.textContent = Math.round(state.scale * 100) + "%";
  $("btnFitWidth").classList.toggle("active", state.zoomMode === "fit-width");
  $("btnFitPage").classList.toggle("active", state.zoomMode === "fit-page");
  updatePopScale();
}

/* The verse popover tracks the page zoom, so a passage is set at the size
   you're already reading the book at. Everything inside the popover is
   sized in em, so setting this one value scales the whole thing.

   Floored at the base size — below 100% zoom the popover would become less
   readable than the chrome around it. The ceiling is generous (roughly 300%
   zoom) so that zooming in to read really does make the passage bigger;
   past it the popover stops growing rather than swallowing the window. */
const POP_BASE_PX = 13.5;
const POP_MAX_PX = 40;

function updatePopScale() {
  const px = Math.min(POP_MAX_PX, Math.max(POP_BASE_PX, POP_BASE_PX * state.scale));
  document.documentElement.style.setProperty("--vp-font", px.toFixed(2) + "px");
  // An open popover was measured at the old size.
  if (pop.anchor) placePop(pop.anchor);
}

function buildPageShells() {
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= state.numPages; i++) {
    const p = state.pages[i];
    const d = pageDims(p);
    const wrapper = document.createElement("div");
    wrapper.className = "page";
    wrapper.dataset.page = i;
    wrapper.style.width = d.w + "px";
    wrapper.style.height = d.h + "px";

    const holder = document.createElement("div");
    holder.className = "canvasHolder";
    const overlays = document.createElement("div");
    overlays.className = "imageOverlays";
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    const ph = document.createElement("div");
    ph.className = "ph";
    ph.textContent = i;

    wrapper.append(holder, overlays, textLayer, ph);
    frag.appendChild(wrapper);

    p.wrapper = wrapper; p.holder = holder;
    p.overlayDiv = overlays; p.textLayerDiv = textLayer;
    pageObserver.observe(wrapper);
  }
  els.viewer.appendChild(frag);
}

/* Resize existing shells to current scale/rotation (cheap; no re-render). */
function layout() {
  for (let i = 1; i <= state.numPages; i++) {
    const p = state.pages[i];
    if (!p || !p.wrapper) continue;
    const d = pageDims(p);
    p.wrapper.style.width = d.w + "px";
    p.wrapper.style.height = d.h + "px";
    if (p.canvas) {                       // stretch old bitmap until re-render
      p.canvas.style.width = d.w + "px";
      p.canvas.style.height = d.h + "px";
    }
    // stale positioned layers are rebuilt on re-render
    if (p.rendered && (p.renderedScale !== state.scale || p.renderedRotation !== state.rotation)) {
      p.textLayerDiv.style.visibility = "hidden";
      p.overlayDiv.style.visibility = "hidden";
    }
  }
  scheduleRerender();
}

/* ================= visibility-driven rendering ================= */

const pageObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const num = parseInt(e.target.dataset.page, 10);
    const p = state.pages[num];
    if (!p) continue;
    p.visible = e.isIntersecting;
    if (e.isIntersecting) renderPage(p);
    else if (p.rendered || p.rendering) releasePage(p);
  }
}, { root: null, rootMargin: "900px 0px" });

let rerenderTimer = 0;
function scheduleRerender() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    for (const p of state.pages) {
      if (!p || !p.visible) continue;
      if (!p.rendered || p.renderedScale !== state.scale || p.renderedRotation !== state.rotation) {
        renderPage(p);
      }
    }
  }, 160);
}

function releasePage(p, hard) {
  if (p.renderTask) { try { p.renderTask.cancel(); } catch (e) {} p.renderTask = null; }
  if (p.textLayerTask) { try { p.textLayerTask.cancel(); } catch (e) {} p.textLayerTask = null; }
  p.rendering = false;
  p.rendered = false;
  p.renderedScale = 0; p.renderedRotation = -1;
  p.textDivs = null;
  p.decorated = null;
  if (p.wrapper) {
    p.wrapper.classList.remove("rendered");
    if (p.canvas) { p.canvas.width = 0; p.canvas.remove(); p.canvas = null; }
    p.textLayerDiv.innerHTML = "";
    p.textLayerDiv.style.visibility = "";
    p.overlayDiv.innerHTML = "";
    p.overlayDiv.style.visibility = "";
  }
  if (hard && p.wrapper) pageObserver.unobserve(p.wrapper);
}

async function renderPage(p) {
  if (!state.pdf) return;
  const seq = state.docSeq;
  const targetScale = state.scale;
  const targetRotation = state.rotation;

  if (p.rendering && p.targetScale === targetScale && p.targetRotation === targetRotation) return;
  if (p.rendered && p.renderedScale === targetScale && p.renderedRotation === targetRotation) return;

  // cancel anything in flight
  if (p.renderTask) { try { p.renderTask.cancel(); } catch (e) {} p.renderTask = null; }
  if (p.textLayerTask) { try { p.textLayerTask.cancel(); } catch (e) {} p.textLayerTask = null; }

  p.rendering = true;
  p.targetScale = targetScale;
  p.targetRotation = targetRotation;

  try {
    if (!p.pdfPage) {
      p.pdfPage = await state.pdf.getPage(p.num);
      if (seq !== state.docSeq) return;
      const v0 = p.pdfPage.getViewport({ scale: 1 });
      p.baseW = v0.width; p.baseH = v0.height;
    }
    const page = p.pdfPage;
    const rotation = (page.rotate + targetRotation) % 360;
    const viewport = page.getViewport({ scale: targetScale, rotation });

    // canvas resolution: devicePixelRatio, capped by total pixel budget
    let os = Math.min(window.devicePixelRatio || 1, 3);
    const px = viewport.width * viewport.height * os * os;
    if (px > MAX_CANVAS_PIXELS) os = Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height));

    const canvas = document.createElement("canvas");
    canvas.className = "pg";
    canvas.width = Math.max(1, Math.floor(viewport.width * os));
    canvas.height = Math.max(1, Math.floor(viewport.height * os));
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";
    const ctx = canvas.getContext("2d", { alpha: false });

    const renderTask = page.render({
      canvasContext: ctx,
      viewport,
      transform: os !== 1 ? [os, 0, 0, os, 0, 0] : undefined,
    });
    p.renderTask = renderTask;
    await renderTask.promise;
    p.renderTask = null;
    if (seq !== state.docSeq || p.targetScale !== targetScale || p.targetRotation !== targetRotation) return;

    // swap in the fresh bitmap
    if (p.canvas) { p.canvas.width = 0; p.canvas.remove(); }
    p.canvas = canvas;
    p.holder.appendChild(canvas);
    p.wrapper.classList.add("rendered");
    p.rendered = true;
    p.rendering = false;
    p.renderedScale = targetScale;
    p.renderedRotation = targetRotation;

    // text layer
    p.textLayerDiv.innerHTML = "";
    p.textLayerDiv.style.visibility = "";
    p.textLayerDiv.style.setProperty("--scale-factor", viewport.scale);
    if (!p.textItems) {
      const tc = await page.getTextContent();
      if (seq !== state.docSeq) return;
      p.textItems = tc.items;
      p.textContent = tc;
    }
    const textDivs = [];
    const tlTask = pdfjsLib.renderTextLayer({
      textContentSource: p.textContent,
      container: p.textLayerDiv,
      viewport,
      textDivs,
    });
    p.textLayerTask = tlTask;
    await tlTask.promise.catch(() => {});
    p.textLayerTask = null;
    if (seq !== state.docSeq) return;
    p.textDivs = textDivs;

    decoratePage(p);

    // image passthrough overlays
    p.overlayDiv.innerHTML = "";
    p.overlayDiv.style.visibility = "";
    if (state.preserveImages) {
      renderImageOverlays(p, viewport, canvas, os, seq).catch(() => {});
    }
  } catch (err) {
    p.rendering = false;
    if (!(err instanceof pdfjsLib.RenderingCancelledException) &&
        !/cancelled|destroyed/i.test(String(err && err.message))) {
      console.error("render page", p.num, err);
    }
  }
}

/* ================= image passthrough =================
   Photos inverted look like negatives. We find image placements from the
   operator list, then copy those regions of the ORIGINAL canvas bitmap
   (CSS filters never touch the bitmap) into small overlay canvases that
   sit outside the filtered element — so photos keep original colors. */

async function computeImageQuads(p) {
  if (p.imageRects !== undefined) return p.imageRects;
  const OPS = pdfjsLib.OPS;
  const U = pdfjsLib.Util;
  const quads = [];
  try {
    const ops = await p.pdfPage.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    for (let j = 0; j < ops.fnArray.length; j++) {
      const fn = ops.fnArray[j];
      const args = ops.argsArray[j];
      switch (fn) {
        case OPS.save: stack.push(ctm.slice()); break;
        case OPS.restore: if (stack.length) ctm = stack.pop(); break;
        case OPS.transform: ctm = U.transform(ctm, args); break;
        case OPS.paintFormXObjectBegin:
          stack.push(ctm.slice());
          if (args && args[0]) ctm = U.transform(ctm, args[0]);
          break;
        case OPS.paintFormXObjectEnd:
          if (stack.length) ctm = stack.pop();
          break;
        case OPS.paintImageXObject:
        case OPS.paintInlineImageXObject:
        case OPS.paintJpegXObject: {
          // unit square corners under ctm → page space
          const c = [
            U.applyTransform([0, 0], ctm), U.applyTransform([1, 0], ctm),
            U.applyTransform([1, 1], ctm), U.applyTransform([0, 1], ctm),
          ];
          // require axis-aligned placement (no skew/odd rotation)
          const axisAligned =
            (Math.abs(ctm[1]) < 1e-3 * (Math.abs(ctm[0]) + 1e-6) && Math.abs(ctm[2]) < 1e-3 * (Math.abs(ctm[3]) + 1e-6)) ||
            (Math.abs(ctm[0]) < 1e-3 * (Math.abs(ctm[1]) + 1e-6) && Math.abs(ctm[3]) < 1e-3 * (Math.abs(ctm[2]) + 1e-6));
          if (axisAligned) quads.push(c);
          break;
        }
      }
    }
  } catch (e) { /* operator list unavailable — no overlays */ }
  p.imageRects = quads;
  return quads;
}

async function renderImageOverlays(p, viewport, canvas, os, seq) {
  const quads = await computeImageQuads(p);
  if (seq !== state.docSeq || !quads.length || p.canvas !== canvas) return;
  const pageArea = viewport.width * viewport.height;
  const frag = document.createDocumentFragment();
  let count = 0;
  for (const q of quads) {
    if (count >= 40) break; // sanity cap
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const pt of q) {
      const [vx, vy] = viewport.convertToViewportPoint(pt[0], pt[1]);
      x0 = Math.min(x0, vx); y0 = Math.min(y0, vy);
      x1 = Math.max(x1, vx); y1 = Math.max(y1, vy);
    }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(viewport.width, x1); y1 = Math.min(viewport.height, y1);
    const w = x1 - x0, h = y1 - y0;
    if (w < 12 || h < 12) continue;               // decorative specks
    if (w * h > pageArea * 0.72) continue;        // full-page scan: keep it dark
    const oc = document.createElement("canvas");
    oc.width = Math.max(1, Math.round(w * os));
    oc.height = Math.max(1, Math.round(h * os));
    oc.style.left = x0 + "px";
    oc.style.top = y0 + "px";
    oc.style.width = w + "px";
    oc.style.height = h + "px";
    const octx = oc.getContext("2d");
    try {
      octx.drawImage(canvas,
        Math.round(x0 * os), Math.round(y0 * os), oc.width, oc.height,
        0, 0, oc.width, oc.height);
    } catch (e) { continue; }
    frag.appendChild(oc);
    count++;
  }
  if (seq !== state.docSeq || p.canvas !== canvas) return;
  p.overlayDiv.innerHTML = "";
  p.overlayDiv.appendChild(frag);
}

/* ================= thumbnails ================= */

function buildThumbShells() {
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= state.numPages; i++) {
    const p = state.pages[i];
    const t = document.createElement("div");
    t.className = "thumb" + (i === state.currentPage ? " active" : "");
    t.dataset.page = i;
    const holder = document.createElement("div");
    holder.className = "t-holder";
    holder.style.aspectRatio = `${p.baseW} / ${p.baseH}`;
    const num = document.createElement("div");
    num.className = "t-num";
    num.textContent = i;
    t.append(holder, num);
    t.addEventListener("click", () => scrollToPage(i));
    frag.appendChild(t);
    p.thumbEl = t;
    thumbObserver.observe(t);
  }
  els.thumbs.appendChild(frag);
}

const thumbObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const num = parseInt(e.target.dataset.page, 10);
    const p = state.pages[num];
    if (p && !p.thumbRendered) renderThumb(p);
  }
}, { root: els.sidebar, rootMargin: "400px 0px" });

async function renderThumb(p) {
  if (p.thumbRendered || !state.pdf) return;
  p.thumbRendered = true;
  const seq = state.docSeq;
  try {
    if (!p.pdfPage) p.pdfPage = await state.pdf.getPage(p.num);
    if (seq !== state.docSeq) return;
    const page = p.pdfPage;
    const scale = THUMB_WIDTH / p.baseW;
    const viewport = page.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    const ctx = canvas.getContext("2d", { alpha: false });
    await page.render({
      canvasContext: ctx, viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    }).promise;
    if (seq !== state.docSeq) return;
    const holder = p.thumbEl.querySelector(".t-holder");
    holder.style.aspectRatio = `${p.baseW} / ${p.baseH}`;
    holder.innerHTML = "";
    holder.appendChild(canvas);
  } catch (e) { p.thumbRendered = false; }
}

/* ================= navigation ================= */

function scrollToPage(num, matchEl) {
  num = Math.min(state.numPages, Math.max(1, num));
  const p = state.pages[num];
  if (!p || !p.wrapper) return;
  if (matchEl) {
    matchEl.scrollIntoView({ block: "center" });
  } else {
    els.viewerWrap.scrollTop = p.wrapper.offsetTop - 12;
  }
  setCurrentPage(num);
}

function setCurrentPage(num) {
  if (num === state.currentPage) return;
  state.currentPage = num;
  if (document.activeElement !== els.pageInput) els.pageInput.value = num;
  const prev = els.thumbs.querySelector(".thumb.active");
  if (prev) prev.classList.remove("active");
  const p = state.pages[num];
  if (p && p.thumbEl) {
    p.thumbEl.classList.add("active");
    if (els.sidebar.classList.contains("open")) {
      p.thumbEl.scrollIntoView({ block: "nearest" });
    }
  }
  rememberPositionDebounced();
}

let rememberTimer = 0;
function rememberPositionDebounced() {
  clearTimeout(rememberTimer);
  rememberTimer = setTimeout(rememberPosition, 600);
}

/* current page = the one covering the upper-middle of the view */
let scrollRaf = 0;
els.viewerWrap.addEventListener("scroll", () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (!state.numPages) return;
    const probe = els.viewerWrap.scrollTop + els.viewerWrap.clientHeight * 0.35;
    let best = 1;
    for (let i = 1; i <= state.numPages; i++) {
      const w = state.pages[i].wrapper;
      if (!w) break;
      if (w.offsetTop <= probe) best = i; else break;
    }
    setCurrentPage(best);
  });
});

/* ================= zoom ================= */

function zoomTo(newScale, mode, anchorClientY) {
  newScale = clampScale(newScale);
  const wrap = els.viewerWrap;
  const rect = wrap.getBoundingClientRect();
  const anchor = (anchorClientY === undefined ? rect.height / 2 : anchorClientY - rect.top);
  const docY = wrap.scrollTop + anchor;
  const ratio = newScale / state.scale;

  state.scale = newScale;
  state.zoomMode = mode || "custom";
  updateZoomLabel();
  layout();
  wrap.scrollTop = docY * ratio - anchor;
  saveSettings();
}

function zoomStep(dir, anchorY) {
  const steps = [0.25, 0.33, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6];
  let s = state.scale;
  if (dir > 0) s = steps.find(v => v > s * 1.001) || 6;
  else s = [...steps].reverse().find(v => v < s * 0.999) || 0.25;
  zoomTo(s, "custom", anchorY);
}

function setFitMode(mode) {
  state.zoomMode = mode;
  const before = state.scale;
  computeFitScale();
  if (Math.abs(before - state.scale) > 0.001) layout();
  updateZoomLabel();
  saveSettings();
}

/* ================= rotation ================= */

function rotatePages() {
  state.rotation = (state.rotation + 90) % 360;
  for (const p of state.pages) if (p) p.imageRects = undefined;
  if (state.zoomMode !== "custom") computeFitScale();
  layout();
}

/* ================= search ================= */

function clearSearch(silent) {
  state.search.query = "";
  state.search.matches = [];
  state.search.index = -1;
  els.searchCount.textContent = "";
  els.searchCount.classList.remove("none");
  if (!silent) decorateAll();
}

/* Pull a page's text content and build its offset table. Shared by search
   indexing and reference indexing, both of which need every page's text;
   whichever runs first pays for it. Returns false if the document changed
   underneath us. */
async function ensurePageText(p, seq) {
  if (p.pageText !== null && p.pageText !== undefined) return true;
  if (!p.textItems) {
    if (!p.pdfPage) p.pdfPage = await state.pdf.getPage(p.num);
    if (seq !== state.docSeq) return false;
    const tc = await p.pdfPage.getTextContent();
    if (seq !== state.docSeq) return false;
    p.textItems = tc.items;
    p.textContent = tc;
  }
  ensureItemStarts(p);
  return true;
}

async function ensureAllPageText() {
  const seq = state.docSeq;
  for (let i = 1; i <= state.numPages; i++) {
    if (!await ensurePageText(state.pages[i], seq)) return false;
    if (i % 25 === 0) els.searchCount.textContent = `indexing ${Math.round(i / state.numPages * 100)}%`;
  }
  return true;
}

async function runSearch(query) {
  if (!state.pdf) return;
  const q = query.trim();
  const prevQuery = state.search.query;
  decorateAll();
  state.search.query = q;
  state.search.matches = [];
  state.search.index = -1;
  if (!q) { clearSearch(true); return; }

  if (state.search.indexing) return;
  state.search.indexing = true;
  els.searchCount.textContent = "…";
  const ok = await ensureAllPageText();
  state.search.indexing = false;
  if (!ok || state.search.query !== q) return;

  const ql = q.toLowerCase();
  const matches = [];
  for (let i = 1; i <= state.numPages; i++) {
    const p = state.pages[i];
    if (!p.pageTextLower) continue;
    let idx = p.pageTextLower.indexOf(ql);
    while (idx !== -1) {
      matches.push({ page: i, start: idx, end: idx + ql.length });
      if (matches.length > 5000) break;
      idx = p.pageTextLower.indexOf(ql, idx + 1);
    }
    if (matches.length > 5000) break;
  }
  state.search.matches = matches;

  if (!matches.length) {
    els.searchCount.textContent = "0/0";
    els.searchCount.classList.add("none");
    return;
  }
  els.searchCount.classList.remove("none");

  // first match at/after the current page (fresh searches), else stay put
  let startIdx = 0;
  if (q !== prevQuery) {
    startIdx = matches.findIndex(m => m.page >= state.currentPage);
    if (startIdx === -1) startIdx = 0;
  }
  goToMatch(startIdx);
}

function goToMatch(k) {
  const s = state.search;
  if (!s.matches.length) return;
  s.index = ((k % s.matches.length) + s.matches.length) % s.matches.length;
  els.searchCount.textContent = `${s.index + 1}/${s.matches.length}`;
  const m = s.matches[s.index];
  const p = state.pages[m.page];

  // the previous and current match may sit on different pages
  decorateAll();

  if (p.textDivs) {
    const cur = p.textLayerDiv.querySelector("mark.cur");
    scrollToPage(m.page, cur || undefined);
  } else {
    // page not rendered yet: scroll there; highlights attach after render
    scrollToPage(m.page);
  }
}

/* ================= text-layer decoration =================
   Search highlights and scripture-reference anchors both rewrite the same
   PDF.js text-layer spans, so they cannot own that markup independently —
   whichever ran second would erase the other. decoratePage() is the single
   writer: it rebuilds each affected span from the original string with both
   kinds of range applied, and remembers which spans it touched so the next
   pass can reset exactly those.

   A range of either kind may span several spans (PDF.js splits text at
   layout boundaries, not word ones), and the two kinds may overlap — you
   can search for text that is itself a reference. So the emitter cuts each
   span at every range boundary and nests a <mark> inside an <a> where they
   coincide. */

/* Offsets of each text item within the page's concatenated text. Built by
   ensurePageText(), but a page can render before indexing reaches it. */
function ensureItemStarts(p) {
  if (p.itemStarts || !p.textItems) return !!p.itemStarts;
  let text = "";
  const starts = new Array(p.textItems.length);
  for (let k = 0; k < p.textItems.length; k++) {
    starts[k] = text.length;
    text += p.textItems[k].str;
  }
  p.pageText = text;
  p.pageTextLower = text.toLowerCase();
  p.itemStarts = starts;
  return true;
}

/* Split a page-text range across the text items it covers, appending
   {ls, le} local offsets into `perItem`. */
function splitRange(p, start, end, tag, perItem) {
  const starts = p.itemStarts;
  let lo = 0, hi = starts.length - 1, first = 0;
  while (lo <= hi) {                       // last item starting at or before `start`
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= start) { first = mid; lo = mid + 1; } else hi = mid - 1;
  }
  for (let k = first; k < starts.length; k++) {
    const itemStart = starts[k];
    const itemEnd = itemStart + p.textItems[k].str.length;
    if (itemStart >= end) break;
    if (itemEnd <= start) continue;
    const ls = Math.max(0, start - itemStart);
    const le = Math.min(p.textItems[k].str.length, end - itemStart);
    if (le <= ls) continue;
    if (!perItem.has(k)) perItem.set(k, []);
    perItem.get(k).push({ ls, le, ...tag });
  }
}

/* Rebuild one span with its ranges applied. */
function paintItem(div, str, ranges) {
  const cuts = new Set([0, str.length]);
  for (const r of ranges) { cuts.add(r.ls); cuts.add(r.le); }
  const points = [...cuts].sort((a, b) => a - b);

  div.textContent = "";
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (a >= b) continue;
    let node = document.createTextNode(str.slice(a, b));
    const covering = ranges.filter(r => r.ls <= a && r.le >= b);
    const hit = covering.find(r => r.kind === "mark");
    const ref = covering.find(r => r.kind === "ref");
    if (hit) {
      const mark = document.createElement("mark");
      if (hit.cur) mark.className = "cur";
      mark.appendChild(node);
      node = mark;
    }
    if (ref) {
      const anchor = document.createElement("a");
      anchor.className = "kjv-ref" + (ref.carried ? " carried" : "");
      anchor.dataset.ref = ref.id;
      anchor.appendChild(node);
      node = anchor;
    }
    div.appendChild(node);
  }
}

function decoratePage(p) {
  if (!p || !p.textDivs || !p.textItems) return;

  // reset only the spans a previous pass rewrote
  if (p.decorated) {
    for (const k of p.decorated) {
      const div = p.textDivs[k];
      if (div) div.textContent = p.textItems[k].str;
    }
    p.decorated = null;
  }
  if (!ensureItemStarts(p)) return;

  const perItem = new Map();

  const s = state.search;
  if (s.query) {
    for (let mi = 0; mi < s.matches.length; mi++) {
      const m = s.matches[mi];
      if (m.page !== p.num) continue;
      splitRange(p, m.start, m.end, { kind: "mark", cur: mi === s.index }, perItem);
    }
  }

  if (state.refs.on && p.refs) {
    for (let ri = 0; ri < p.refs.length; ri++) {
      const r = p.refs[ri];
      splitRange(p, r.start, r.end,
        { kind: "ref", id: p.num + ":" + ri, carried: r.carried }, perItem);
    }
  }

  if (!perItem.size) return;

  const touched = [];
  for (const [k, ranges] of perItem) {
    const div = p.textDivs[k];
    if (!div || div.tagName !== "SPAN") continue;
    paintItem(div, p.textItems[k].str, ranges);
    touched.push(k);
  }
  p.decorated = touched.length ? touched : null;
}

/* Redecorate every page that currently has a text layer. */
function decorateAll() {
  for (const p of state.pages) if (p && p.textDivs) decoratePage(p);
}

/* ================= scripture references =================
   Two halves: an index pass that finds references across the whole
   document, and a popover that shows the KJV text on hover.

   The index has to run in document order rather than per rendered page,
   because a bare continuation ("In verse 22…") resolves against whichever
   citation came before it — possibly on an earlier page. So a page cannot
   be interpreted in isolation, and jumping straight to page 300 would give
   the wrong antecedent. The pass runs in the background after open and
   decorates each page as it goes; pages already on screen pick up their
   anchors when the pass reaches them. */

async function buildRefIndex() {
  if (!state.pdf || state.refs.indexing) return;
  const seq = state.docSeq;
  state.refs.indexing = true;

  // Fetch the text in parallel with this pass; the first hover needs it.
  KJV.load().catch(() => {});

  let carry = null;
  let total = 0;
  try {
    for (let i = 1; i <= state.numPages; i++) {
      const p = state.pages[i];
      if (!p) continue;
      if (!await ensurePageText(p, seq)) return;
      const { refs, carryOut } = KJV.findRefs(p.pageText, carry, i);
      carry = carryOut;
      p.refs = refs;
      total += refs.length;
      if (refs.length && p.textDivs) decoratePage(p);
    }
    state.refs.indexed = true;
    state.refs.count = total;
  } finally {
    if (seq === state.docSeq) state.refs.indexing = false;
  }
}

/* ---------- popover ---------- */

const pop = {
  el: $("versePop"),
  refEl: null, bodyEl: null, noteEl: null,
  anchor: null,          // the <a> currently described
  pinned: false,
  showTimer: 0, hideTimer: 0,
};

function initPop() {
  pop.refEl = pop.el.querySelector(".vp-ref");
  pop.bodyEl = pop.el.querySelector(".vp-body");
  pop.noteEl = pop.el.querySelector(".vp-note");
}

/* Resolve the {page, index} encoded in an anchor's data-ref. */
function refForAnchor(a) {
  const id = a && a.dataset && a.dataset.ref;
  if (!id) return null;
  const [pageStr, idxStr] = id.split(":");
  const p = state.pages[+pageStr];
  return p && p.refs ? p.refs[+idxStr] || null : null;
}

function placePop(anchor) {
  const r = anchor.getBoundingClientRect();
  const el = pop.el;
  // Size is independent of position (max-content capped by a viewport-relative
  // max-width), so it can be measured in place — no reset, no flash when this
  // runs a second time after the text arrives.
  const w = el.offsetWidth, h = el.offsetHeight;
  const margin = 10;

  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));

  // below if it fits, otherwise above
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - margin) {
    const above = r.top - h - 8;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - h - margin);
  }
  el.style.left = Math.round(left) + "px";
  el.style.top = Math.round(top) + "px";
}

function renderPop(entry) {
  const data = KJV.passage(entry.ref);
  pop.refEl.textContent = entry.ref.label;
  pop.bodyEl.innerHTML = "";
  pop.noteEl.textContent = "";

  if (!data) {
    pop.bodyEl.textContent = "Loading the King James text…";
    return false;
  }
  if (data.missing || !data.verses.length) {
    pop.bodyEl.textContent = "No text found for that reference.";
    return true;
  }

  for (const v of data.verses) {
    const line = document.createElement("p");
    line.className = "vp-v";
    const n = document.createElement("span");
    n.className = "n";
    // Show chapter:verse when a passage crosses chapters, else just the verse.
    n.textContent = data.verses[0].c === v.c ? v.v : `${v.c}:${v.v}`;
    line.appendChild(n);
    line.appendChild(document.createTextNode(v.text));
    pop.bodyEl.appendChild(line);
  }

  const notes = [];
  if (entry.carried) notes.push(`continues ${entry.from}`);
  if (data.truncated) notes.push(`first ${KJV.MAX_VERSES} verses`);
  pop.noteEl.textContent = notes.join(" · ");
  return true;
}

async function showPop(anchor) {
  const entry = refForAnchor(anchor);
  if (!entry) return;

  if (pop.anchor && pop.anchor !== anchor) pop.anchor.classList.remove("open");
  pop.anchor = anchor;
  anchor.classList.add("open");

  pop.el.hidden = false;
  const complete = renderPop(entry);
  placePop(anchor);
  pop.el.classList.add("on");

  if (!complete) {
    // Text still arriving — fill in once it lands, if this anchor is still up.
    try { await KJV.load(); } catch (e) {
      if (pop.anchor === anchor) pop.bodyEl.textContent = "Couldn't load the KJV text.";
      return;
    }
    if (pop.anchor !== anchor) return;
    renderPop(entry);
    placePop(anchor);
  }
}

function hidePop(force) {
  if (pop.pinned && !force) return;
  clearTimeout(pop.showTimer);
  pop.pinned = false;
  pop.el.classList.remove("on", "pinned");
  if (pop.anchor) pop.anchor.classList.remove("open");
  pop.anchor = null;
  // let the fade finish before pulling it out of the layout
  clearTimeout(pop.hideTimer);
  pop.hideTimer = setTimeout(() => {
    if (!pop.el.classList.contains("on")) pop.el.hidden = true;
  }, 150);
}

function wireRefs() {
  initPop();

  els.viewer.addEventListener("mouseover", (e) => {
    if (!state.refs.on) return;
    const a = e.target.closest && e.target.closest("a.kjv-ref");
    if (!a || a === pop.anchor) return;
    clearTimeout(pop.showTimer);
    clearTimeout(pop.hideTimer);
    pop.showTimer = setTimeout(() => showPop(a), 130);
  });

  els.viewer.addEventListener("mouseout", (e) => {
    if (pop.pinned) return;
    const a = e.target.closest && e.target.closest("a.kjv-ref");
    if (!a) return;
    clearTimeout(pop.showTimer);
    // Moving into the popover itself must not dismiss it.
    const to = e.relatedTarget;
    if (to && pop.el.contains(to)) return;
    pop.hideTimer = setTimeout(() => hidePop(), 180);
  });

  // Clicking a reference pins the popover so the passage can be read and copied.
  els.viewer.addEventListener("click", (e) => {
    if (!state.refs.on) return;
    const a = e.target.closest && e.target.closest("a.kjv-ref");
    if (!a) return;
    // Finishing a text selection over a reference shouldn't pin it.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    e.preventDefault();
    clearTimeout(pop.hideTimer);
    if (pop.pinned && pop.anchor === a) { hidePop(true); return; }
    pop.pinned = false;
    showPop(a);
    pop.pinned = true;
    pop.el.classList.add("pinned");
  });

  pop.el.addEventListener("mouseenter", () => clearTimeout(pop.hideTimer));
  pop.el.addEventListener("mouseleave", () => {
    if (!pop.pinned) pop.hideTimer = setTimeout(() => hidePop(), 150);
  });

  // A pinned popover would otherwise float away from its reference.
  els.viewerWrap.addEventListener("scroll", () => {
    if (pop.anchor) hidePop(true);
  }, { passive: true });

  document.addEventListener("mousedown", (e) => {
    if (pop.pinned && !pop.el.contains(e.target) &&
        !(e.target.closest && e.target.closest("a.kjv-ref"))) hidePop(true);
  });
}

function setRefsEnabled(on) {
  state.refs.on = on;
  els.refToggle.checked = on;
  if (!on) hidePop(true);
  saveSettings();
  decorateAll();
  if (on && !state.refs.indexed && state.pdf) buildRefIndex();
}

/* ================= event wiring ================= */

function wireUI() {
  $("btnOpen").addEventListener("click", () => els.fileInput.click());
  $("btnWelcomeOpen").addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => {
    openFile(els.fileInput.files[0]);
    els.fileInput.value = "";
  });

  $("btnSidebar").addEventListener("click", () => {
    els.sidebar.classList.toggle("open");
    saveSettings();
    if (state.zoomMode !== "custom") { computeFitScale(); layout(); }
  });

  $("btnZoomIn").addEventListener("click", () => zoomStep(1));
  $("btnZoomOut").addEventListener("click", () => zoomStep(-1));
  $("btnFitWidth").addEventListener("click", () => setFitMode("fit-width"));
  $("btnFitPage").addEventListener("click", () => setFitMode("fit-page"));
  $("btnRotate").addEventListener("click", rotatePages);

  els.pageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const n = parseInt(els.pageInput.value, 10);
      if (n >= 1 && n <= state.numPages) scrollToPage(n);
      else els.pageInput.value = state.currentPage;
      els.pageInput.blur();
    }
  });
  els.pageInput.addEventListener("focus", () => els.pageInput.select());

  els.themeSelect.addEventListener("change", () => {
    state.theme = els.themeSelect.value;
    applyTheme();
    saveSettings();
  });
  els.brightSlider.addEventListener("input", () => {
    state.brightness = els.brightSlider.value / 100;
    applyTheme();
  });
  els.brightSlider.addEventListener("change", saveSettings);
  els.brightSlider.addEventListener("dblclick", () => {
    els.brightSlider.value = 100;
    state.brightness = 1;
    applyTheme(); saveSettings();
  });

  els.imgToggle.addEventListener("change", () => {
    state.preserveImages = els.imgToggle.checked;
    saveSettings();
    for (const p of state.pages) {
      if (!p || !p.rendered) continue;
      p.overlayDiv.innerHTML = "";
      if (state.preserveImages && p.canvas) {
        const page = p.pdfPage;
        const rotation = (page.rotate + p.renderedRotation) % 360;
        const viewport = page.getViewport({ scale: p.renderedScale, rotation });
        const os = p.canvas.width / viewport.width;
        renderImageOverlays(p, viewport, p.canvas, os, state.docSeq).catch(() => {});
      }
    }
  });

  els.refToggle.addEventListener("change", () => setRefsEnabled(els.refToggle.checked));

  // search
  let searchTimer = 0;
  els.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(els.searchInput.value), 350);
  });
  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(searchTimer);
      if (state.search.query !== els.searchInput.value.trim()) {
        runSearch(els.searchInput.value);
      } else if (state.search.matches.length) {
        goToMatch(state.search.index + (e.shiftKey ? -1 : 1));
      }
    } else if (e.key === "Escape") {
      els.searchInput.value = "";
      runSearch("");
      els.searchInput.blur();
    }
  });
  $("btnSearchNext").addEventListener("click", () => goToMatch(state.search.index + 1));
  $("btnSearchPrev").addEventListener("click", () => goToMatch(state.search.index - 1));

  // drag & drop
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) {
      dragDepth++;
      els.dropOverlay.classList.add("on");
    }
  });
  window.addEventListener("dragleave", () => {
    if (--dragDepth <= 0) { dragDepth = 0; els.dropOverlay.classList.remove("on"); }
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    els.dropOverlay.classList.remove("on");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  // ctrl+wheel zoom
  els.viewerWrap.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (!state.pdf) return;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomTo(state.scale * factor, "custom", e.clientY);
  }, { passive: false });

  // keyboard
  window.addEventListener("keydown", (e) => {
    const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === "Escape" && pop.pinned) { hidePop(true); return; }
    if (e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "o") { e.preventDefault(); els.fileInput.click(); return; }
      if (k === "f") { e.preventDefault(); els.searchInput.focus(); els.searchInput.select(); return; }
      if (k === "=" || k === "+") { e.preventDefault(); zoomStep(1); return; }
      if (k === "-") { e.preventDefault(); zoomStep(-1); return; }
      if (k === "0") { e.preventDefault(); setFitMode("fit-width"); return; }
      return;
    }
    if (inField) return;
    switch (e.key) {
      case "ArrowRight": e.preventDefault(); scrollToPage(state.currentPage + 1); break;
      case "ArrowLeft": e.preventDefault(); scrollToPage(state.currentPage - 1); break;
      case "Home": e.preventDefault(); scrollToPage(1); break;
      case "End": e.preventDefault(); scrollToPage(state.numPages); break;
      case "F3": e.preventDefault(); goToMatch(state.search.index + (e.shiftKey ? -1 : 1)); break;
      default: {
        const k = e.key.toLowerCase();
        if (k === "v") setRefsEnabled(!state.refs.on);
        else if (k === "w") setFitMode("fit-width");
        else if (k === "p") setFitMode("fit-page");
        else if (k === "r") rotatePages();
        else if (k === "t") $("btnSidebar").click();
        else if (k === "+" || k === "=") zoomStep(1);
        else if (k === "-") zoomStep(-1);
      }
    }
  });

  // refit on resize
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.pdf) return;
      if (state.zoomMode !== "custom") { computeFitScale(); }
      layout();
    }, 150);
  });

  window.addEventListener("beforeunload", rememberPosition);
}

/* ================= boot ================= */

loadSettings();
applyTheme();
updateZoomLabel();
wireUI();
wireRefs();

const bootUrl = new URLSearchParams(location.search).get("url");
if (bootUrl && location.protocol !== "file:") openUrl(bootUrl);
