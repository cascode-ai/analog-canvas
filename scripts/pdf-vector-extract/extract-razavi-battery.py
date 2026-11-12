#!/usr/bin/env python3
"""Extract the Figure 3.11(a) battery and its same-panel voltage-source scale.

The PDF's single-cell battery is compared with the adjacent circular voltage
source before normalizing to the already-reviewed voltage-source circle.  Pin
extensions to the 10-unit grid and bar stroke normalization are explicit
product decisions, not claims about native PDF geometry.
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


EXPECTED_PDF_SHA256 = "4b5d1a96f998a6fb7f9ce2d1251a0087712032297e858e118f7476fa37d7d586"
PDF_PAGE = 95
PRINTED_PAGE = 70
FIGURE = "3.11(a)"
TARGET_VSOURCE_CIRCLE_DIAMETER = 21.511628
NORMAL_STROKE_LOGICAL = 1.6
PIXELS_PER_LOGICAL = 2.4
WINDOW = {"width": 90, "height": 106, "minX": -18, "minY": -22}
NORMAL = {"strokeRole": "normal", "lineCap": "butt", "lineJoin": "miter"}

# Native PDF object boxes in Figure 3.11(a), in PDF points.  These are a
# selection guard, not the geometry source: coordinates below come from the
# selected objects themselves.
BOXES = {
    "voltage_circle": (248.259, 248.799, 259.101, 259.641),
    "upper_lead": (291.632, 255.773, 291.632, 263.158),
    "lower_lead": (291.632, 266.615, 291.632, 274.000),
    "long_plate": (283.900, 263.227, 299.377, 263.227),
    "short_plate": (287.606, 266.615, 295.667, 266.615),
    "plus_horizontal": (295.623, 258.159, 299.689, 258.159),
    "plus_vertical": (297.656, 256.126, 297.656, 260.191),
    "minus": (295.623, 271.711, 299.689, 271.711),
}


def fail(message: str) -> None:
    raise RuntimeError(f"Razavi battery PDF extraction: {message}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rounded(value: float) -> float:
    result = round(float(value), 6)
    return 0.0 if result == -0.0 else result


def select(page: Any, name: str) -> dict[str, Any]:
    expected = BOXES[name]
    pool = page.curves if name == "voltage_circle" else page.lines
    matches = [
        obj for obj in pool
        if all(
            math.isclose(float(obj[key]), coordinate, abs_tol=0.015)
            for key, coordinate in zip(("x0", "top", "x1", "bottom"), expected)
        )
    ]
    if len(matches) != 1:
        fail(f"expected one native {name} object, found {len(matches)}")
    return matches[0]


def fingerprint(obj: dict[str, Any]) -> dict[str, Any]:
    return {
        "objectType": obj["object_type"],
        "boxPdf": [rounded(obj[key]) for key in ("x0", "top", "x1", "bottom")],
        "lineWidthPdfPt": rounded(obj["linewidth"]),
        "pathSha256": hashlib.sha256(
            json.dumps(obj.get("path"), sort_keys=True, default=str).encode()
        ).hexdigest(),
    }


def symbol_definition(objects: dict[str, dict[str, Any]]) -> tuple[dict[str, Any], tuple[float, float], float]:
    circle = objects["voltage_circle"]
    long_plate = objects["long_plate"]
    short_plate = objects["short_plate"]
    source_circle_diameter = circle["x1"] - circle["x0"]
    if not math.isclose(source_circle_diameter, circle["bottom"] - circle["top"], abs_tol=0.02):
        fail("adjacent voltage source is not circular")
    scale = TARGET_VSOURCE_CIRCLE_DIAMETER / source_circle_diameter
    origin = (objects["upper_lead"]["x0"], (long_plate["top"] + short_plate["top"]) / 2)
    bar_thickness = NORMAL_STROKE_LOGICAL * long_plate["linewidth"] / circle["linewidth"]
    if not math.isclose(long_plate["linewidth"], short_plate["linewidth"], abs_tol=0.001):
        fail("battery plate stroke widths diverged")

    def x(value: float) -> float:
        return rounded((value - origin[0]) * scale)

    def y(value: float) -> float:
        return rounded((value - origin[1]) * scale)

    def p(px: float, py: float) -> dict[str, float]:
        return {"x": x(px), "y": y(py)}

    def line(start: dict[str, float], end: dict[str, float]) -> dict[str, Any]:
        return {"kind": "line", "from": start, "to": end, "style": NORMAL}

    def filled_plate(source: dict[str, Any]) -> dict[str, Any]:
        left, right, center = x(source["x0"]), x(source["x1"]), y(source["top"])
        half = bar_thickness / 2
        return {
            "kind": "polygon",
            "points": [
                p(origin[0] + left / scale, origin[1] + (center - half) / scale),
                p(origin[0] + right / scale, origin[1] + (center - half) / scale),
                p(origin[0] + right / scale, origin[1] + (center + half) / scale),
                p(origin[0] + left / scale, origin[1] + (center + half) / scale),
            ],
            "fill": "foreground",
            "stroke": "none",
        }

    polarity = [
        line(p(obj["x0"], obj["top"]), p(obj["x1"], obj["bottom"]))
        for obj in (objects["plus_horizontal"], objects["plus_vertical"], objects["minus"])
    ]
    symbol = {
        "schemaVersion": 1,
        "id": "battery",
        "name": "Battery",
        "viewBox": {"x": -24, "y": -24, "width": 48, "height": 48},
        "pins": [
            {"name": "+", "role": "positive", "at": {"x": 0, "y": -20}, "direction": "north",
             "presentation": {"visibility": "visible", "leadLength": round(20 + y(long_plate["top"]))}},
            {"name": "-", "role": "negative", "at": {"x": 0, "y": 20}, "direction": "south",
             "presentation": {"visibility": "visible", "leadLength": round(20 - y(short_plate["top"]))}},
        ],
        "primitives": [
            line({"x": 0, "y": -20}, {"x": 0, "y": y(long_plate["top"])}),
            line({"x": 0, "y": y(short_plate["top"])}, {"x": 0, "y": 20}),
            filled_plate(long_plate),
            filled_plate(short_plate),
            *polarity,
        ],
        "variants": [],
    }
    return symbol, origin, scale


def render_witness(pdf_path: Path, origin: tuple[float, float], scale: float, output: Path) -> dict[str, Any]:
    pixels_per_point = PIXELS_PER_LOGICAL * scale
    dpi = 72 * pixels_per_point
    crop_x = math.floor(origin[0] * pixels_per_point + WINDOW["minX"] * PIXELS_PER_LOGICAL)
    crop_y = math.floor(origin[1] * pixels_per_point + WINDOW["minY"] * PIXELS_PER_LOGICAL)
    with tempfile.TemporaryDirectory(prefix="razavi-battery-") as temporary:
        raster_base = Path(temporary) / "source"
        subprocess.run(
            [shutil.which("pdftoppm") or "pdftoppm", "-f", str(PDF_PAGE), "-l", str(PDF_PAGE),
             "-r", f"{dpi:.9f}", "-png", "-singlefile", "-x", str(crop_x),
             "-y", str(crop_y), "-W", str(WINDOW["width"]), "-H", str(WINDOW["height"]),
             str(pdf_path), str(raster_base)],
            check=True, capture_output=True,
        )
        with Image.open(raster_base.with_suffix(".png")) as image:
            if image.size != (WINDOW["width"], WINDOW["height"]):
                fail(f"unexpected witness size {image.size}")
            output.parent.mkdir(parents=True, exist_ok=True)
            image.convert("RGBA").save(output, format="PNG", optimize=False)
    return {
        "kind": "source-pdf-crop", "sourcePdfPage": PDF_PAGE, "dpi": rounded(dpi),
        "pixels": {"width": WINDOW["width"], "height": WINDOW["height"]},
        "pixelsPerLogical": PIXELS_PER_LOGICAL,
        "originPx": {"x": rounded(origin[0] * pixels_per_point - crop_x),
                     "y": rounded(origin[1] * pixels_per_point - crop_y)},
        "window": WINDOW, "sourceCropPx": {"x": crop_x, "y": crop_y},
        "assetPath": output.name, "threshold": 160,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--output-json", required=True, type=Path)
    parser.add_argument("--output-png", required=True, type=Path)
    parser.add_argument("--output-geometry", required=True, type=Path)
    args = parser.parse_args()
    pdf_path = args.pdf.resolve()
    source_hash = sha256(pdf_path)
    if source_hash != EXPECTED_PDF_SHA256:
        fail(f"source PDF SHA-256 mismatch: {source_hash}")
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[PDF_PAGE - 1]
        objects = {name: select(page, name) for name in BOXES}
        symbol, origin, scale = symbol_definition(objects)
    fingerprints = {name: fingerprint(obj) for name, obj in objects.items()}
    witness = render_witness(pdf_path, origin, scale, args.output_png.resolve())
    evidence = {
        "schemaVersion": 1, "id": "razavi-textbook-battery", "kind": "pdf-vector-extract",
        "source": {"title": "Fundamentals of Microelectronics, First Edition", "sha256": source_hash,
                   "pdfPage": PDF_PAGE, "printedPage": PRINTED_PAGE, "figure": FIGURE},
        "selection": {"method": "native-battery-and-adjacent-vsource-vectors",
                      "nativeObjects": fingerprints,
                      "nativeObjectSha256": hashlib.sha256(json.dumps(fingerprints, sort_keys=True).encode()).hexdigest()},
        "normalization": {
            "originPdf": {"x": rounded(origin[0]), "y": rounded(origin[1])},
            "logicalUnitsPerPdfPoint": rounded(scale),
            "adjacentVsourceDiameterPdfPt": rounded(objects["voltage_circle"]["x1"] - objects["voltage_circle"]["x0"]),
            "reviewedVsourceDiameterLogical": TARGET_VSOURCE_CIRCLE_DIAMETER,
            "longPlatePdfPt": rounded(objects["long_plate"]["x1"] - objects["long_plate"]["x0"]),
            "shortPlatePdfPt": rounded(objects["short_plate"]["x1"] - objects["short_plate"]["x0"]),
            "plateCenterGapPdfPt": rounded(objects["short_plate"]["top"] - objects["long_plate"]["top"]),
            "plateToVsourceStrokeRatio": rounded(objects["long_plate"]["linewidth"] / objects["voltage_circle"]["linewidth"]),
            "symbolDefinition": symbol,
        },
        "derivation": {
            "pinExtension": "native roughly 36-unit total lead span extended symmetrically to 40-unit on-grid pins",
            "stroke": "normal leads and polarity marks; filled plate thickness preserves the native 2:1 plate-to-source-stroke ratio",
            "model": "drawing-only; no default electrical or netlist binding",
        },
        "rasterWitness": witness,
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8", newline="\n")
    geometry = {
        "schemaVersion": 1, "referenceId": "razavi-reference-v1",
        "symbols": {"battery": {"assetPath": witness["assetPath"],
                                "pixelsPerLogical": witness["pixelsPerLogical"],
                                "originPx": witness["originPx"], "window": witness["window"]}},
    }
    args.output_geometry.parent.mkdir(parents=True, exist_ok=True)
    args.output_geometry.write_text(json.dumps(geometry, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("Extracted razavi-textbook-battery from Figure 3.11(a)")


if __name__ == "__main__":
    main()
