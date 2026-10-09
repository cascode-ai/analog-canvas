"""Read schematic advances, ink bearings and coverage from the shipped faces.

Called by generate-schematic-fonts.mjs; fontTools is a local generation dependency.
No font files are modified here. Measurements use em so the two families' units
per em need not agree. Italic faces retain their own advances.
"""
import json
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

primary_dir, fallback_dir, ranges_json = sys.argv[1:]
ranges = json.loads(ranges_json)


def served(codepoint):
    for item in ranges:
        bounds = item.removeprefix("U+").split("-")
        if int(bounds[0], 16) <= codepoint <= int(bounds[-1], 16):
            return True
    return False


faces = [
    ("plain", "Regular", ""),
    ("bold", "Bold", "-Bold"),
    ("italic", "RegularItalic", "-Oblique"),
    ("boldItalic", "BoldItalic", "-BoldOblique"),
]
fonts = {}
for style, primary, fallback in faces:
    fonts[style] = (
        TTFont(Path(primary_dir) / f"Metropolis-{primary}.ttf"),
        TTFont(Path(fallback_dir) / f"DejaVuSans{fallback}.ttf"),
    )

primary_coverage = sorted(
    point for point in fonts["plain"][0].getBestCmap() if served(point)
)
for style, (primary, _) in fonts.items():
    assert primary_coverage == sorted(
        point for point in primary.getBestCmap() if served(point)
    ), f"Metropolis {style} has different coverage"

# Keep the previously measured Greek and math symbols; Latin now covers the
# entire served primary face, including accents and the micro sign.
previous_symbols = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψω°±×÷−√∞≈≠≤≥"
glyphs = sorted(set(primary_coverage) | {ord(c) for c in previous_symbols})
metrics = {"glyphs": "".join(chr(c) for c in glyphs)}
for style, (primary, fallback) in fonts.items():
    advances, bearings = [], []
    for point in glyphs:
        font = primary if point in primary.getBestCmap() else fallback
        glyph_name = font.getBestCmap()[point]
        advance, _ = font["hmtx"][glyph_name]
        glyph = font["glyf"][glyph_name]
        units = font["head"].unitsPerEm
        advances.append(advance / units)
        bearings.extend([
            getattr(glyph, "xMin", 0) / units,
            (advance - getattr(glyph, "xMax", advance)) / units,
        ])
    metrics[style] = {"advances": advances, "bearings": bearings}

print(json.dumps({
    "metrics": metrics,
    "primaryGlyphs": "".join(chr(c) for c in primary_coverage),
}, ensure_ascii=False))
