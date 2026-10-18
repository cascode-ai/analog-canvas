"""Give a derived font its own family name, in place.

    python3 scripts/rename-font-family.py FONT OLD_FAMILY NEW_FAMILY

Called by generate-schematic-fonts.mjs on the browser subsets of a face whose
license reserves its name for unmodified copies (the OFL's Reserved Font
Name): every name record spelling OLD_FAMILY, or its PostScript form without
spaces, spells NEW_FAMILY instead. The copyright, trademark and license
records are kept as published.
"""
import sys

from fontTools.ttLib import TTFont

path, old_family, new_family = sys.argv[1:]
KEPT = {0, 7, 13, 14}  # copyright, trademark, license, license URL

# Keep the head table's timestamp, so the generator's check can rebuild the
# same bytes.
font = TTFont(path, recalcTimestamp=False)
for record in font["name"].names:
    if record.nameID in KEPT:
        continue
    text = record.toUnicode()
    renamed = text.replace(old_family, new_family).replace(
        old_family.replace(" ", ""), new_family.replace(" ", "")
    )
    if renamed != text:
        record.string = renamed
font.save(path)
