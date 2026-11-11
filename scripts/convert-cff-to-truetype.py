"""Write a CFF-flavoured OpenType face as TrueType outlines, in place.

    python3 scripts/convert-cff-to-truetype.py FONT

Called by generate-schematic-fonts.mjs on the PDF subsets of a face published
only as CFF OpenType (Latin Modern Roman): jsPDF embeds TrueType outlines
only. Each cubic outline becomes quadratic within a thousandth of an em;
advances, the character map and every name record are kept, and the head
table's timestamp too, so the generator's check can rebuild the same bytes.
"""
import sys

from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable

(path,) = sys.argv[1:]
font = TTFont(path, recalcTimestamp=False)
assert font.sfntVersion == "OTTO" and "CFF " in font, f"{path} is not CFF"

order = font.getGlyphOrder()
glyph_set = font.getGlyphSet()
units = font["head"].unitsPerEm
glyphs = {}
for name in order:
    pen = TTGlyphPen(glyph_set)
    # TrueType winds outer contours clockwise, CFF counter-clockwise.
    glyph_set[name].draw(Cu2QuPen(pen, units / 1000, reverse_direction=True))
    glyphs[name] = pen.glyph()

font["loca"] = newTable("loca")
glyf = font["glyf"] = newTable("glyf")
glyf.glyphOrder = order
glyf.glyphs = glyphs
del font["CFF "]
glyf.compile(font)

# The left side bearing is the outline's new left edge.
hmtx = font["hmtx"]
for name, glyph in glyphs.items():
    advance, _ = hmtx[name]
    hmtx[name] = (advance, getattr(glyph, "xMin", 0))

maxp = font["maxp"] = newTable("maxp")
maxp.tableVersion = 0x00010000
for field in (
    "maxZones",
    "maxTwilightPoints",
    "maxStorage",
    "maxFunctionDefs",
    "maxInstructionDefs",
    "maxStackElements",
    "maxSizeOfInstructions",
    "maxComponentElements",
):
    setattr(maxp, field, 0)
maxp.maxZones = 1

post = font["post"]
post.formatType = 2.0
post.extraNames = []
post.mapping = {}
post.glyphOrder = order

font.sfntVersion = "\0\1\0\0"
font.save(path)
