#!/usr/bin/env python3
"""Extract Data Converters clock-pulse and timing-waveform visual evidence.

The extracted regions are visual references, not executable circuit semantics.
The Pulse Voltage Source composes the already reviewed Razavi voltage-source
body with the square-step language evidenced by Figure 16.8. Figure 20.54 is
reserved for the waveform renderer's trace stack, guides, labels, and time axis.
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


EXPECTED_PDF_SHA256 = "8a5c1bb42a5e32a84cd6af53e2f43db79ea8f511552c913ec65d2caa1d90a028"
TITLE = "Analysis and Design of Data Converters"
RASTER_DPI = 200

SPECS = {
    "data-converters-clock-pulse": {
        "id": "razavi-data-converters-clock-pulse",
        "pdfPage": 352,
        "printedPage": 334,
        "figure": "16.8",
        "bounds": (55.0, 350.0, 505.0, 445.0),
        "scope": [
            "square clock-step proportions",
            "narrow pulse and pulse-width marker treatment",
        ],
        "derivation": (
            "The source figure contains a pulse-generator circuit and waveforms, "
            "not a standalone voltage-source Symbol. Product artwork may compose "
            "its square-step mark with the separately reviewed independent "
            "voltage-source body; electrical pins remain product semantics."
        ),
    },
    "data-converters-timing-waveform": {
        "id": "razavi-data-converters-timing-waveform",
        "pdfPage": 491,
        "printedPage": 473,
        "figure": "20.54",
        "bounds": (55.0, 470.0, 505.0, 595.0),
        "scope": [
            "stacked digital timing traces and left-side signal labels",
            "dashed event guides and horizontal time axis",
        ],
        "derivation": (
            "The circuit and waveform remain visual evidence only. The simulation "
            "engine derives transitions from current Document connectivity and "
            "never reads pixels or extracted geometry."
        ),
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rounded(value: float) -> float:
    return round(float(value), 6)


def inside(bounds: tuple[float, float, float, float], obj: dict[str, Any]) -> bool:
    left, top, right, bottom = bounds
    center_x = (float(obj["x0"]) + float(obj["x1"])) / 2
    center_y = (float(obj["top"]) + float(obj["bottom"])) / 2
    return left <= center_x <= right and top <= center_y <= bottom


def fingerprint(obj: dict[str, Any]) -> dict[str, Any]:
    path = obj.get("path") or []
    encoded = json.dumps(path, sort_keys=True, separators=(",", ":"), default=str).encode()
    return {
        "objectType": obj.get("object_type"),
        "x0": rounded(obj["x0"]),
        "top": rounded(obj["top"]),
        "x1": rounded(obj["x1"]),
        "bottom": rounded(obj["bottom"]),
        "linewidth": rounded(obj.get("linewidth", 0) or 0),
        "fill": bool(obj.get("fill")),
        "stroke": bool(obj.get("stroke")),
        "pathCommandCount": len(path),
        "pathSha256": hashlib.sha256(encoded).hexdigest(),
    }


def render_witness(
    pdf_path: Path,
    page_number: int,
    bounds: tuple[float, float, float, float],
    output_path: Path,
    pdftoppm: str,
) -> dict[str, Any]:
    scale = RASTER_DPI / 72
    left, top, right, bottom = bounds
    crop_x = math.floor(left * scale)
    crop_y = math.floor(top * scale)
    width = math.ceil((right - left) * scale)
    height = math.ceil((bottom - top) * scale)
    executable = shutil.which(pdftoppm) or pdftoppm
    with tempfile.TemporaryDirectory(prefix="razavi-digital-simulation-") as temp_dir:
        raster_base = Path(temp_dir) / "source"
        subprocess.run(
            [
                executable,
                "-f",
                str(page_number),
                "-l",
                str(page_number),
                "-r",
                str(RASTER_DPI),
                "-png",
                "-singlefile",
                "-x",
                str(crop_x),
                "-y",
                str(crop_y),
                "-W",
                str(width),
                "-H",
                str(height),
                str(pdf_path),
                str(raster_base),
            ],
            check=True,
            capture_output=True,
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(raster_base.with_suffix(".png")) as source_image:
            image = source_image.convert("RGBA")
            if image.size != (width, height):
                raise RuntimeError(
                    f"Razavi digital evidence witness {image.size} != {(width, height)}"
                )
            image.save(output_path, format="PNG", optimize=False)
    return {
        "kind": "source-pdf-crop",
        "sourcePdfPage": page_number,
        "dpi": RASTER_DPI,
        "pixels": {"width": width, "height": height},
        "selectionBoundsPdf": {
            "left": left,
            "top": top,
            "right": right,
            "bottom": bottom,
        },
        "sourceCropPx": {"x": crop_x, "y": crop_y},
        "assetPath": output_path.name,
        "threshold": 160,
    }


def extract_one(
    pdf_path: Path,
    output_root: Path,
    spec: dict[str, Any],
    source_hash: str,
    pdf: Any,
    pdftoppm: str,
) -> None:
    page = pdf.pages[spec["pdfPage"] - 1]
    objects = [
        fingerprint(obj)
        for obj in [*page.lines, *page.curves, *page.rects]
        if inside(spec["bounds"], obj)
    ]
    words = [
        {
            "text": word["text"],
            "x0": rounded(word["x0"]),
            "top": rounded(word["top"]),
            "x1": rounded(word["x1"]),
            "bottom": rounded(word["bottom"]),
        }
        for word in page.extract_words()
        if inside(spec["bounds"], word)
    ]
    selection_hash = hashlib.sha256(
        json.dumps(
            {"objects": objects, "words": words},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    asset_name = f"{spec['id'].removeprefix('razavi-')}-reference.png"
    raster = render_witness(
        pdf_path,
        spec["pdfPage"],
        spec["bounds"],
        output_root / asset_name,
        pdftoppm,
    )
    evidence = {
        "schemaVersion": 1,
        "id": spec["id"],
        "kind": "pdf-vector-extract",
        "source": {
            "title": TITLE,
            "sha256": source_hash,
            "pdfPage": spec["pdfPage"],
            "printedPage": spec["printedPage"],
            "figure": spec["figure"],
        },
        "selection": {
            "method": "direct-source-region-vector-fingerprint",
            "boundsPdf": {
                "left": spec["bounds"][0],
                "top": spec["bounds"][1],
                "right": spec["bounds"][2],
                "bottom": spec["bounds"][3],
            },
            "nativeObjectCount": len(objects),
            "textObjectCount": len(words),
            "nativeSelectionSha256": selection_hash,
            "nativeObjects": objects,
            "textObjects": words,
        },
        "derivation": {
            "visualScope": spec["scope"],
            "semanticBoundary": spec["derivation"],
        },
        "rasterWitness": raster,
    }
    output_path = output_root / f"{spec['id'].removeprefix('razavi-')}-vector-source.json"
    output_path.write_text(
        json.dumps(evidence, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--pdftoppm", default="pdftoppm")
    args = parser.parse_args()

    source_hash = sha256(args.pdf)
    if source_hash != EXPECTED_PDF_SHA256:
        raise RuntimeError(
            f"Unexpected Data Converters PDF SHA-256 {source_hash}; "
            f"expected {EXPECTED_PDF_SHA256}"
        )
    args.output_root.mkdir(parents=True, exist_ok=True)
    with pdfplumber.open(args.pdf) as pdf:
        for spec in SPECS.values():
            extract_one(
                args.pdf,
                args.output_root,
                spec,
                source_hash,
                pdf,
                args.pdftoppm,
            )


if __name__ == "__main__":
    main()
