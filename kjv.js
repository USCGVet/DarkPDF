/* ============================================================
   KJV verse lookup — finds scripture references in page text and
   resolves them to King James text for the hover tooltips.

   Two jobs live here, deliberately kept free of any DOM code so
   app.js owns all rendering:

     findRefs(text, carryIn, page)  scan a string for references
     passage(ref)                   resolve one to its verses

   The text itself is a gzipped blob (libs/kjv.txt.gz in dev, a
   base64 string inlined by build.ps1 in the standalone build),
   decompressed on first use so opening a PDF stays fast.
   ============================================================ */
"use strict";

window.KJV = (function () {

  /* ---------- book table ----------
     Each entry: [canonical name, number prefix, chapter count, aliases].

     The number prefix is separate from the alias so "1 Sam", "I Sam",
     "1Samuel" and "2 Sam" all share one alias list. The chapter count
     lets an impossible reference ("Genesis 51:1") be rejected before
     the text is even loaded.

     Short aliases that are also ordinary English words are deliberately
     omitted — "Am" (Amos), "Is" (Isaiah), "Ac" (Acts), "So" (Song),
     "Re" (Revelation), "Mi" (Micah), "Da" (Daniel) and friends would
     fire on running prose. A reference must be unmistakable to be worth
     underlining, so recall loses to precision here. Aliases needing a
     number prefix ("co", "th", "ti") are safe, since the prefix itself
     rules out the English word. */
  const BOOKS = [
    ["Genesis",         0,  50, "gen ge gn genesis"],
    ["Exodus",          0,  40, "exod exo ex exodus"],
    ["Leviticus",       0,  27, "lev lv leviticus"],
    ["Numbers",         0,  36, "num nm numbers"],
    ["Deuteronomy",     0,  34, "deut deu dt deuteronomy"],
    ["Joshua",          0,  24, "josh jos jsh joshua"],
    ["Judges",          0,  21, "judg jdg jgs judges"],
    ["Ruth",            0,   4, "ruth rth"],
    ["1 Samuel",        1,  31, "sam sa sm samuel"],
    ["2 Samuel",        2,  24, "sam sa sm samuel"],
    ["1 Kings",         1,  22, "kgs kg ki kin kings"],
    ["2 Kings",         2,  25, "kgs kg ki kin kings"],
    ["1 Chronicles",    1,  29, "chr ch chron chronicles"],
    ["2 Chronicles",    2,  36, "chr ch chron chronicles"],
    ["Ezra",            0,  10, "ezra ezr"],
    ["Nehemiah",        0,  13, "neh nehemiah"],
    ["Esther",          0,  10, "esth est esther"],
    ["Job",             0,  42, "job jb"],
    ["Psalms",          0, 150, "ps psa pss psalm psalms pslm psm"],
    ["Proverbs",        0,  31, "prov pro prv proverbs"],
    ["Ecclesiastes",    0,  12, "eccl eccles ecc ecclesiastes qoh"],
    ["Song of Solomon", 0,   8, "song songs cant canticles sos"],
    ["Isaiah",          0,  66, "isa isaiah"],
    ["Jeremiah",        0,  52, "jer jeremiah"],
    ["Lamentations",    0,   5, "lam lamentations"],
    ["Ezekiel",         0,  48, "ezek eze ezk ezekiel"],
    ["Daniel",          0,  12, "dan dn daniel"],
    ["Hosea",           0,  14, "hos hosea"],
    ["Joel",            0,   3, "joel jl"],
    ["Amos",            0,   9, "amos"],
    ["Obadiah",         0,   1, "obad obadiah"],
    ["Jonah",           0,   4, "jonah jnh"],
    ["Micah",           0,   7, "mic micah"],
    ["Nahum",           0,   3, "nah nahum"],
    ["Habakkuk",        0,   3, "hab habakkuk"],
    ["Zephaniah",       0,   3, "zeph zep zephaniah"],
    ["Haggai",          0,   2, "hag haggai"],
    ["Zechariah",       0,  14, "zech zec zechariah"],
    ["Malachi",         0,   4, "mal malachi"],
    ["Matthew",         0,  28, "matt mat mt matthew"],
    ["Mark",            0,  16, "mark mk mrk"],
    ["Luke",            0,  24, "luke lk luk"],
    ["John",            0,  21, "john jn joh"],
    ["Acts",            0,  28, "acts act"],
    ["Romans",          0,  16, "rom rm romans"],
    ["1 Corinthians",   1,  16, "cor co corinthians"],
    ["2 Corinthians",   2,  13, "cor co corinthians"],
    ["Galatians",       0,   6, "gal galatians"],
    ["Ephesians",       0,   6, "eph ephes ephesians"],
    ["Philippians",     0,   4, "phil php philippians"],
    ["Colossians",      0,   4, "col colossians"],
    ["1 Thessalonians", 1,   5, "thess thes th thessalonians"],
    ["2 Thessalonians", 2,   3, "thess thes th thessalonians"],
    ["1 Timothy",       1,   6, "tim ti timothy"],
    ["2 Timothy",       2,   4, "tim ti timothy"],
    ["Titus",           0,   3, "titus tit"],
    ["Philemon",        0,   1, "phlm philem phm philemon"],
    ["Hebrews",         0,  13, "heb hebrews"],
    ["James",           0,   5, "jas james"],
    ["1 Peter",         1,   5, "pet pe pt peter"],
    ["2 Peter",         2,   3, "pet pe pt peter"],
    ["1 John",          1,   5, "john jn joh"],
    ["2 John",          2,   1, "john jn joh"],
    ["3 John",          3,   1, "john jn joh"],
    ["Jude",            0,   1, "jude"],
    ["Revelation",      0,  22, "rev revelation apoc apocalypse"],
  ];

  const ALIAS = new Map();    // "<prefix>|<alias>" -> canonical name
  const CHAPTERS = new Map(); // canonical name -> chapter count
  for (const [name, num, chapters, aliases] of BOOKS) {
    CHAPTERS.set(name, chapters);
    for (const a of aliases.split(" ")) ALIAS.set(num + "|" + a, name);
  }

  const ROMAN = { i: 1, ii: 2, iii: 3 };

  /* ---------- reference patterns ---------- */

  const N = String.raw`\d{1,3}`;
  const DASH = String.raw`[-‐‑‒–—―]`;
  /* one segment: 16 | 12-15 | 1-2:3 (cross-chapter) */
  const SEG = `${N}(?:\\s*${DASH}\\s*(?:${N}\\s*:\\s*)?${N})?`;
  /* full spec: segments joined by commas — "16, 17" or "12-15, 20" */
  const SPEC = `${SEG}(?:\\s*,\\s*${SEG})*`;

  /* Shared head of both reference patterns: optional number prefix, then
     the book word.
       - `(?<![A-Za-z])` stops mid-word hits ("inGenesis 1:1").
       - `(?:\[[A-Za-z]*\])?` tolerates editorial expansion, which Heiser
         uses: "1 Cor[inthians] 11:2-16".
       - `of Solomon|Songs|John` picks up the multi-word titles. */
  const HEAD =
    String.raw`(?<![A-Za-z])(?:([1-3]|III|II|I)\s*\.?\s*)?` +
    String.raw`([A-Z][A-Za-z]{0,13})\.?(?:\[[A-Za-z]*\])?` +
    String.raw`(?:\s+of\s+(?:Solomon|Songs|John))?`;

  /* A full reference — book, chapter, verses. The chapter/verse separator
     allows "." only when tight against a digit, so a sentence break
     ("Matthew 5. 3 reasons") cannot match. */
  const FULL_RE = new RegExp(
    HEAD + String.raw`\s*(${N})\s*(?::|\.(?=\d))\s*(${SPEC})`, "g");

  /* A bare chapter — "Genesis 3", "Hebrews 1". These never become
     hoverable (a whole chapter is not a tooltip), but they DO anchor the
     carry: authors routinely name a chapter and then discuss it by verse
     alone ("...hints in Genesis 3 ... In verse 22, after Adam and Eve").
     Without this the bare verse resolves against a stale citation. */
  const CHAPTER_RE = new RegExp(
    HEAD + String.raw`\s+(${N})(?!\d)(?!\s*(?::|\.\d))`, "g");

  /* A chapter:verse with no book, continuing a citation group after a
     semicolon or comma — "(Ezek. 28:13; 31:8-9)". Standard SBL style, so
     it turns up constantly in these books. Only accepted when nothing but
     a separator sits between it and the reference it continues. */
  const CONT_RE = new RegExp(
    String.raw`(?<![A-Za-z0-9:])(${N})\s*:\s*(${SPEC})`, "g");
  const SEPARATOR_ONLY = /^[\s]*[;,][\s]*$/;

  /* A bare continuation: "v. 12", "vv. 6-8", "verse 28", "verses 19-21".
     An optional chapter may ride along — Heiser writes "(v. 28:14)" —
     in which case it overrides the carried chapter. */
  const BARE_RE = new RegExp(
    String.raw`(?<![A-Za-z])(vv?|verses?)\s*\.?\s*(?:(${N})\s*:\s*)?(${SPEC})`,
    "gi");

  /* How far a bare reference will reach back for its book and chapter.
     Within a page it is almost always right; across a couple of pages it
     usually still is. Past that the antecedent is probably a different
     discussion, and a confidently wrong verse is worse than none. */
  const CARRY_MAX_PAGES = 2;

  const MAX_VERSES = 40;   // a tooltip past this gets truncated

  /* ---------- spec parsing ---------- */

  /* "12-15, 20" at chapter 3 -> [{c1:3,v1:12,c2:3,v2:15},{c1:3,v1:20,…}] */
  function parseSpec(chapter, spec) {
    const partRe = new RegExp(
      `^(${N})(?:\\s*${DASH}\\s*(?:(${N})\\s*:\\s*)?(${N}))?$`);
    const out = [];
    for (const part of spec.split(",")) {
      const m = part.trim().match(partRe);
      if (!m) continue;
      const v1 = +m[1];
      const c2 = m[2] ? +m[2] : chapter;
      const v2 = m[3] ? +m[3] : v1;
      if (c2 < chapter || (c2 === chapter && v2 < v1)) continue;  // reversed
      out.push({ c1: chapter, v1, c2, v2 });
    }
    return out;
  }

  function specLabel(spec) {
    return spec.replace(/\s*[-‐‑‒–—―]\s*/g, "–")
               .replace(/\s*,\s*/g, ", ")
               .replace(/\s*:\s*/g, ":");
  }

  /* Psalms reads as "Psalm 89:6" for a single psalm, which is the KJV
     convention and how these authors cite it. */
  function displayBook(name, segs) {
    if (name !== "Psalms") return name;
    const one = segs.every(s => s.c1 === segs[0].c1 && s.c2 === segs[0].c1);
    return one ? "Psalm" : "Psalms";
  }

  function makeRef(book, chapter, spec) {
    const max = CHAPTERS.get(book);
    if (!max || chapter < 1 || chapter > max) return null;
    const segs = parseSpec(chapter, spec).filter(s => s.c2 <= max);
    if (!segs.length) return null;
    return {
      book, chapter, segs,
      label: `${displayBook(book, segs)} ${chapter}:${specLabel(spec)}`,
    };
  }

  /* Resolve a matched (prefix, word) pair to a canonical book name. */
  function resolveBook(prefixRaw, word) {
    let num = 0;
    if (prefixRaw) {
      const p = prefixRaw.toLowerCase();
      num = ROMAN[p] !== undefined ? ROMAN[p] : +p;
    }
    return ALIAS.get(num + "|" + word.toLowerCase());
  }

  /* ---------- scanning ----------

     findRefs(text, carryIn, page) returns { refs, carryOut }.

     `refs` are sorted by position, each { start, end, ref, carried, from }.
     `carryIn`/`carryOut` thread the "last citation" cursor between pages
     so a bare "v. 12" on page 40 can resolve against a citation made on
     page 39. carryOut carries a `page` stamp so the caller's next call
     can age it out via CARRY_MAX_PAGES. */
  function findRefs(text, carryIn, page) {
    const refs = [];      // hoverable
    const anchors = [];   // { start, book, chapter } — antecedent candidates
    let m;

    FULL_RE.lastIndex = 0;
    while ((m = FULL_RE.exec(text)) !== null) {
      const book = resolveBook(m[1], m[2]);
      if (!book) continue;
      const ref = makeRef(book, +m[3], m[4]);
      if (!ref) continue;
      refs.push({ start: m.index, end: m.index + m[0].length, ref, carried: false });
      anchors.push({ start: m.index, book, chapter: ref.chapter });
    }

    /* Book-less continuations of a citation group. Walked in order so a
       chain keeps extending: "Ezek. 28:13; 31:8-9; 32:1". */
    CONT_RE.lastIndex = 0;
    const conts = [];
    while ((m = CONT_RE.exec(text)) !== null) {
      const start = m.index, end = m.index + m[0].length;
      if (refs.some(r => start < r.end && end > r.start)) continue;  // inside a full ref
      conts.push({ start, end, chapter: +m[1], spec: m[2] });
    }
    for (const cont of conts) {
      let prev = null;
      for (const r of refs) if (r.end <= cont.start && (!prev || r.end > prev.end)) prev = r;
      if (!prev) continue;
      if (!SEPARATOR_ONLY.test(text.slice(prev.end, cont.start))) continue;
      const ref = makeRef(prev.ref.book, cont.chapter, cont.spec);
      if (!ref) continue;
      refs.push({ start: cont.start, end: cont.end, ref, carried: false });
      anchors.push({ start: cont.start, book: prev.ref.book, chapter: ref.chapter });
    }

    /* Bare chapters, for anchoring only. Skip any that sit inside a full
       reference already matched ("Gen. 1" within "Gen. 1:26-28"). */
    CHAPTER_RE.lastIndex = 0;
    while ((m = CHAPTER_RE.exec(text)) !== null) {
      const book = resolveBook(m[1], m[2]);
      if (!book) continue;
      const chapter = +m[3];
      const max = CHAPTERS.get(book);
      if (chapter < 1 || chapter > max) continue;
      const end = m.index + m[0].length;
      if (refs.some(r => m.index < r.end && end > r.start)) continue;
      anchors.push({ start: m.index, book, chapter });
    }

    anchors.sort((a, b) => a.start - b.start);

    /* Bare continuations, resolved against the nearest anchor that starts
       before them — on this page if there is one, else the incoming carry. */
    BARE_RE.lastIndex = 0;
    while ((m = BARE_RE.exec(text)) !== null) {
      const start = m.index, end = m.index + m[0].length;
      if (refs.some(r => start < r.end && end > r.start)) continue;

      let book = null, chapter = null, from = null;
      for (const a of anchors) {
        if (a.start >= start) break;
        book = a.book; chapter = a.chapter;
      }
      if (!book && carryIn && page - carryIn.page <= CARRY_MAX_PAGES) {
        book = carryIn.book; chapter = carryIn.chapter;
        from = carryIn.label;
      }
      if (!book) continue;
      if (m[2]) chapter = +m[2];         // "(v. 28:14)" — explicit chapter

      const ref = makeRef(book, chapter, m[3]);
      if (!ref) continue;
      refs.push({
        start, end, ref, carried: true,
        from: from || `${book} ${chapter}`,
      });
    }

    refs.sort((a, b) => a.start - b.start);

    /* Drop overlaps, keeping the earlier match. */
    const out = [];
    let lastEnd = -1;
    for (const r of refs) {
      if (r.start < lastEnd) continue;
      out.push(r);
      lastEnd = r.end;
    }

    /* Outgoing cursor: last anchor on the page, else pass the incoming one
       through so a page with no citations doesn't break the chain. */
    let carryOut = carryIn;
    if (anchors.length) {
      const a = anchors[anchors.length - 1];
      carryOut = {
        book: a.book, chapter: a.chapter, page,
        label: `${a.book} ${a.chapter}`,
      };
    }
    return { refs, carryOut };
  }

  /* ---------- text store ---------- */

  const GS = "\x1d", RS = "\x1e", US = "\x1f";
  let store = null;          // Map<book, string[][]>
  let loadPromise = null;

  async function gunzip(bytes) {
    if (typeof DecompressionStream !== "function")
      throw new Error("DecompressionStream unavailable");
    const stream = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("could not load " + src));
      document.head.appendChild(s);
    });
  }

  function parseStore(text) {
    const map = new Map();
    for (const rec of text.split(GS)) {
      const parts = rec.split(RS);
      const name = parts[0];
      if (!name) continue;
      const chapters = new Array(parts.length - 1);
      for (let i = 1; i < parts.length; i++) chapters[i - 1] = parts[i].split(US);
      map.set(name, chapters);
    }
    return map;
  }

  /* The standalone build has the data inlined already; the dev build pulls
     libs/kjv.b64.js in on first use.

     A script element, not fetch(): fetch() on a file:// page is blocked as a
     cross-origin request ("file: URLs are treated as unique security
     origins"), so fetching would break the dev index.html for anyone who
     opens it by double-clicking. Loading a script has no such restriction —
     it is how libs/pdf.min.js already gets in. Injecting it here rather than
     from a tag in index.html keeps it lazy, so opening a PDF costs nothing
     until a reference is actually hovered. */
  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (!window.__KJV_B64__) await loadScript("libs/kjv.b64.js");
      const b64 = window.__KJV_B64__;
      if (!b64) throw new Error("KJV data unavailable");
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      window.__KJV_B64__ = null;            // release the base64 string
      store = parseStore(await gunzip(bytes));
      return store;
    })();
    loadPromise.catch(() => { loadPromise = null; });
    return loadPromise;
  }

  function isLoaded() { return store !== null; }

  /* ---------- passage resolution ---------- */

  /* { label, verses:[{c,v,text}], truncated, missing } — needs load(). */
  function passage(ref) {
    if (!store) return null;
    const chapters = store.get(ref.book);
    if (!chapters) return { label: ref.label, verses: [], missing: true };

    const verses = [];
    let truncated = false;

    for (const s of ref.segs) {
      for (let c = s.c1; c <= s.c2 && !truncated; c++) {
        const chap = chapters[c - 1];
        if (!chap) continue;
        const from = c === s.c1 ? s.v1 : 1;
        const to = c === s.c2 ? Math.min(s.v2, chap.length) : chap.length;
        for (let v = from; v <= to; v++) {
          const text = chap[v - 1];
          if (text === undefined) continue;
          if (verses.length >= MAX_VERSES) { truncated = true; break; }
          verses.push({ c, v, text });
        }
      }
    }
    return { label: ref.label, verses, truncated, missing: verses.length === 0 };
  }

  return { findRefs, passage, load, isLoaded, CARRY_MAX_PAGES, MAX_VERSES };
})();
