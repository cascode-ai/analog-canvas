"""Give a derived font its own family name, in place.

    python3 scripts/rename-font-family.py FONT OLD_FAMILY NEW_FAMILY [OLD NEW ...]

Called by generate-schematic-fonts.mjs on the subsets of a face whose license
reserves its name for unmodified copies (the OFL's Reserved Font Name) or asks
that modified copies be renamed (the GUST Font License): every name record
spelling OLD_FAMILY, or its PostScript form without spaces, spells NEW_FAMILY
instead, each pair in turn. The copyright, trademark and license records are
kept as published.
"""
import sys

from fontTools.ttLib import TTFont

path, *names = sys.argv[1:]
pairs = list(zip(names[::2], names[1::2]))
assert pairs and len(names) % 2 == 0, "name OLD NEW pairs"
KEPT = {0, 7, 13, 14}  # copyright, trademark, license, license URL

# Keep the head table's timestamp, so the generator's check can rebuild the
# same bytes.
font = TTFont(path, recalcTimestamp=False)
for record in font["name"].names:
    if record.nameID in KEPT:
        continue
    text = record.toUnicode()
    renamed = text
    for old_family, new_family in pairs:
        renamed = renamed.replace(old_family, new_family).replace(
            old_family.replace(" ", ""), new_family.replace(" ", "")
        )
    if renamed != text:
        record.string = renamed
font.save(path)
