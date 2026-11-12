#!/usr/bin/env python3
"""Extract the Figure 3.44(a) Zener diode as pinned vector evidence.

The source page contains a complete vertical Zener symbol.  This extractor
selects only its native vector objects, rotates them into the product's
left-to-right A/K convention, extends the two leads to the canonical 10-unit
grid, and emits a direct PDF crop for raster fidelity comparison.
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
TITLE = "Fundamentals of Microelectronics, First Edition"
PDF_PAGE = 126
PRINTED_PAGE = 101
FIGURE = "3.44(a)"
NORMAL_SOURCE_STROKE = 0.717
EMPHASIS_SOURCE_STROKE = 1.435
NORMAL_STROKE_LOGICAL = 1.6
PIXELS_PER_LOGICAL = 2.4
TARGET_CATHODE_X = 6.666666
SOURCE_BOUNDS = (271.5, 136.4, 279.4, 158.7)
WITNESS_WINDOW = {"width": 48, "height": 96, "minX": -10, "minY": -20}

NORMAL = {"strokeRole": "normal", "lineCap": "butt", "lineJoin": "miter"}
EMPHASIS = {"strokeRole": "emphasis", "lineCap": "butt", "lineJoin": "miter"}


def fail(message: str) -> None:
    raise RuntimeError(f"Razavi Zener PDF extraction: {message}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rounded(value: float) -> float:
    result = round(float(value), 6)
    return 0.0 if result == -0.0 else result


def point(value: Any) -> tuple[float, float]:
    return float(value[0]), float(value[1])


def inside(obj: dict[str, Any]) -> bool:
    left, top, right, bottom = SOURCE_BOUNDS
    return (
        float(obj.get("x0", -math.inf)) >= left
        and float(obj.get("x1", math.inf)) <= right
        and float(obj.get("top", -math.inf)) >= top
        and float(obj.get("bottom", math.inf)) <= bottom
    )


def select_objects(page: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    selected = [obj for obj in [*page.lines, *page.curves] if inside(obj)]
    leads = [
        obj
        for obj in selected
        if obj.get("object_type") == "line"
        and math.isclose(float(obj.get("linewidth", 0)), NORMAL_SOURCE_STROKE, abs_tol=0.001)
    ]
    outlines = [
        obj
        for obj in selected
        if obj.get("object_type") == "curve"
        and len(obj.get("path") or []) == 4
        and math.isclose(float(obj.get("linewidth", 0)), NORMAL_SOURCE_STROKE, abs_tol=0.001)
    ]
    cathodes = [
        obj
        for obj in selected
        if obj.get("object_type") == "curve"
        and len(obj.get("path") or []) == 4
        and math.isclose(float(obj.get("linewidth", 0)), EMPHASIS_SOURCE_STROKE, abs_tol=0.001)
    ]
    if len(selected) != 5 or len(leads) != 2 or len(outlines) != 2 or len(cathodes) != 1:
        fail(
            "expected two leads, two coincident diode outlines, and one bent cathode; "
            f"found {len(selected)}, {len(leads)}, {len(outlines)}, {len(cathodes)}"
        )
    if {json.dumps(obj["path"], sort_keys=True) for obj in outlines}.__len__() != 2:
        fail("coincident diode outline paths unexpectedly became identical")
    return leads, outlines, cathodes[0]


def fingerprint(obj: dict[str, Any]) -> dict[str, Any]:
    path = obj.get("path") or []
    encoded = json.dumps(path, sort_keys=True, separators=(",", ":"), default=str).encode()
    return {
        "objectType": obj.get("object_type"),
        "x0": rounded(obj["x0"]),
        "top": rounded(obj["top"]),
        "x1": rounded(obj["x1"]),
        "bottom": rounded(obj["bottom"]),
        "lineWidthPdfPt": rounded(obj.get("linewidth", 0)),
        "pathCommandCount": len(path),
        "pathSha256": hashlib.sha256(encoded).hexdigest(),
    }


def symbol_definition(outline: dict[str, Any], cathode: dict[str, Any]) -> tuple[dict[str, Any], tuple[float, float], float]:
    scale = NORMAL_STROKE_LOGICAL / NORMAL_SOURCE_STROKE
    outline_points = [point(command[1]) for command in outline["path"][:3]]
    apex = min(outline_points, key=lambda value: value[1])
    source_origin_x = apex[0]
    cathode_points = [point(command[1]) for command in cathode["path"]]
    middle_y = cathode_points[1][1]
    if not math.isclose(middle_y, cathode_points[2][1], abs_tol=1e-6):
        fail("bent cathode no longer contains the expected central bar")
    source_origin_y = middle_y + TARGET_CATHODE_X / scale

    def logical(source: tuple[float, float]) -> dict[str, float]:
        # Rotate the vertical source clockwise into the product's A-left/K-right
        # convention while retaining one uniform source-stroke scale.
        return {
            "x": rounded((source_origin_y - source[1]) * scale),
            "y": rounded((source[0] - source_origin_x) * scale),
        }

    triangle = [logical(value) for value in outline_points]
    triangle_base_x = rounded((triangle[0]["x"] + triangle[1]["x"]) / 2)
    bent_cathode = [logical(value) for value in cathode_points]
    definition = {
        "schemaVersion": 1,
        "id": "zener-diode",
        "name": "Zener Diode",
        "viewBox": {"x": -24, "y": -10, "width": 48, "height": 20},
        "pins": [
            {
                "name": "A",
                "role": "anode",
                "at": {"x": -20, "y": 0},
                "direction": "west",
                "presentation": {"visibility": "visible", "leadLength": 10},
            },
            {
                "name": "K",
                "role": "cathode",
                "at": {"x": 20, "y": 0},
                "direction": "east",
                "presentation": {"visibility": "visible", "leadLength": 10},
            },
        ],
        "primitives": [
            {"kind": "line", "from": {"x": -20, "y": 0}, "to": {"x": triangle_base_x, "y": 0}, "style": NORMAL},
            {"kind": "polygon", "points": triangle, "fill": "none", "stroke": "foreground", "style": NORMAL},
            {"kind": "polyline", "points": bent_cathode, "style": EMPHASIS},
            {"kind": "line", "from": {"x": TARGET_CATHODE_X, "y": 0}, "to": {"x": 20, "y": 0}, "style": NORMAL},
        ],
        "variants": [],
    }
    return definition, (source_origin_x, source_origin_y), scale


def render_witness(
    pdf_path: Path,
    page: Any,
    origin_pdf: tuple[float, float],
    output_path: Path,
    pdftoppm: str,
) -> dict[str, Any]:
    pixels_per_point = PIXELS_PER_LOGICAL * (NORMAL_STROKE_LOGICAL / NORMAL_SOURCE_STROKE)
    dpi = 72 * pixels_per_point
    media_left, media_top, _, _ = page.mediabox
    origin_full = {
        "x": (origin_pdf[0] - float(media_left)) * pixels_per_point,
        "y": (origin_pdf[1] - float(media_top)) * pixels_per_point,
    }
    crop_x = math.floor(origin_full["x"] + WITNESS_WINDOW["minX"] * PIXELS_PER_LOGICAL)
    crop_y = math.floor(origin_full["y"] + WITNESS_WINDOW["minY"] * PIXELS_PER_LOGICAL)
    executable = shutil.which(pdftoppm) or pdftoppm
    with tempfile.TemporaryDirectory(prefix="razavi-zener-") as temporary:
        raster_base = Path(temporary) / "source"
        subprocess.run(
            [
                executable,
                "-f", str(PDF_PAGE), "-l", str(PDF_PAGE),
                "-r", f"{dpi:.9f}", "-png", "-singlefile",
                "-x", str(crop_x), "-y", str(crop_y),
                "-W", str(WITNESS_WINDOW["width"]), "-H", str(WITNESS_WINDOW["height"]),
                str(pdf_path), str(raster_base),
            ],
            check=True,
            capture_output=True,
        )
        with Image.open(raster_base.with_suffix(".png")) as image:
            rgba = image.convert("RGBA")
            if rgba.size != (WITNESS_WINDOW["width"], WITNESS_WINDOW["height"]):
                fail(f"unexpected witness size {rgba.size}")
            output_path.parent.mkdir(parents=True, exist_ok=True)
            rgba.save(output_path, format="PNG", optimize=False)
    return {
        "kind": "source-pdf-crop",
        "sourcePdfPage": PDF_PAGE,
        "dpi": rounded(dpi),
        "pixels": {"width": WITNESS_WINDOW["width"], "height": WITNESS_WINDOW["height"]},
        "pixelsPerLogical": PIXELS_PER_LOGICAL,
        "originPx": {
            "x": rounded(origin_full["x"] - crop_x),
            "y": rounded(origin_full["y"] - crop_y),
        },
        "window": WITNESS_WINDOW,
        "sourceCropPx": {"x": crop_x, "y": crop_y},
        "assetPath": output_path.name,
        "threshold": 160,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--output-json", required=True, type=Path)
    parser.add_argument("--output-png", required=True, type=Path)
    parser.add_argument("--output-geometry", required=True, type=Path)
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
        leads, outlines, cathode = select_objects(page)
        definition, origin_pdf, logical_scale = symbol_definition(outlines[0], cathode)
        selected = [*leads, *outlines, cathode]
        selected_fingerprints = [fingerprint(value) for value in selected]
        native_hash = hashlib.sha256(
            json.dumps(selected_fingerprints, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        raster = render_witness(
            pdf_path,
            page,
            origin_pdf,
            args.output_png.resolve(),
            args.pdftoppm,
        )

    evidence = {
        "schemaVersion": 1,
        "id": "razavi-textbook-zener-diode",
        "kind": "pdf-vector-extract",
        "source": {
            "title": TITLE,
            "sha256": source_hash,
            "pdfPage": PDF_PAGE,
            "printedPage": PRINTED_PAGE,
            "figure": FIGURE,
        },
        "selection": {
            "method": "direct-device-vector-normalization",
            "boundsPdf": {
                "left": SOURCE_BOUNDS[0], "top": SOURCE_BOUNDS[1],
                "right": SOURCE_BOUNDS[2], "bottom": SOURCE_BOUNDS[3],
            },
            "nativeObjectCount": len(selected_fingerprints),
            "nativeObjectSha256": native_hash,
            "nativeObjects": selected_fingerprints,
        },
        "normalization": {
            "originPdf": {"x": rounded(origin_pdf[0]), "y": rounded(origin_pdf[1])},
            "logicalUnitsPerPdfPoint": rounded(logical_scale),
            "pinAnchorsLogical": [{"name": "A", "x": -20, "y": 0}, {"name": "K", "x": 20, "y": 0}],
            "strokeMapping": {
                "normal": {"sourcePdfPt": NORMAL_SOURCE_STROKE, "targetRole": "normal"},
                "cathode": {"sourcePdfPt": EMPHASIS_SOURCE_STROKE, "targetRole": "emphasis"},
            },
            "symbolDefinition": definition,
        },
        "derivation": {
            "orientation": "native vertical symbol rotated into the canonical A-left/K-right product orientation",
            "pinExtension": "native circuit leads replaced by symmetric leads ending at the nearest 20-unit anchors",
            "topology": "native open diode outline and native four-segment bent Zener cathode retained",
        },
        "rasterWitness": raster,
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8", newline="\n")
    geometry = {
        "schemaVersion": 1,
        "referenceId": "razavi-reference-v1",
        "symbols": {
            "zener-diode": {
                "assetPath": raster["assetPath"],
                "pixelsPerLogical": raster["pixelsPerLogical"],
                "originPx": raster["originPx"],
                "window": raster["window"],
            }
        },
    }
    args.output_geometry.parent.mkdir(parents=True, exist_ok=True)
    args.output_geometry.write_text(json.dumps(geometry, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("Extracted razavi-textbook-zener-diode")


if __name__ == "__main__":
    main()
