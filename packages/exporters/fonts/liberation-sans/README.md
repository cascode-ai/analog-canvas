# Liberation Sans

Liberation Sans is the Arial-style schematic face a Document can choose instead
of Metropolis (#1725): figures set in Arial get the same letters, since
Liberation Sans is metric-compatible with it (every glyph has Arial's advance).

The four unmodified TrueType files come from the
[liberationfonts/liberation-fonts 2.1.5 release](https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5),
`liberation-fonts-ttf-2.1.5.tar.gz` (SHA-256
`7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0`), the same
release as `../liberation-serif/`. They are licensed under the
[SIL Open Font License 1.1](LICENSE), which permits redistribution and
embedding; retain the license with distributed font files. The PDF exporter and
Node raster use these originals.

`../ICMSans-*.schematic.woff2` are the browser subsets
`scripts/generate-schematic-fonts.mjs` writes from them, over the same Unicode
ranges as Metropolis. A subset is a Modified Version under the OFL, and
"Liberation" is a Reserved Font Name, so the subsets are renamed **ICM Sans**;
their copyright and license records are kept. DejaVu Sans stays the fallback
for symbols the face lacks, in the canvas, the metric tables and the exports.
