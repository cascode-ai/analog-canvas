# Metropolis

Chris Simpson's Metropolis is the open-source schematic typeface selected to
approximate the Proxima Nova Bold / Bold Italic lettering in the user's Razavi
reference figures 8.39, 8.41 and 8.45. It is an approximation, not Proxima Nova.

The four unmodified TrueType files come from
[typehaus/metropolis, commit 28cdaaaa](https://github.com/typehaus/metropolis/tree/28cdaaaad51bb3d4623e17f18413a1584659fb2f/dist/ttf).
The upstream [Unlicense](LICENSE.txt) permits redistribution and embedding.
These sources feed the PDF and Node exporters; `scripts/generate-schematic-fonts.mjs`
creates the browser subsets and shared advance/ink tables from them. Retain this
notice and the license with distributed font files.

Every derived face (the browser subsets and the Node faces below) maps the
underscore to an unkerned copy of its glyph. Metropolis kerns the underscore by
about a third of an em against most letters on both sides, so `CMD_P` drew the
underscore under the P; labels are measured by advances alone. The step is
`scripts/unkern-metropolis-underscore.py`, run by the generator on a temporary
copy; the four TrueType files here stay as published. The PDF exporter embeds
those originals, and jsPDF applies no kerning.

Metropolis has Latin coverage. DejaVu Sans remains the explicit fallback for
Greek and mathematical symbols in the canvas, metric tables and exports.

`../ICMSchematic-*.ttf` are generated Node-only composite faces named **ICM
Schematic**: Metropolis outlines, missing symbols from the matching DejaVu Sans
face, and the authored round period. resvg can otherwise reshape a mixed-family
run in a regular fallback face and lose its requested bold/italic. The generator
preserves the primary advances and shaping, scales fallback outlines to the same
em, and retains both source notices in the derived faces. DejaVu's license permits
modified fonts under a name without “Bitstream” or “Vera”; the full license also
ships in the `dejavu-fonts-ttf` dependency. Regenerate through
`node scripts/generate-schematic-fonts.mjs`; the originals above remain unchanged.
