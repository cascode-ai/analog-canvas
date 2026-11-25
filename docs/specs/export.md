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
  working on a temporary clone (a CSS overline left in the SVG becomes a
  stroke in the shared bar geometry; legacy relative text constructs are
  expanded); it never embeds the PNG page cover
  or rewrites the downloaded SVG. Conversion failure fails visibly; no silent
  bitmap downgrade (SVG is the vector fallback). Node/headless keeps a
  raster-PDF fallback for release tooling only.
- Fonts: pinned Metropolis (approximating the references' Proxima Nova), its
  Greek **ICM Greek** (DejaVu Sans's Greek drawn to Metropolis's cap height,
  x height, depth and stem weight; served as Metropolis for U+0370–03FF) and
  DejaVu Sans for math, subset to WOFF2 in `packages/exporters/fonts/`
  with advance/ink tables from `scripts/generate-schematic-fonts.mjs`; the
  round-period face stays first for full stops. Canvas, browser PNG and Node
  raster use these glyphs (Node via composite faces that keep weight and
  slant across mixed runs). Browser PNG inlines the faces (an SVG image loads
  no external font), falling back to system faces if unreadable. A
  downloaded SVG (editor export, Agent and local `export_file`, the local
  workspace, `pnpm gallery:dataset`, Gallery `preview.svg`) embeds, once per
  weight and style its text uses, a HarfBuzz subset of the Node composite face
  (**ICM Schematic**) holding only the characters it writes, in place of the
  period faces, so it draws as the PNG does on any computer; a Document face
  other than Metropolis still names its stack only. The subset takes
  Metropolis's line metrics (hhea from OS/2 typographic values), so browsers
  size text boxes as the editor measures them. The Worker embeds once per
  preview revision (its CSP allows `font-src data:`), and serves the stored
  SVG, uncached, when it cannot.
- A Document's `presentation.textFace` sets every text in another face
  instead, everywhere above. Each is served as renamed subsets (an OFL Reserved
  Font Name or the GUST Font License's renaming request), measured from its
  own tables:

  | `textFace`       | Face (metrics)                     | Served as      | PDF embeds                        |
  | ---------------- | ---------------------------------- | -------------- | --------------------------------- |
  | `"serif"`        | Liberation Serif (Times New Roman) | **ICM Serif**  | unmodified Liberation Serif       |
  | `"sans"`         | Liberation Sans (Arial)            | **ICM Sans**   | unmodified Liberation Sans        |
  | `"latin-modern"` | Latin Modern Roman 10 (LaTeX)      | **ICM Modern** | ICM Modern as TrueType (from CFF) |

  The formal SVG root carries `data-text-face="<textFace>"` and names the
  face's stack (served name, original name, metric twin such as Times New
  Roman or Arial, DejaVu Sans); PNG inlines that face and DejaVu only; Node
  raster uses the PDF's files, so there a Latin Modern run holding a glyph
  the face lacks (lowercase Greek) draws whole in a fallback face. No round
  period. One face per Document; Metropolis stays the default.

- PDF selects the Document's face, DejaVu or (Metropolis only) ICM Greek or
  the period face per glyph and embeds each used weight/slant as a subset (PDF has no
  CSS fallback); faces are loaded for measurement and removed after. CJK characters, which the canvas draws in
  a system face, take the ICM CJK faces (Noto Sans SC Regular cut by code
  point, `packages/exporters/fonts/cjk/`), fetched only for an export that
  uses them; they have one weight, so bold or italic CJK is set regular. A
  missing required face fails the export. A character no chosen face's cmap
  holds (e.g. Hangul, emoji) is written as a blank of about its width and
  the PDF still saves, but the export never reports it complete: the editor
  status and the Agent download's `warnings` name the characters left out
  and point to SVG or PNG, which keep them. A download request without
  `includeWarnings` (clients released before `warnings`, which refuse a
  field they do not know) is refused instead, naming them. Invisible
  characters (joiners, variation selectors) are not named.
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
