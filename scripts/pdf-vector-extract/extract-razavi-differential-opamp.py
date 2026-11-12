#!/usr/bin/env python3
"""Extract the fully-differential op-amp body from Razavi Figure 13.48.

This is deliberately a PDF-vector extractor.  Raster comparison remains in
scripts/calibration/razavi; this tool only records the immutable source evidence
and a source-PDF raster witness.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import pdfplumber
from PIL import Image


EXPECTED_PDF_SHA256 = "a6031d1149c2c6191a1f0e541065165b72dafc4bc4ab4b0ea37af41b7cb0f739"
PDF_PAGE = 583
PRINTED_PAGE = 564
FIGURE = "13.48"
NORMAL_LINE_WIDTH_PT = 0.717
TRIANGLE_LINE_WIDTH_PT = 1.434
RASTER_DPI = 300.0
RASTER_PADDING_PT = 0.75

TRIANGLE_POINTS = [
    (269.294, 452.3592),
    (269.294, 486.7672),
    (309.437, 469.5642),
    (269.294, 452.3592),
]
LINES = {
    "input-plus": ((255.630, 458.0942), (269.249, 458.0942)),
    "input-minus": ((255.630, 481.0332), (269.249, 481.0332)),
    "output-minus": ((283.048, 458.0942), (307.421, 458.0942)),
    "output-plus": ((282.735, 481.0332), (307.107, 481.0332)),
    "input-plus-vertical": ((273.596, 458.8112), (273.596, 463.1122)),
    "input-plus-horizontal": ((271.445, 460.9612), (275.746, 460.9612)),
    "input-minus-horizontal": ((271.445, 478.1642), (275.746, 478.1642)),
    "output-minus-horizontal": ((277.897, 460.9612), (282.197, 460.9612)),
    "output-plus-vertical": ((280.047, 476.0152), (280.047, 480.3162)),
    "output-plus-horizontal": ((277.897, 478.1642), (282.197, 478.1642)),
}


def fail(message: str) -> None:
    raise RuntimeError(f"Razavi differential-opamp PDF extraction: {message}")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def rounded(value: float) -> float:
    value = round(value, 6)
    return 0.0 if value == -0.0 else value


def point(value: Any) -> tuple[float, float]:
    return float(value[0]), float(value[1])


def close(left: tuple[float, float], right: tuple[float, float]) -> bool:
    return math.hypot(left[0] - right[0], left[1] - right[1]) <= 0.02


def path_points(path: list[Any]) -> list[tuple[float, float]]:
    return [point(value) for item in path for value in item[1:]]


def find_line(page: Any, start: tuple[float, float], end: tuple[float, float]) -> dict[str, Any]:
    matches = []
    for line in page.lines:
        path = line.get("path") or []
        if len(path) != 2 or abs(float(line.get("linewidth", 0)) - NORMAL_LINE_WIDTH_PT) > 0.001:
            continue
        actual = point(path[0][1]), point(path[1][1])
        if (close(actual[0], start) and close(actual[1], end)) or (close(actual[0], end) and close(actual[1], start)):
            matches.append(line)
    if len(matches) != 1:
        fail(f"expected one line {start}->{end}, found {len(matches)}")
    return matches[0]


def find_triangle(page: Any) -> tuple[dict[str, Any], int]:
    matches = []
    wanted = {(rounded(x), rounded(y)) for x, y in TRIANGLE_POINTS}
    for curve in page.curves:
        path = curve.get("path") or []
        points = path_points(path)
        if (
            len(path) == 4
            and all(item[0].lower() in {"m", "l"} for item in path)
            and abs(float(curve.get("linewidth", 0)) - TRIANGLE_LINE_WIDTH_PT) <= 0.001
            and {(rounded(x), rounded(y)) for x, y in points} == wanted
        ):
            matches.append(curve)
    if len(matches) != 2:
        fail(f"expected two coincident triangle paths, found {len(matches)}")
    return matches[0], len(matches)


def render_crop(pdf_path: Path, page: Any, bounds: tuple[float, float, float, float], output: Path, pdftoppm: str) -> dict[str, Any]:
    left, top, right, bottom = bounds
    with tempfile.TemporaryDirectory(prefix="razavi-differential-opamp-") as temporary:
        base = Path(temporary) / "source"
        executable = shutil.which(f"{pdftoppm}.exe") or shutil.which(pdftoppm) or pdftoppm
        subprocess.run([executable, "-f", str(page.page_number), "-l", str(page.page_number), "-r", f"{RASTER_DPI:g}", "-png", "-singlefile", str(pdf_path), str(base)], check=True, capture_output=True)
        with Image.open(base.with_suffix(".png")) as rendered:
            scale_x, scale_y = rendered.width / float(page.width), rendered.height / float(page.height)
            page_left, page_top = float(page.bbox[0]), float(page.bbox[1])
            crop_box = (math.floor((left - page_left) * scale_x), math.floor((top - page_top) * scale_y), math.ceil((right - page_left) * scale_x), math.ceil((bottom - page_top) * scale_y))
            output.parent.mkdir(parents=True, exist_ok=True)
            rendered.convert("RGBA").crop(crop_box).save(output, format="PNG", optimize=False)
    return {
        "kind": "source-pdf-crop", "sourcePdfPage": page.page_number, "dpi": RASTER_DPI,
        "selectionBoundsPdf": {"left": rounded(left), "top": rounded(top), "right": rounded(right), "bottom": rounded(bottom)},
        "pixels": {"width": crop_box[2] - crop_box[0], "height": crop_box[3] - crop_box[1]},
        "pixelsPerPdfPoint": {"x": scale_x, "y": scale_y},
        "cropBoxPx": {"left": crop_box[0], "top": crop_box[1], "right": crop_box[2], "bottom": crop_box[3]},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--output-json", required=True, type=Path)
    parser.add_argument("--output-png", required=True, type=Path)
    parser.add_argument("--pdftoppm", default="pdftoppm")
    args = parser.parse_args()
    pdf_path = args.pdf.resolve()
    source_hash = digest(pdf_path)
    if source_hash != EXPECTED_PDF_SHA256:
        fail(f"source PDF SHA-256 mismatch: {source_hash}")
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[PDF_PAGE - 1]
        triangle, duplicate_count = find_triangle(page)
        lines = {name: find_line(page, *endpoints) for name, endpoints in LINES.items()}
        upper_y, lower_y = LINES["input-plus"][0][1], LINES["input-minus"][0][1]
        scale = 20.0 / (lower_y - upper_y)
        # Preserve the existing Symbol pins at ±10 while anchoring the native
        # triangle's left edge at -20.  Leads outside the source crop are an
        # explicit semantic extension to the existing -50 / +40 pin anchors.
        origin = (TRIANGLE_POINTS[0][0] + 20.0 / scale, (upper_y + lower_y) / 2)

        def logical(raw: tuple[float, float]) -> dict[str, float]:
            return {"x": rounded((raw[0] - origin[0]) * scale), "y": rounded((raw[1] - origin[1]) * scale)}

        def pair(name: str) -> dict[str, dict[str, float]]:
            start, end = LINES[name]
            return {"from": logical(start), "to": logical(end)}

        triangle_logical = [logical(value) for value in TRIANGLE_POINTS]
        triangle_path = " ".join([f"M {triangle_logical[0]['x']:g} {triangle_logical[0]['y']:g}", f"L {triangle_logical[1]['x']:g} {triangle_logical[1]['y']:g}", f"L {triangle_logical[2]['x']:g} {triangle_logical[2]['y']:g}", "Z"])
        # The circuit around Figure 13.48 immediately continues each lead into
        # switches and feedback wiring.  Its published body crop stops before
        # those unrelated paths, while retaining both output-edge joins.
        raster = render_crop(
            pdf_path,
            page,
            (
                TRIANGLE_POINTS[0][0] - RASTER_PADDING_PT,
                TRIANGLE_POINTS[0][1] - RASTER_PADDING_PT,
                294.0,
                TRIANGLE_POINTS[1][1] + RASTER_PADDING_PT,
            ),
            args.output_png.resolve(),
            args.pdftoppm,
        )

    evidence = {
        "schemaVersion": 1,
        "id": "razavi-textbook-figure-13-48-differential-opamp",
        "kind": "pdf-vector-extract",
        "source": {"title": "Design of Analog CMOS Integrated Circuits, Second Edition", "sha256": source_hash, "pdfPage": PDF_PAGE, "printedPage": PRINTED_PAGE, "figure": FIGURE},
        "selection": {"triangleDuplicateCount": duplicate_count, "trianglePathPdf": triangle["path"], "triangleLineWidthPdfPt": TRIANGLE_LINE_WIDTH_PT, "normalLineWidthPdfPt": NORMAL_LINE_WIDTH_PT, "lineFingerprintsPdf": {name: [{"x": rounded(point[0]), "y": rounded(point[1])} for point in endpoints] for name, endpoints in LINES.items()}},
        "normalization": {
            "originPdf": {"x": rounded(origin[0]), "y": rounded(origin[1])}, "logicalUnitsPerPdfPoint": rounded(scale),
            "pinAnchorsLogical": [{"name": "IN+", "x": -50, "y": 10}, {"name": "IN-", "x": -50, "y": -10}, {"name": "OUT+", "x": 40, "y": 10}, {"name": "OUT-", "x": 40, "y": -10}],
            "derivation": {"kind": "semantic-pin-extension", "reason": "Preserve the existing FD Amp's four pin anchors; only the body artwork is replaced by Figure 13.48."},
            "strokeMapping": {"normal": {"sourcePdfPt": NORMAL_LINE_WIDTH_PT, "targetRole": "normal"}, "triangle": {"sourcePdfPt": TRIANGLE_LINE_WIDTH_PT, "targetRole": "emphasis"}},
            "symbolGeometry": {"trianglePathData": triangle_path, **{name.replace("-", "_"): pair(name) for name in ("input-plus", "input-minus", "output-plus", "output-minus", "input-plus-vertical", "input-plus-horizontal", "input-minus-horizontal", "output-minus-horizontal", "output-plus-vertical", "output-plus-horizontal")}},
        },
        "rasterWitness": {**raster, "assetPath": args.output_png.name, "originPx": {"x": rounded((origin[0] - raster["selectionBoundsPdf"]["left"]) * raster["pixelsPerPdfPoint"]["x"]), "y": rounded((origin[1] - raster["selectionBoundsPdf"]["top"]) * raster["pixelsPerPdfPoint"]["y"])}, "pixelsPerLogical": rounded((raster["pixelsPerPdfPoint"]["x"] + raster["pixelsPerPdfPoint"]["y"]) / 2 / scale), "threshold": 160},
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Extracted {evidence['id']}")


if __name__ == "__main__":
    main()
