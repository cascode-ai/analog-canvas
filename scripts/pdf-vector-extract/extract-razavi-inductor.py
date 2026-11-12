#!/usr/bin/env python3
"""Extract the Figure 15.21 inductor as independent vector evidence.

This tool owns PDF parsing and a small raster witness only. It intentionally
does not import the repository's pixel-diff code or generate Symbol DSL.
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


EXPECTED_PDF_SHA256 = (
    "a6031d1149c2c6191a1f0e541065165b72dafc4bc4ab4b0ea37af41b7cb0f739"
)
PDF_PAGE = 639
PRINTED_PAGE = 620
FIGURE = "15.21"
EXPECTED_MOVE = (182.576, 225.7602)
EXPECTED_COMMAND_COUNT = 24
EXPECTED_LINE_WIDTH_PT = 0.717
NORMAL_STROKE_LOGICAL = 1.6
PIN_HALF_SPAN_LOGICAL = 30.0
RASTER_DPI = 300.0
RASTER_PADDING_PT = 2.5


def fail(message: str) -> None:
    raise RuntimeError(f"Razavi inductor PDF extraction: {message}")


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


def find_inductor_path(page: Any) -> dict[str, Any]:
    candidates = []
    for curve in page.curves:
        path = curve.get("path") or []
        if len(path) != EXPECTED_COMMAND_COUNT or path[0][0] != "m":
            continue
        move = point(path[0][1])
        distance = math.hypot(
            move[0] - EXPECTED_MOVE[0], move[1] - EXPECTED_MOVE[1]
        )
        if (
            distance <= 0.02
            and abs(float(curve.get("linewidth", 0)) - EXPECTED_LINE_WIDTH_PT)
            <= 0.001
        ):
            candidates.append(curve)
    if len(candidates) != 1:
        fail(f"expected one path fingerprint match, found {len(candidates)}")
    return candidates[0]


def canonical_commands(
    raw_path: list[Any], origin: tuple[float, float], scale: float
) -> list[dict[str, Any]]:
    def logical(raw: Any) -> list[float]:
        x, y = point(raw)
        return [rounded((x - origin[0]) * scale), rounded((y - origin[1]) * scale)]

    commands: list[dict[str, Any]] = []
    current: list[float] | None = None
    for item in raw_path:
        operator = item[0].lower()
        values = item[1:]
        if operator == "m":
            current = logical(values[0])
            commands.append({"op": "M", "points": [current]})
        elif operator == "c":
            controls = [logical(value) for value in values]
            commands.append({"op": "C", "points": controls})
            current = controls[-1]
        elif operator == "v":
            if current is None:
                fail("v command appears before a current point")
            control2, end = [logical(value) for value in values]
            commands.append({"op": "C", "points": [current, control2, end]})
            current = end
        elif operator == "y":
            control1, end = [logical(value) for value in values]
            commands.append({"op": "C", "points": [control1, end, end]})
            current = end
        else:
            fail(f"unsupported PDF path operator {operator!r}")
    return commands


def path_data(commands: list[dict[str, Any]]) -> str:
    parts = [f"M 0 {-PIN_HALF_SPAN_LOGICAL:g}"]
    for index, command in enumerate(commands):
        points = command["points"]
        if index == 0:
            parts.append(f"L {points[0][0]:g} {points[0][1]:g}")
            continue
        flattened = " ".join(f"{coordinate:g}" for pair in points for coordinate in pair)
        parts.append(f"{command['op']} {flattened}")
    parts.append(f"L 0 {PIN_HALF_SPAN_LOGICAL:g}")
    return " ".join(parts)


def path_points(raw_path: list[Any]) -> list[tuple[float, float]]:
    return [point(value) for item in raw_path for value in item[1:]]


def render_crop(
    pdf_path: Path,
    page: Any,
    raw_path: list[Any],
    output_path: Path,
    pdftoppm: str,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="razavi-inductor-") as temp_dir:
        raster_base = Path(temp_dir) / "page"
        executable = (
            shutil.which(f"{pdftoppm}.exe")
            if Path(pdftoppm).suffix == ""
            else None
        ) or shutil.which(pdftoppm) or pdftoppm
        command = [
            executable,
            "-f",
            str(PDF_PAGE),
            "-l",
            str(PDF_PAGE),
            "-r",
            f"{RASTER_DPI:g}",
            "-png",
            "-singlefile",
            str(pdf_path),
            str(raster_base),
        ]
        subprocess.run(command, check=True, capture_output=True)
        rendered_path = raster_base.with_suffix(".png")
        with Image.open(rendered_path) as rendered:
            page_width_px, page_height_px = rendered.size
            scale_x = page_width_px / float(page.width)
            scale_y = page_height_px / float(page.height)
            points = path_points(raw_path)
            # pdfplumber keeps the MediaBox offset in its page coordinates,
            # while Poppler rasterizes the MediaBox at pixel (0, 0). Remove
            # the offset before converting the selected path to raster pixels.
            page_left, page_top = float(page.bbox[0]), float(page.bbox[1])
            min_x = (
                min(value[0] for value in points)
                - page_left
                - RASTER_PADDING_PT
            )
            max_x = (
                max(value[0] for value in points)
                - page_left
                + RASTER_PADDING_PT
            )
            min_y = (
                min(value[1] for value in points)
                - page_top
                - RASTER_PADDING_PT
            )
            max_y = (
                max(value[1] for value in points)
                - page_top
                + RASTER_PADDING_PT
            )
            crop_box = (
                math.floor(min_x * scale_x),
                math.floor(min_y * scale_y),
                math.ceil(max_x * scale_x),
                math.ceil(max_y * scale_y),
            )
            crop = rendered.convert("RGBA").crop(crop_box)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            crop.save(output_path, format="PNG", optimize=False)
    return {
        "kind": "source-pdf-crop",
        "sourcePdfPage": PDF_PAGE,
        "dpi": RASTER_DPI,
        "pagePixels": {"width": page_width_px, "height": page_height_px},
        "cropBoxPx": {
            "left": crop_box[0],
            "top": crop_box[1],
            "right": crop_box[2],
            "bottom": crop_box[3],
        },
        "pixels": {
            "width": crop_box[2] - crop_box[0],
            "height": crop_box[3] - crop_box[1],
        },
        "pagePixelsPerPdfPoint": {"x": scale_x, "y": scale_y},
        "pdfplumberMediaBoxOffset": {
            "x": float(page.bbox[0]),
            "y": float(page.bbox[1]),
        },
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
        if len(pdf.pages) < PDF_PAGE:
            fail(f"source has only {len(pdf.pages)} pages")
        page = pdf.pages[PDF_PAGE - 1]
        curve = find_inductor_path(page)
        raw_path = curve["path"]
        start = point(raw_path[0][1])
        end = point(raw_path[-1][-1])
        origin = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        logical_scale = NORMAL_STROKE_LOGICAL / float(curve["linewidth"])
        commands = canonical_commands(raw_path, origin, logical_scale)
        raster = render_crop(
            pdf_path, page, raw_path, args.output_png.resolve(), args.pdftoppm
        )

    origin_page_px = {
        "x": (
            origin[0] - raster["pdfplumberMediaBoxOffset"]["x"]
        )
        * raster["pagePixelsPerPdfPoint"]["x"],
        "y": (
            origin[1] - raster["pdfplumberMediaBoxOffset"]["y"]
        )
        * raster["pagePixelsPerPdfPoint"]["y"],
    }
    origin_crop_px = {
        "x": rounded(origin_page_px["x"] - raster["cropBoxPx"]["left"]),
        "y": rounded(origin_page_px["y"] - raster["cropBoxPx"]["top"]),
    }
    pixels_per_logical = rounded(
        (
            raster["pagePixelsPerPdfPoint"]["x"]
            + raster["pagePixelsPerPdfPoint"]["y"]
        )
        / 2
        / logical_scale
    )
    evidence = {
        "schemaVersion": 1,
        "id": "razavi-textbook-figure-15-21-inductor",
        "kind": "pdf-vector-extract",
        "source": {
            "title": "Design of Analog CMOS Integrated Circuits, Second Edition",
            "sha256": source_hash,
            "pdfPage": PDF_PAGE,
            "printedPage": PRINTED_PAGE,
            "figure": FIGURE,
        },
        "selection": {
            "pageObjectType": curve["object_type"],
            "pathCommandCount": len(raw_path),
            "firstMovePdf": {"x": rounded(start[0]), "y": rounded(start[1])},
            "lastPointPdf": {"x": rounded(end[0]), "y": rounded(end[1])},
            "lineWidthPdfPt": curve["linewidth"],
            "stroke": curve["stroke"],
            "fill": curve["fill"],
            "strokingColor": curve["stroking_color"],
        },
        "normalization": {
            "originPdf": {"x": rounded(origin[0]), "y": rounded(origin[1])},
            "logicalUnitsPerPdfPoint": rounded(logical_scale),
            "sourceLineWidthPdfPt": curve["linewidth"],
            "targetLineWidthLogical": NORMAL_STROKE_LOGICAL,
            "pinAnchorsLogical": [
                {"name": "1", "x": 0, "y": -30},
                {"name": "2", "x": 0, "y": 30},
            ],
            "canonicalCommands": commands,
            "symbolPathData": path_data(commands),
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
