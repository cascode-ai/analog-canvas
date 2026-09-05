#!/usr/bin/env python3
"""Extract layout evidence for the Razavi XFMR and bridged T-coil.

The product Symbols deliberately reuse the reviewed Analog Canvas Inductor and
Capacitor artwork.  This extractor therefore records source-native placement,
polarity-dot, and topology measurements instead of creating a second coil
curve.  It also emits direct source-PDF crop witnesses for visual regression.
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


XFMR_SHA256 = "489edabe3248a336806a249d099401c94aab0b26913a6dee16d754e9e36baf31"
TCOIL_SHA256 = "30543c6d78f1ca1e3019746520319eeb39948899294bb8f4d792870b84b2b676"
RASTER_DPI = 300.0


def fail(message: str) -> None:
    raise RuntimeError(f"Razavi magnetic-component extraction: {message}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rounded(value: float) -> float:
    result = round(float(value), 6)
    return 0.0 if result == -0.0 else result


def box_of(obj: dict[str, Any]) -> dict[str, float]:
    return {
        "left": rounded(obj["x0"]),
        "top": rounded(obj["top"]),
        "right": rounded(obj["x1"]),
        "bottom": rounded(obj["bottom"]),
    }


def close(value: float, expected: float, tolerance: float = 0.02) -> bool:
    return abs(float(value) - expected) <= tolerance


def find_curve(
    page: Any,
    expected_box: tuple[float, float, float, float],
    command_count: int,
    *,
    fill: bool | None = None,
) -> dict[str, Any]:
    x0, top, x1, bottom = expected_box
    candidates = []
    for curve in page.curves:
        if len(curve.get("path") or []) != command_count:
            continue
        if fill is not None and bool(curve.get("fill")) != fill:
            continue
        if all(
            close(curve[key], expected)
            for key, expected in (
                ("x0", x0),
                ("top", top),
                ("x1", x1),
                ("bottom", bottom),
            )
        ):
            candidates.append(curve)
    if len(candidates) != 1:
        fail(f"expected one curve at {expected_box}, found {len(candidates)}")
    return candidates[0]


def center(obj: dict[str, Any]) -> dict[str, float]:
    return {
        "x": rounded((float(obj["x0"]) + float(obj["x1"])) / 2),
        "y": rounded((float(obj["top"]) + float(obj["bottom"])) / 2),
    }


def render_crop(
    pdf_path: Path,
    pdf_page: int,
    page: Any,
    crop_pdf: tuple[float, float, float, float],
    output_path: Path,
    pdftoppm: str,
    origin_pdf: tuple[float, float],
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="razavi-magnetic-") as temp_dir:
        raster_base = Path(temp_dir) / "page"
        executable = (
            shutil.which(f"{pdftoppm}.exe") if Path(pdftoppm).suffix == "" else None
        ) or shutil.which(pdftoppm) or pdftoppm
        subprocess.run(
            [
                executable,
                "-f",
                str(pdf_page),
                "-l",
                str(pdf_page),
                "-r",
                f"{RASTER_DPI:g}",
                "-png",
                "-singlefile",
                str(pdf_path),
                str(raster_base),
            ],
            check=True,
            capture_output=True,
        )
        with Image.open(raster_base.with_suffix(".png")) as rendered:
            page_width_px, page_height_px = rendered.size
            scale_x = page_width_px / float(page.width)
            scale_y = page_height_px / float(page.height)
            page_left, page_top = float(page.bbox[0]), float(page.bbox[1])
            left, top, right, bottom = crop_pdf
            crop_box = (
                math.floor((left - page_left) * scale_x),
                math.floor((top - page_top) * scale_y),
                math.ceil((right - page_left) * scale_x),
                math.ceil((bottom - page_top) * scale_y),
            )
            crop = rendered.convert("RGBA").crop(crop_box)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            crop.save(output_path, format="PNG", optimize=False)

    origin_page_px = {
        "x": (origin_pdf[0] - page_left) * scale_x,
        "y": (origin_pdf[1] - page_top) * scale_y,
    }
    return {
        "kind": "source-pdf-crop",
        "sourcePdfPage": pdf_page,
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
        "originPx": {
            "x": rounded(origin_page_px["x"] - crop_box[0]),
            "y": rounded(origin_page_px["y"] - crop_box[1]),
        },
        "pagePixelsPerPdfPoint": {"x": scale_x, "y": scale_y},
        "pdfplumberMediaBoxOffset": {"x": page_left, "y": page_top},
        "assetPath": output_path.name,
    }


def extract_xfmr(pdf_path: Path, output_dir: Path, pdftoppm: str) -> None:
    source_hash = sha256(pdf_path)
    if source_hash != XFMR_SHA256:
        fail(f"XFMR source PDF SHA-256 mismatch: {source_hash}")
    pdf_page = 8
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[pdf_page - 1]
        upper = find_curve(page, (443.502, 87.061, 466.984, 94.125), 24, fill=False)
        lower = find_curve(page, (443.502, 97.815, 466.984, 104.88), 24, fill=False)
        upper_dot = find_curve(page, (465.136, 83.992, 467.825, 86.681), 5, fill=True)
        lower_dot = find_curve(page, (465.136, 105.501, 467.825, 108.189), 5, fill=True)
        upper_center = center(upper)
        lower_center = center(lower)
        origin = (
            (upper_center["x"] + lower_center["x"]) / 2,
            (upper_center["y"] + lower_center["y"]) / 2,
        )
        raster = render_crop(
            pdf_path,
            pdf_page,
            page,
            (439.5, 80.5, 471.0, 111.5),
            output_dir / "xfmr-reference.png",
            pdftoppm,
            origin,
        )

    evidence = {
        "schemaVersion": 1,
        "id": "razavi-ojsscs-figure-19-xfmr",
        "kind": "pdf-vector-extract",
        "source": {
            "title": "LO Generation Techniques for Millimeter-Wave Receivers",
            "sha256": source_hash,
            "pdfPage": pdf_page,
            "printedPage": 8,
            "figure": "19(a)",
        },
        "selection": {
            "method": "native-vector object fingerprints",
            "coilPaths": [box_of(upper), box_of(lower)],
            "polarityDots": [center(upper_dot), center(lower_dot)],
            "sourceLineWidthPdfPt": rounded(upper["linewidth"]),
        },
        "normalization": {
            "reuseSymbolId": "inductor-compact",
            "sourceCoilPinSpanPdfPt": rounded(upper["x1"] - upper["x0"]),
            "sourceCoilCenterSeparationPdfPt": rounded(
                lower_center["y"] - upper_center["y"]
            ),
            "productCoilPinSpanLogical": 40,
            "productCoilCentersLogical": [
                {"x": 0, "y": -10},
                {"x": 0, "y": 10},
            ],
            "productPinAnchorsLogical": [
                {"name": "P-", "x": -30, "y": -10},
                {"name": "P+", "x": 30, "y": -10},
                {"name": "S-", "x": -30, "y": 10},
                {"name": "S+", "x": 30, "y": 10},
            ],
            "productPolarityDotsLogical": [
                {"x": 19.15, "y": -20.4, "radius": 3.2},
                {"x": 19.15, "y": 20.4, "radius": 3.2},
            ],
            "endpointMarkers": "none",
        },
        "rasterWitness": raster,
    }
    (output_dir / "xfmr-vector-source.json").write_text(
        json.dumps(evidence, indent=2) + "\n", encoding="utf-8"
    )


def extract_tcoil(pdf_path: Path, output_dir: Path, pdftoppm: str) -> None:
    source_hash = sha256(pdf_path)
    if source_hash != TCOIL_SHA256:
        fail(f"T-coil source PDF SHA-256 mismatch: {source_hash}")
    pdf_page = 1
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[pdf_page - 1]
        left_coil = find_curve(
            page, (250.6188, 666.8859, 283.2098, 673.7439), 24, fill=False
        )
        right_coil = find_curve(
            page, (287.1568, 666.8859, 319.7468, 673.7439), 24, fill=False
        )
        left_dot = find_curve(
            page, (256.7361, 665.3739, 259.3451, 667.9839), 5, fill=True
        )
        right_dot = find_curve(
            page, (293.2928, 665.3739, 295.9028, 667.9839), 5, fill=True
        )
        origin = (285.9768, 670.4437)
        raster = render_crop(
            pdf_path,
            pdf_page,
            page,
            (235.0, 644.5, 332.0, 685.0),
            output_dir / "tcoil-reference.png",
            pdftoppm,
            origin,
        )

    evidence = {
        "schemaVersion": 1,
        "id": "razavi-bridged-tcoil-figure-2",
        "kind": "pdf-vector-extract",
        "source": {
            "title": "The Bridged T-Coil",
            "sha256": source_hash,
            "pdfPage": pdf_page,
            "printedPage": 9,
            "figure": "2",
        },
        "selection": {
            "method": "native-vector object fingerprints",
            "coilPaths": [box_of(left_coil), box_of(right_coil)],
            "polarityDots": [center(left_dot), center(right_dot)],
            "sourceLineWidthPdfPt": rounded(left_coil["linewidth"]),
        },
        "normalization": {
            "reuseSymbolIds": ["inductor-compact", "capacitor"],
            "productCoilCentersLogical": [
                {"x": -20, "y": 0},
                {"x": 20, "y": 0},
            ],
            "productCapacitorCenterLogical": {"x": 0, "y": -30},
            "productPinAnchorsLogical": [
                {"name": "1", "x": -50, "y": 0},
                {"name": "2", "x": 50, "y": 0},
                {"name": "3", "x": 0, "y": 30},
            ],
            "productPolarityDotsLogical": [
                {"x": -31, "y": -9, "radius": 3.2},
                {"x": 9, "y": -9, "radius": 3.2},
            ],
            "productJunctionDotsLogical": [
                {"x": -40, "y": 0, "radius": 3.2},
                {"x": 0, "y": 0, "radius": 3.2},
                {"x": 40, "y": 0, "radius": 3.2},
            ],
            "endpointMarkers": "none",
        },
        "rasterWitness": raster,
    }
    (output_dir / "tcoil-vector-source.json").write_text(
        json.dumps(evidence, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xfmr-pdf", required=True, type=Path)
    parser.add_argument("--tcoil-pdf", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--pdftoppm", default="pdftoppm")
    args = parser.parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    extract_xfmr(args.xfmr_pdf.resolve(), output_dir, args.pdftoppm)
    extract_tcoil(args.tcoil_pdf.resolve(), output_dir, args.pdftoppm)
    print("Extracted Razavi XFMR and bridged T-coil layout evidence")


if __name__ == "__main__":
    main()
