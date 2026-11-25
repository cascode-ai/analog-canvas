"""Greek for Metropolis: DejaVu Sans's Greek drawn to Metropolis's proportions.

Called by generate-schematic-fonts.mjs. Metropolis has no Greek, and DejaVu's
stands taller than Metropolis's Latin (capitals 0.729 em against 0.687, x
height 0.547 against 0.517), reaches deeper (0.208 em against 0.172), and its
bold is heavier, so a bold phi filled in at label size (#2619). Each face here
takes DejaVu's Greek, scales capitals to Metropolis's cap height and the rest
to its x height, brings descenders to Metropolis's depth, and thins the
strokes (bold most) so they weigh what Metropolis's do and counters stay open.

    python3 generate-schematic-greek.py <metropolis dir> <dejavu dir> <destination>

Writes ICMGreek-<style>.ttf, a Greek-only face at Metropolis's units per em,
renamed as the Bitstream Vera licence asks of a modified copy, with DejaVu's
copyright and licence kept in its name records. Needs skia-pathops.
"""
import sys
from pathlib import Path

import pathops
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem

GREEK = range(0x0370, 0x0400)
# Style, its Metropolis and DejaVu faces, and the em each stroke loses on
# either side: DejaVu Bold's stems are 0.165 em at Metropolis's size against
# Metropolis Bold's 0.146, and its counters fill in first.
STYLES = [
    ("Regular", "Metropolis-Regular", "DejaVuSans", 0.005),
    ("Bold", "Metropolis-Bold", "DejaVuSans-Bold", 0.016),
    ("Italic", "Metropolis-RegularItalic", "DejaVuSans-Oblique", 0.005),
    ("BoldItalic", "Metropolis-BoldItalic", "DejaVuSans-BoldOblique", 0.016),
]


def bounds(font, char):
    glyph_set = font.getGlyphSet()
    pen = BoundsPen(glyph_set)
    glyph_set[font.getBestCmap()[ord(char)]].draw(pen)
    return pen.bounds


class MapPen(BasePen):
    """Draws into `out` with every point passed through `transform`."""

    def __init__(self, out, transform):
        super().__init__(None)
        self.out, self.transform = out, transform

    def _moveTo(self, pt):
        self.out.moveTo(self.transform(pt))

    def _lineTo(self, pt):
        self.out.lineTo(self.transform(pt))

    def _qCurveToOne(self, pt1, pt2):
        self.out.qCurveTo(self.transform(pt1), self.transform(pt2))

    def _curveToOne(self, pt1, pt2, pt3):
        self.out.curveTo(*map(self.transform, (pt1, pt2, pt3)))

    def _closePath(self):
        self.out.closePath()

    def _endPath(self):
        self.out.endPath()


def thinned(path, amount):
    """`path` with `amount` font units taken off every side of its strokes."""
    if amount <= 0:
        return path
    edge = pathops.Path(path)
    edge.stroke(amount * 2, pathops.LineCap.BUTT_CAP, pathops.LineJoin.ROUND_JOIN, 4)
    edge.convertConicsToQuads()
    result = pathops.op(path, edge, pathops.PathOp.DIFFERENCE)
    result.convertConicsToQuads()
    return result


def greek_face(metropolis_path, dejavu_path, thin):
    """Metropolis's face and the Greek drawn for it, at its units per em."""
    primary = TTFont(metropolis_path, recalcTimestamp=False)
    face = TTFont(dejavu_path, recalcTimestamp=False)
    upem = primary["head"].unitsPerEm
    scale_upem(face, upem)
    options = Options()
    options.hinting = False
    options.name_IDs = ["*"]
    options.layout_features = []
    options.drop_tables += ["FFTM"]
    subset = Subsetter(options=options)
    subset.populate(unicodes=[c for c in face.getBestCmap() if c in GREEK])
    subset.subset(face)
    for tag in ["MATH", "GSUB", "GPOS", "GDEF", "kern"]:
        if tag in face:
            del face[tag]

    # Thinning takes `edge` off every side, so each glyph is first drawn that
    # much larger: its ink then ends on Metropolis's baseline, cap height,
    # x height and depth, and within its advance as scaled.
    edge = thin * upem
    cap = bounds(primary, "H")[3], bounds(face, "Η")[3]
    x_height = bounds(primary, "x")[3], bounds(face, "κ")[3]
    depth = bounds(primary, "p")[1] / bounds(face, "ρ")[1]
    capitals = {
        name for code, name in face.getBestCmap().items() if chr(code).isupper()
    }

    glyph_set = face.getGlyphSet()
    glyf, hmtx = face["glyf"], face["hmtx"]
    drawn = {}
    for name in face.getGlyphOrder():
        if name == ".notdef":
            continue
        target, source = cap if name in capitals else x_height
        scale = target / source
        advance = round(hmtx[name][0] * scale)
        widen = (advance + 2 * edge) / advance if advance else 1
        # Above the baseline the glyph keeps DejaVu's proportions at the new
        # size; below it a descender reaches Metropolis's depth.
        above = (target + 2 * edge) / source
        below = min(above, depth)

        def transform(point, s=scale * widen, a=above, b=below, e=edge):
            x, y = point
            return (round(x * s - e), round(y * (a if y >= 0 else b) - e))

        recording = DecomposingRecordingPen(glyph_set)
        glyph_set[name].draw(recording)
        path = pathops.Path()
        recording.replay(MapPen(path.getPen(), transform))
        pen = TTGlyphPen(None)
        thinned(path, edge).draw(Cu2QuPen(pen, 1, reverse_direction=False))
        drawn[name] = (pen.glyph(), advance)
    for name, (glyph, advance) in drawn.items():
        glyf[name] = glyph
        glyph.recalcBounds(glyf)
        hmtx[name] = (advance, getattr(glyph, "xMin", 0))
    face["OS/2"].sCapHeight = primary["OS/2"].sCapHeight
    face["OS/2"].sxHeight = primary["OS/2"].sxHeight
    for field in ["created", "modified"]:
        setattr(face["head"], field, getattr(primary["head"], field))
    return face


def rename(face, dejavu, style):
    """Name the face ICM Greek, keeping DejaVu's copyright and licence."""
    names = {
        0: dejavu["name"].getDebugName(0) or "",
        1: "ICM Greek",
        2: "Bold Italic" if style == "BoldItalic" else style,
        3: f"ICM Greek {style}",
        4: f"ICM Greek {style}",
        6: f"ICMGreek-{style}",
        13: dejavu["name"].getDebugName(13) or "",
        14: dejavu["name"].getDebugName(14) or "",
        16: "ICM Greek",
    }
    table = face["name"]
    table.names = [
        record
        for record in table.names
        if record.nameID not in names and record.nameID not in (17, 21, 22)
    ]
    for name_id, value in names.items():
        if value:
            table.setName(value, name_id, 3, 1, 0x409)


if __name__ == "__main__":
    metropolis_dir, dejavu_dir, destination = map(Path, sys.argv[1:4])
    for style, metropolis, dejavu, thin in STYLES:
        source = dejavu_dir / f"{dejavu}.ttf"
        face = greek_face(metropolis_dir / f"{metropolis}.ttf", source, thin)
        rename(face, TTFont(source), style)
        face.recalcTimestamp = False
        face.save(destination / f"ICMGreek-{style}.ttf")
