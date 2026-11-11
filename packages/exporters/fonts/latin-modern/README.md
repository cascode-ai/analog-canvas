# Latin Modern Roman

Latin Modern Roman 10 is the LaTeX-style schematic face a Document can choose
instead of Metropolis (#1725): the Computer Modern letters of LaTeX documents.

The four unmodified OpenType (CFF) files `lmroman10-{regular,bold,italic,bolditalic}.otf`,
version 2.004, are those TeX Live distributes in its `lm` package
(`texmf-dist/fonts/opentype/public/lm/`). Copyright 2003, 2009 B. Jackowski and
J. M. Nowacki (on behalf of TeX users groups); they are licensed under the
[GUST Font License](GUST-FONT-LICENSE.txt), that is the LaTeX Project Public
License 1.3c or later, with GUST's request that derived works be renamed.

`scripts/generate-schematic-fonts.mjs` derives two sets from them, over the
same Unicode ranges as Metropolis, and renames both **ICM Modern** (files and
name records; the copyright and license records are kept):

- `../ICMModern-*.schematic.woff2`: browser subsets, CFF outlines unchanged.
- `../ICMModern-*.ttf`: the same subsets with their cubic outlines converted to
  TrueType quadratics within 0.001 em (`scripts/convert-cff-to-truetype.py`),
  because jsPDF embeds TrueType only. The PDF exporter and Node raster use
  these.

Changes from the originals, in both: subset to those ranges, hinting removed,
family names renamed; in the TrueType set also the outline conversion. Advances
are unchanged. The faces hold no lowercase Greek; DejaVu Sans stays the
fallback for it and other symbols the face lacks, in the canvas, the metric
tables and the exports.
