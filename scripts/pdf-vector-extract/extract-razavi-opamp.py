#!/usr/bin/env python3
"""Extract the Figure 8.26 op-amp as independent vector evidence."""

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


EXPECTED_PDF_SHA256 = (
    "a6031d1149c2c6191a1f0e541065165b72dafc4bc4ab4b0ea37af41b7cb0f739"
)
PDF_PAGE = 308
PRINTED_PAGE = 289
FIGURE = "8.26"
NORMAL_LINE_WIDTH_PT = 0.717
TRIANGLE_LINE_WIDTH_PT = 1.435
RASTER_DPI = 300.0
RASTER_PADDING_X_PT = 0.75
RASTER_PADDING_Y_PT = 2.5
PIN_LEFT_X = -50.0
PIN_RIGHT_X = 40.0

TRIANGLE_POINTS = [
    (398.362, 350.2162),
    (398.362, 378.9152),
    (427.062, 364.5652),
    (398.362, 350.2162),
]
LINE_FINGERPRINTS = {
    "input-minus": ((384.641, 358.8252), (398.273, 358.8252)),
    "input-plus": ((384.731, 370.3052), (398.362, 370.3052)),
    "output": ((427.062, 364.5652), (437.107, 364.5652)),
    "plus-vertical": ((403.385, 369.5872), (403.385, 373.8922)),
    "plus-horizontal": ((401.233, 371.7402), (405.538, 371.7402)),
    "minus-horizontal": ((401.233, 357.3902), (405.538, 357.3902)),
}


def fail(message: str) -> None:
    raise RuntimeError(f"Razavi op-amp PDF extraction: {message}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rounded(value: float) -> float:
    result = round(value, 6)
    return 0.0 if result == -0.0 else result


def point(value: Any) -> tuple[float, float]:
    return float(value[0]), float(value[1])


def close(left: tuple[float, float], right: tuple[float, float]) -> bool:
    return math.hypot(left[0] - right[0], left[1] - right[1]) <= 0.02


def path_points(path: list[Any]) -> list[tuple[float, float]]:
    return [point(value) for item in path for value in item[1:]]


def find_triangle(page: Any) -> tuple[dict[str, Any], int]:
    duplicates = []
    for curve in page.curves:
        path = curve.get("path") or []
        points = path_points(path)
        if (
            len(path) == 4
            and all(item[0].lower() in {"m", "l"} for item in path)
            and abs(float(curve.get("linewidth", 0)) - TRIANGLE_LINE_WIDTH_PT)
            <= 0.001
            and set((rounded(x), rounded(y)) for x, y in points)
            == set((rounded(x), rounded(y)) for x, y in TRIANGLE_POINTS)
        ):
            duplicates.append(curve)
    if len(duplicates) != 2:
        fail(f"expected two coincident triangle paths, found {len(duplicates)}")
    forward = [
        curve
        for curve in duplicates
        if close(point(curve["path"][0][1]), TRIANGLE_POINTS[0])
    ]
    if len(forward) != 1:
        fail(f"expected one forward triangle path, found {len(forward)}")
    return forward[0], len(duplicates)


def find_line(
    page: Any, start: tuple[float, float], end: tuple[float, float]
) -> dict[str, Any]:
    matches = []
    for line in page.lines:
        path = line.get("path") or []
        if len(path) != 2:
            continue
        actual = (point(path[0][1]), point(path[1][1]))
        if (
            abs(float(line.get("linewidth", 0)) - NORMAL_LINE_WIDTH_PT)
            <= 0.001
            and (
                (close(actual[0], start) and close(actual[1], end))
                or (close(actual[0], end) and close(actual[1], start))
            )
        ):
            matches.append(line)
    if len(matches) != 1:
        fail(f"expected one line {start}->{end}, found {len(matches)}")
    return matches[0]


def render_crop(
    pdf_path: Path,
    page: Any,
    selected_points: list[tuple[float, float]],
    output_path: Path,
    pdftoppm: str,
) -> dict[str, Any]:
    """Render the original approved PDF and crop the selected source region."""
    min_x = min(value[0] for value in selected_points) - RASTER_PADDING_X_PT
    max_x = max(value[0] for value in selected_points) + RASTER_PADDING_X_PT
    min_y = min(value[1] for value in selected_points) - RASTER_PADDING_Y_PT
    max_y = max(value[1] for value in selected_points) + RASTER_PADDING_Y_PT
    with tempfile.TemporaryDirectory(prefix="razavi-opamp-source-") as temp_dir:
        raster_base = Path(temp_dir) / "source"
        executable = (
            shutil.which(f"{pdftoppm}.exe")
            if Path(pdftoppm).suffix == ""
            else None
        ) or shutil.which(pdftoppm) or pdftoppm
        subprocess.run(
            [
                executable,
                "-f", str(page.page_number), "-l", str(page.page_number),
                "-r", f"{RASTER_DPI:g}", "-png", "-singlefile",
                str(pdf_path), str(raster_base),
            ],
            check=True,
            capture_output=True,
        )
        with Image.open(raster_base.with_suffix(".png")) as rendered:
            scale_x = rendered.width / float(page.width)
            scale_y = rendered.height / float(page.height)
            page_left, page_top = float(page.bbox[0]), float(page.bbox[1])
            crop_box = (
                math.floor((min_x - page_left) * scale_x),
                math.floor((min_y - page_top) * scale_y),
                math.ceil((max_x - page_left) * scale_x),
                math.ceil((max_y - page_top) * scale_y),
            )
            crop = rendered.convert("RGBA").crop(crop_box)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            crop.save(output_path, format="PNG", optimize=False)
    return {
        "kind": "source-pdf-crop",
        "sourcePdfPage": page.page_number,
        "dpi": RASTER_DPI,
        "selectionBoundsPdf": {
            "left": rounded(min_x), "top": rounded(min_y),
            "right": rounded(max_x), "bottom": rounded(max_y),
        },
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
    source_hash = sha256(pdf_path)
    if source_hash != EXPECTED_PDF_SHA256:
        fail(f"source PDF SHA-256 mismatch: {source_hash}")

    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[PDF_PAGE - 1]
        triangle, duplicate_count = find_triangle(page)
        lines = {
            name: find_line(page, endpoints[0], endpoints[1])
            for name, endpoints in LINE_FINGERPRINTS.items()
        }
        upper_y = LINE_FINGERPRINTS["input-minus"][0][1]
        lower_y = LINE_FINGERPRINTS["input-plus"][0][1]
        logical_scale = 20.0 / (lower_y - upper_y)
        visual_min_x = LINE_FINGERPRINTS["input-minus"][0][0]
        visual_max_x = LINE_FINGERPRINTS["output"][1][0]
        pin_midpoint = (PIN_LEFT_X + PIN_RIGHT_X) / 2
        origin = (
            (visual_min_x + visual_max_x) / 2 - pin_midpoint / logical_scale,
            (upper_y + lower_y) / 2,
        )

        def logical(raw: tuple[float, float]) -> dict[str, float]:
            return {
                "x": rounded((raw[0] - origin[0]) * logical_scale),
                "y": rounded((raw[1] - origin[1]) * logical_scale),
            }

        triangle_logical = [logical(value) for value in TRIANGLE_POINTS]
        triangle_path = " ".join(
            [
                f"M {triangle_logical[0]['x']:g} {triangle_logical[0]['y']:g}",
                f"L {triangle_logical[1]['x']:g} {triangle_logical[1]['y']:g}",
                f"L {triangle_logical[2]['x']:g} {triangle_logical[2]['y']:g}",
                "Z",
            ]
        )
        primitives = {
            "trianglePathData": triangle_path,
            "inputMinus": {
                "from": {"x": PIN_LEFT_X, "y": -10},
                "to": logical(LINE_FINGERPRINTS["input-minus"][1]),
            },
            "inputPlus": {
                "from": {"x": PIN_LEFT_X, "y": 10},
                "to": logical(LINE_FINGERPRINTS["input-plus"][1]),
            },
            "output": {
                "from": logical(LINE_FINGERPRINTS["output"][0]),
                "to": {"x": PIN_RIGHT_X, "y": 0},
            },
            "plusVertical": {
                "from": logical(LINE_FINGERPRINTS["plus-vertical"][0]),
                "to": logical(LINE_FINGERPRINTS["plus-vertical"][1]),
            },
            "plusHorizontal": {
                "from": logical(LINE_FINGERPRINTS["plus-horizontal"][0]),
                "to": logical(LINE_FINGERPRINTS["plus-horizontal"][1]),
            },
            "minusHorizontal": {
                "from": logical(LINE_FINGERPRINTS["minus-horizontal"][0]),
                "to": logical(LINE_FINGERPRINTS["minus-horizontal"][1]),
            },
        }
        selected_points = path_points(triangle["path"])
        for line in lines.values():
            selected_points.extend(path_points(line["path"]))
        raster = render_crop(
            pdf_path,
            page,
            selected_points,
            args.output_png.resolve(),
            args.pdftoppm,
        )

    origin_crop_px = {
        "x": rounded(
            (origin[0] - raster["selectionBoundsPdf"]["left"])
            * raster["pixelsPerPdfPoint"]["x"]
        ),
        "y": rounded(
            (origin[1] - raster["selectionBoundsPdf"]["top"])
            * raster["pixelsPerPdfPoint"]["y"]
        ),
    }
    pixels_per_logical = rounded(
        (
            raster["pixelsPerPdfPoint"]["x"]
            + raster["pixelsPerPdfPoint"]["y"]
        )
        / 2
        / logical_scale
    )
    evidence = {
        "schemaVersion": 1,
        "id": "razavi-textbook-figure-8-26-opamp",
        "kind": "pdf-vector-extract",
        "source": {
            "title": "Design of Analog CMOS Integrated Circuits, Second Edition",
            "sha256": source_hash,
            "pdfPage": PDF_PAGE,
            "printedPage": PRINTED_PAGE,
            "figure": FIGURE,
        },
        "selection": {
            "triangleDuplicateCount": duplicate_count,
            "trianglePathPdf": triangle["path"],
            "triangleLineWidthPdfPt": TRIANGLE_LINE_WIDTH_PT,
            "normalLineWidthPdfPt": NORMAL_LINE_WIDTH_PT,
            "lineFingerprintsPdf": {
                name: [
                    {"x": rounded(value[0]), "y": rounded(value[1])}
                    for value in endpoints
                ]
                for name, endpoints in LINE_FINGERPRINTS.items()
            },
        },
        "normalization": {
            "originPdf": {"x": rounded(origin[0]), "y": rounded(origin[1])},
            "logicalUnitsPerPdfPoint": rounded(logical_scale),
            "pinAnchorsLogical": [
                {"name": "IN+", "x": PIN_LEFT_X, "y": 10},
                {"name": "IN-", "x": PIN_LEFT_X, "y": -10},
                {"name": "OUT", "x": PIN_RIGHT_X, "y": 0},
            ],
            "strokeMapping": {
                "normal": {
                    "sourcePdfPt": NORMAL_LINE_WIDTH_PT,
                    "targetRole": "normal",
                },
                "triangle": {
                    "sourcePdfPt": TRIANGLE_LINE_WIDTH_PT,
                    "targetRole": "emphasis",
                },
            },
            "symbolGeometry": primitives,
        },
        "rasterWitness": {
            **raster,
            "assetPath": args.output_png.name,
            "originPx": origin_crop_px,
            "pixelsPerLogical": pixels_per_logical,
            "threshold": 160,
        },
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(
        json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Extracted {evidence['id']}")
    print(f"  vector: {args.output_json.resolve()}")
    print(f"  raster: {args.output_png.resolve()}")


if __name__ == "__main__":
    main()
