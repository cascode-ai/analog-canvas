"""Cut the PDF exporter's CJK faces from Noto Sans SC (#2179).

    python3 scripts/generate-cjk-pdf-faces.py SOURCE OUTPUT_DIRECTORY

Called by generate-cjk-pdf-faces.mjs. SOURCE is the variable Noto Sans SC.
Its Regular instance is cut into TrueType faces jsPDF can embed: the first
holds CJK punctuation, kana, full-width forms and the 3,755 everyday hanzi of
GB 2312 level 1, so most drawings fetch one face; the other ideographs follow
in code-point order, SLICE_GLYPHS to a face. jsPDF reads only a format 4
cmap, so the faces stay in the Basic Multilingual Plane. Prints the cut as
JSON: the first face's characters and each later face's first code point.

A subset is a Modified Version under the OFL and "Source" is its Reserved
Font Name; the faces are named ICM CJK, with the copyright, trademark and
license records kept as published.
"""
import io
import json
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# Keep in step with CJK_BLOCKS in packages/exporters/src/cjk-pdf-faces.ts.
BLOCKS = [
    (0x3000, 0x33FF),  # punctuation, kana, bopomofo, enclosed and squared forms
    (0x4E00, 0x9FFF),  # CJK Unified Ideographs
    (0xF900, 0xFAFF),  # compatibility ideographs
    (0xFE10, 0xFE1F),  # vertical forms
    (0xFE30, 0xFE4F),  # compatibility forms
    (0xFF00, 0xFFEF),  # half-width and full-width forms
]
SLICE_GLYPHS = 1500
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
KEPT_NAMES = {0, 7, 13, 14}  # copyright, trademark, license, license URL


def gb2312_level_1():
    """The level-1 hanzi, rows 16 to 55 of GB 2312."""
    out = []
    for high in range(0xB0, 0xD8):
        for low in range(0xA1, 0xFF):
            try:
                out.append(ord(bytes([high, low]).decode("gb2312")))
            except UnicodeDecodeError:
                pass
    return out


def name_face(font, letter):
    family = f"ICM CJK {letter}"
    names = {
        1: family,
        2: "Regular",
        3: f"ICMCJK-{letter};{font['head'].fontRevision:.3f}",
        4: family,
        6: f"ICMCJK-{letter}",
    }
    table = font["name"]
    table.names = [
        record
        for record in table.names
        if record.nameID in KEPT_NAMES or record.nameID == 5
    ]
    for name_id, text in names.items():
        table.setName(text, name_id, 3, 1, 0x409)


def cut(regular, unicodes, letter, path):
    font = TTFont(io.BytesIO(regular), recalcTimestamp=False)
    options = subset.Options()
    options.hinting = False
    options.layout_features = []
    options.drop_tables += ["GSUB", "GPOS", "GDEF", "BASE", "vhea", "vmtx", "STAT"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    # jsPDF reads the format 4 table alone.
    font["cmap"].tables = [
        table for table in font["cmap"].tables if table.format == 4
    ]
    name_face(font, letter)
    font.save(path)


def main():
    source, output = sys.argv[1:]
    font = TTFont(source, recalcTimestamp=False)
    created = font["head"].created
    regular = instancer.instantiateVariableFont(font, {"wght": 400})
    regular["head"].modified = created
    buffer = io.BytesIO()
    regular.save(buffer)
    regular_bytes = buffer.getvalue()

    held = sorted(
        point
        for point in regular.getBestCmap()
        if any(first <= point <= last for first, last in BLOCKS)
    )
    everyday = set(gb2312_level_1())
    common = [
        point
        for point in held
        if point < 0x3100 or point >= 0xFF00 or point in everyday
    ]
    first = set(common)
    rest = [point for point in held if point not in first]
    slices = [common] + [
        rest[start : start + SLICE_GLYPHS]
        for start in range(0, len(rest), SLICE_GLYPHS)
    ]
    if len(slices) > len(LETTERS):
        raise SystemExit("More CJK faces than letters to name them")
    for index, unicodes in enumerate(slices):
        letter = LETTERS[index]
        cut(regular_bytes, unicodes, letter, f"{output}/ICMCJK-{letter}.ttf")
    json.dump(
        {
            "common": "".join(chr(point) for point in common),
            "starts": [unicodes[0] for unicodes in slices[1:]],
            "faces": len(slices),
        },
        sys.stdout,
        ensure_ascii=False,
    )


main()
