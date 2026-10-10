"""Copy the Metropolis faces with an underscore that nothing kerns.

    python3 scripts/unkern-metropolis-underscore.py <source dir> <destination dir>

Metropolis kerns the underscore by about a third of an em against most
letters on both sides, so "CMD_P" draws the underscore under the P. A label
is measured by glyph advances alone, and a schematic name reads its
underscore as a character. The copy maps U+005F to a duplicate of the
underscore glyph that no kerning pair names; the original glyph stays for
anything else that references it, and the source files stay unmodified.
"""

import copy
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

FACES = ["Regular", "Bold", "RegularItalic", "BoldItalic"]
UNDERSCORE = 0x5F
UNKERNED = "underscore.unkerned"


def unkern(source: Path, destination: Path) -> None:
    font = TTFont(source, recalcTimestamp=False)
    original = font.getBestCmap()[UNDERSCORE]
    font.setGlyphOrder([*font.getGlyphOrder(), UNKERNED])
    font["glyf"][UNKERNED] = copy.deepcopy(font["glyf"][original])
    font["hmtx"][UNKERNED] = font["hmtx"][original]
    for table in font["cmap"].tables:
        if table.isUnicode() and UNDERSCORE in table.cmap:
            table.cmap[UNDERSCORE] = UNKERNED
    font.save(destination)


def main() -> None:
    source_dir, destination_dir = (Path(arg) for arg in sys.argv[1:3])
    for style in FACES:
        name = f"Metropolis-{style}.ttf"
        unkern(source_dir / name, destination_dir / name)


if __name__ == "__main__":
    main()
