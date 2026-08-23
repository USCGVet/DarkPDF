# DarkPDF

[![Build and deploy](https://github.com/USCGVet/DarkPDF/actions/workflows/pages.yml/badge.svg)](https://github.com/USCGVet/DarkPDF/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-informational.svg)](LICENSE)

A dark-mode PDF reader that's easy on the eyes. Pages render as soft warm-dark —
not pure black — with gentle off-white text.

[**Open the reader →**](https://uscgvet.github.io/DarkPDF/) &nbsp;·&nbsp;
[**Download the single-file version →**](https://uscgvet.github.io/DarkPDF/dist/DarkPDF.html)

Two ways to use it:

- **Online:** open the link above and drag a PDF onto the window. Files are read
  locally in your browser — nothing is uploaded anywhere.
- **Offline:** download `dist/DarkPDF.html` and double-click it. One self-contained
  file, no install, works with no internet connection at all.

Then drag any PDF onto the window, or press `Ctrl+O`.

## Why these colors

- **Not pure black, not pure white.** White-on-black at maximum contrast causes
  *halation* — bright strokes bloom and smear into the dark surround — for readers
  with astigmatism, which most glasses wearers have to some degree. DarkPDF caps
  the text luminance around `#E8E0CC` on a page ground near `#1C1A16` (≈11:1
  contrast — comfortably above the WCAG AAA 7:1 floor, well below the glare zone).
- **Warm tint.** The default "Warm dark" theme shifts the light text slightly
  toward amber, cutting the blue component that dominates intraocular scatter and
  suppresses melatonin during nighttime reading.
- **Hue fidelity.** Inversion is done as `invert(0.90) hue-rotate(180deg)
  sepia(0.22)` on the rendered canvas, so colored content keeps roughly its
  original hue (red stays red, blue stays blue) instead of flipping to complements.

## Features

- **Scripture on hover.** Scripture references in the text get a dotted
  underline; hover one to read the passage in the King James Version, click to
  pin it open so you can select and copy. The whole KJV ships inside the app —
  no lookups, no network, nothing about your reading leaves the machine. Toggle
  with the **Verses** switch or `V`. See
  [Scripture references](#scripture-references) for what it recognises.
- **Themes:** Warm dark (default), Soft gray, Midnight (near-black), Original —
  plus a page-brightness slider. Settings persist.
- **Photo passthrough:** photos are detected from the PDF's operator list and
  shown in their original colors instead of as negatives. Near-full-page images
  (scanned documents) are deliberately left dark so scans read as dark mode too.
  Toggle with the "Photos" switch.
- **Search** with match highlighting and next/prev navigation (`Ctrl+F`, `Enter`,
  `Shift+Enter`).
- Continuous scrolling, page thumbnails sidebar, fit-width / fit-page / free zoom
  (`Ctrl`+wheel), rotation, text selection, drag-and-drop open, password-protected
  PDFs, remembers your last position per file.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+O` | Open a PDF |
| `Ctrl+F` / `Enter` / `Shift+Enter` / `F3` | Search / next / previous match |
| `Ctrl`+wheel, `+` / `-` | Zoom (anchored at cursor) |
| `W` / `P` / `Ctrl+0` | Fit width / fit page |
| `←` `→`, `Home` / `End` | Previous/next page, first/last page |
| `R` / `T` | Rotate pages / toggle thumbnails |
| `V` | Toggle scripture references |
| `Esc` | Close a pinned passage |

## Scripture references

Written for reading biblical studies — commentaries, monographs, anything that
cites constantly and expects you to have the text at hand.

**Recognised**, in full names and standard abbreviations (SBL and common
variants), with `1`/`I`/`i` number prefixes:

| Form | Example |
| --- | --- |
| Single verse | `John 3:16`, `Gen. 1:1`, `Isa 7.14` |
| Range | `Isa 14:12–15` (en-dash or hyphen) |
| List | `Rom. 8:15, 23` |
| Cross-chapter | `Gen 1:1–2:3` |
| Numbered book | `1 Sam 23:1–14`, `II Cor 5:17`, `1Cor 13:4` |
| Book-less continuation | `Ezek. 28:13; 31:8–9` |
| Bare continuation | `v. 12`, `vv. 6–8`, `verse 28`, `verses 19–21` |

**Bare continuations** are the interesting case. Authors name a passage and then
discuss it by verse alone for pages afterwards, so a reference is resolved
against the last citation before it — including a chapter named on its own:

> …there are hints in **Genesis 3** that Eden is home to other divine beings.
> In **verse 22**, after Adam and Eve have sinned…

resolves to Genesis 3:22. Those get a **dashed** underline rather than a dotted
one, and the popover says which citation they continue, so an inference is never
presented as if the text said it outright. The trail is dropped after two pages,
on the grounds that a confidently wrong verse is worse than no verse.

**Deliberately not recognised:**

- **Bare chapters** (`Daniel 7`, `Job 1–2`). A whole chapter is not a tooltip.
  They still anchor continuations, they just aren't hoverable themselves.
- **Short abbreviations that are ordinary English words** — `Am`, `Is`, `Ac`,
  `So`, `Re`, `Mi`, `Da` and the like would fire on running prose. Forms needing
  a number prefix (`1 Co`, `2 Th`, `1 Ti`) are kept, since the prefix rules the
  English word out.
- **Impossible references.** Chapter counts are checked, so `Genesis 51:1` and
  `Jude 2:1` are rejected rather than shown as empty.

The KJV was chosen because it is public domain, so it can be bundled without a
licence or a lookup service. It is the only translation available, and quotations
in the book you are reading will often be from a different one — the popover
shows what the KJV says, not what the author quoted.

## Development

```
index.html                    app shell (dev version, loads libs/ separately)
app.css                       chrome + page styles
app.js                        viewer logic (rendering, themes, search, overlays)
kjv.js                        reference parsing + KJV lookup (no DOM code)
libs/                         PDF.js 3.11.174 (pdf.min.js + worker)
libs/kjv.b64.js               the KJV text, gzip+base64 in a .js file (generated)
tools/build_kjv.py            regenerates libs/kjv.b64.js from public-domain source
build.ps1                     inlines everything into dist/DarkPDF.html
test/make_sample.py           generates a feature-exercise PDF
test/test_refs.mjs            reference-parser tests (strings from real books)
test/test_passage.mjs         end-to-end KJV lookup through the inlined path
.github/workflows/pages.yml   builds and publishes the site on every push to main
```

Run the tests with `node` — no dependencies, no runner:

```bash
node test/test_refs.mjs && node test/test_passage.mjs
```

Dev loop: serve the folder and open the sample document.

```bash
python -m http.server 8123
```

Then visit `http://localhost:8123/index.html?url=test/sample.pdf`. Rebuild the
single-file distribution after source edits:

```bash
powershell -ExecutionPolicy Bypass -File build.ps1
```

Pushing to `main` rebuilds `dist/DarkPDF.html` from source on a Windows runner,
sanity-checks that PDF.js really got inlined, and redeploys the Pages site.

`libs/kjv.b64.js` is committed, so a normal build needs no network. Regenerate it
only if the source data changes:

```bash
python tools/build_kjv.py
```

It verifies 66 books and 31,102 verses and spot-checks known text before writing,
so a truncated download fails the build instead of shipping a Bible with holes.

The text ships as a `.js` file assigning a base64 global rather than a plain
`.gz`, so that `kjv.js` can pull it in with an injected `<script>` tag instead of
`fetch()`. `fetch()` is blocked on `file://` pages — they count as unique opaque
origins — which would break `index.html` for anyone who opens it straight off
disk; loading a script has no such restriction. It is requested in the background
once a document is open, alongside reference indexing, so the first hover is
instant — and not requested at all if the **Verses** toggle is off.

Notes: CJK PDFs fetch character maps from a CDN when online (rare glyph sets may
not display fully offline). The dark effect is display-only — the PDF itself and
text you copy out are untouched. Bundling the KJV takes the single file from
1.9 MB to 3.6 MB; reference indexing reads every page's text once in the
background after open, which for a 200-page book takes a second or two.

## License

MIT (see [LICENSE](LICENSE)). Bundles [PDF.js](https://github.com/mozilla/pdf.js),
which is Apache-2.0. The King James Version text is public domain, built from
[scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases).
