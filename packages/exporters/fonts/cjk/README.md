# ICM CJK (Noto Sans SC)

The PDF exporter's faces for Chinese, Japanese kana and other CJK characters
(#2179). Metropolis, the serif and DejaVu Sans hold none, and a PDF cannot
borrow the system face the canvas and PNG draw them in, so without these the
PDF lost such text.

`ICMCJK-A.ttf` … `ICMCJK-N.ttf` are cut by `scripts/generate-cjk-pdf-faces.mjs`
from Noto Sans SC's variable TrueType file at
[google/fonts commit 5bb28733](https://github.com/google/fonts/blob/5bb28733cec313b63fbd415b574b5ae35c8aa8b8/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf)
(SHA-256 `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`):
its Regular instance, without hinting or layout tables, as TrueType outlines
with a format 4 cmap, which is what jsPDF embeds.

- `ICMCJK-A.ttf` (1.2 MB) holds CJK punctuation, kana, half- and full-width
  forms and the 3,755 everyday hanzi of GB 2312 level 1.
- `ICMCJK-B.ttf` to `ICMCJK-N.ttf` (30–700 kB, 6.1 MB together) hold the rest
  of U+3000–33FF, the CJK Unified Ideographs (U+4E00–9FFF), compatibility
  ideographs and vertical and compatibility forms, 1,500 characters to a face
  in code-point order.

The browser fetches a face only when a PDF export sets text in it; jsPDF then
embeds only the glyphs used. Extension A and beyond, Hangul syllables and
anything else no embedded face holds are left blank, and the export names
them.

Noto Sans SC is licensed under the [SIL Open Font License 1.1](LICENSE), which
permits redistribution and embedding; retain the license with distributed font
files. A subset is a Modified Version, and "Source" is the font's Reserved Font
Name, so the faces are named **ICM CJK**; their copyright, trademark and
license records are kept.
