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

## Development

```
index.html                    app shell (dev version, loads libs/ separately)
app.css                       chrome + page styles
app.js                        viewer logic (rendering, themes, search, overlays)
libs/                         PDF.js 3.11.174 (pdf.min.js + worker)
build.ps1                     inlines everything into dist/DarkPDF.html
test/make_sample.py           generates a feature-exercise PDF
.github/workflows/pages.yml   builds and publishes the site on every push to main
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

Notes: CJK PDFs fetch character maps from a CDN when online (rare glyph sets may
not display fully offline). The dark effect is display-only — the PDF itself and
text you copy out are untouched.

## License

MIT (see [LICENSE](LICENSE)). Bundles [PDF.js](https://github.com/mozilla/pdf.js),
which is Apache-2.0.
