# Formal Export

Status: `accepted`

Primary owners: `packages/render-svg`, `packages/exporters`

Every export starts from one validated `SchematicDocument`, one symbol
resolver and the formal SVG scene ([visual language](visual-language.md)),
using resolved route geometry. Overlays, hit targets, selection, flightlines
and diagnostics never enter a formal artifact.

| Format | Derivation                                  | Media type        |
| ------ | ------------------------------------------- | ----------------- |
| SVG    | canonical formal scene                      | `image/svg+xml`   |
| PNG    | white-background raster of that SVG at 3x   | `image/png`       |
| PDF    | browser: formal SVG converted to vector PDF | `application/pdf` |

## Rules

- The SVG viewBox is the page bound. All formats share one normalized base
  filename.
- Browser PDF converts the same SVG with `svg2pdf.js` into paths and text,
  working on a temporary clone (text decorations become strokes; legacy
  relative text constructs are expanded); it never embeds the PNG page cover
  or rewrites the downloaded SVG. Conversion failure fails visibly; no silent
  bitmap downgrade (SVG is the vector fallback). Node/headless keeps a
  raster-PDF fallback for release tooling only.
- Fonts: pinned Metropolis (approximating the references' Proxima Nova) plus
  DejaVu Sans for Greek/math, subset to WOFF2 in `packages/exporters/fonts/`
  with advance/ink tables from `scripts/generate-schematic-fonts.mjs`; the
  round-period face stays first for full stops. Canvas, browser PNG and Node
  raster use these glyphs (Node via composite faces that keep weight and
  slant across mixed runs). Browser PNG inlines the faces (an SVG image loads
  no external font), falling back to system faces if unreadable. Downloaded
  SVG names the stack and carries only the period face.
- A Document with `presentation.textFace: "serif"` sets every text in
  Liberation Serif (Times New Roman's metrics) instead, everywhere above: the
  browser serves renamed subsets as **ICM Serif** (OFL Reserved Font Name),
  measured from the same tables; the formal SVG root carries
  `data-text-face="serif"` and names the serif stack; PNG inlines ICM Serif
  and DejaVu only; PDF embeds the unmodified Liberation Serif files. No round
  period. One face per Document; Metropolis stays the default.
- PDF selects Metropolis, DejaVu or the period face per glyph and embeds each
  used weight/slant as a subset (PDF has no CSS fallback); faces are loaded
  for measurement and removed after. A missing required face fails the
  export. Glyphs in neither family (e.g. CJK) are outside PDF coverage.
- Canonical SVG resolves scripts to numeric font sizes and explicit baseline
  displacement, and the next visible run restores the parent baseline; never
  `baseline-shift` or percentage `font-size` (Office-class importers mishandle
  them).

## Validation

- SVG viewBox parses to valid bounds; formal SVG has no editor-only layers,
  no `baseline-shift` or percentage `font-size`, and restores baselines after
  scripts.
- PNG signature and dimensions equal viewBox × scale.
- Browser PDF reopens with one page of the right bounds, no page-cover image
  XObject, rich-text runs with nonzero scaled fonts and displaced baselines,
  and a rendered page visually matching the SVG fixture.
