"""Compose the pinned schematic faces for resvg's single-face text shaping."""
import copy
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from fontTools.merge import Merger
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem

primary_dir, fallback_dir, period_path, destination = map(Path, sys.argv[1:])
period = TTFont(period_path, recalcTimestamp=False)
for style, fallback_style in [
    ("Regular", ""), ("RegularItalic", "-Oblique"),
    ("Bold", "-Bold"), ("BoldItalic", "-BoldOblique"),
]:
    primary_path = primary_dir / f"Metropolis-{style}.ttf"
    primary = TTFont(primary_path, recalcTimestamp=False)
    fallback = TTFont(fallback_dir / f"DejaVuSans{fallback_style}.ttf", recalcTimestamp=False)
    fallback_notice = fallback["name"].getDebugName(13)
    fallback_copyright = fallback["name"].getDebugName(0)
    scale_upem(fallback, primary["head"].unitsPerEm)
    options = Options()
    options.hinting = False
    subset = Subsetter(options=options)
    subset.populate(unicodes=set(fallback.getBestCmap()) - set(primary.getBestCmap()))
    subset.subset(fallback)
    # The fallback supplies outlines and advances; preserve the primary's
    # shaping tables. resvg does not use OpenType MATH layout tables.
    for tag in ["MATH", "GSUB", "GPOS", "GDEF", "kern"]:
        if tag in fallback:
            del fallback[tag]
    with TemporaryDirectory() as scratch:
        fallback_path = Path(scratch) / "fallback.ttf"
        fallback.save(fallback_path)
        merged = Merger().merge([str(primary_path), str(fallback_path)])
    merged.recalcTimestamp = False
    # Keep the original period outline: composite glyphs such as ellipsis
    # reference it. Only the Unicode period should use our authored dot.
    glyph = "icmRoundPeriod"
    source_glyph = period.getBestCmap()[ord(".")]
    merged.setGlyphOrder([*merged.getGlyphOrder(), glyph])
    merged["glyf"][glyph] = copy.deepcopy(period["glyf"][source_glyph])
    merged["hmtx"][glyph] = period["hmtx"][source_glyph]
    for table in merged["cmap"].tables:
        if table.isUnicode() and ord(".") in table.cmap:
            table.cmap[ord(".")] = glyph
    merged["name"] = copy.deepcopy(primary["name"])
    merged["OS/2"] = copy.deepcopy(primary["OS/2"])
    for field in ["created", "modified", "macStyle"]:
        setattr(merged["head"], field, getattr(primary["head"], field))
    for record in merged["name"].names:
        replacements = {
            0: (primary["name"].getDebugName(0) or "") + "\n" + (fallback_copyright or ""),
            1: "ICM Schematic", 16: "ICM Schematic",
            4: f"ICM Schematic {style}", 6: f"ICMSchematic-{style}",
            13: (primary["name"].getDebugName(13) or "Metropolis: Unlicense.")
                + "\n\nDejaVu fallback:\n" + (fallback_notice or ""),
        }
        if record.nameID in replacements:
            record.string = replacements[record.nameID].encode(record.getEncoding(), errors="replace")
    # Keep attribution inside the derived face even if the primary omitted it.
    merged["name"].setName(replacements[13], 13, 3, 1, 0x409)
    merged.save(destination / f"ICMSchematic-{style}.ttf")
