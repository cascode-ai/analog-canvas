#!/usr/bin/env python3
"""Extract the Razavi Buffer and generic D flip-flop as native PDF evidence.

This source extractor is deliberately separate from the raster fidelity runner.
It fingerprints the native vectors, normalizes them onto product pin anchors,
and emits direct PDF crop witnesses for later regression comparison.
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
from typing import Any, Callable

import pdfplumber
from PIL import Image


EXPECTED_PDF_SHA256 = "a6031d1149c2c6191a1f0e541065165b72dafc4bc4ab4b0ea37af41b7cb0f739"
TITLE = "Design of Analog CMOS Integrated Circuits, Second Edition"
PIXELS_PER_LOGICAL = 2.4
NORMAL = {"strokeRole": "normal", "lineCap": "butt", "lineJoin": "miter"}
EMPHASIS = {
    "strokeRole": "emphasis",
    "lineCap": "butt",
    "lineJoin": "miter",
    "miterLimit": 4,
}


def rounded(value: float) -> float:
    return round(float(value), 6)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def close(left: float, right: float, tolerance: float = 0.02) -> bool:
    return math.isclose(float(left), float(right), abs_tol=tolerance)


def find_object(
    page: Any,
    object_type: str,
    bounds: tuple[float, float, float, float],
    *,
    linewidth: float | None = None,
) -> dict[str, Any]:
    for obj in [*page.lines, *page.curves, *page.rects]:
        if obj.get("object_type") != object_type:
            continue
        actual = tuple(float(obj[key]) for key in ("x0", "top", "x1", "bottom"))
        if not all(close(value, expected) for value, expected in zip(actual, bounds)):
            continue
        if linewidth is not None and not close(
            float(obj.get("linewidth", 0) or 0), linewidth, 0.002
        ):
            continue
        return obj
    raise RuntimeError(
        f"Razavi Buffer/DFF extraction: missing {object_type} {bounds} "
        f"on PDF page {page.page_number}"
    )


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


Transform = Callable[[float, float], tuple[float, float]]


def make_transform(origin_x: float, origin_y: float, scale: float) -> Transform:
    def transform(x: float, y: float) -> tuple[float, float]:
        return (rounded((x - origin_x) * scale), rounded((y - origin_y) * scale))

    return transform


def path_data(obj: dict[str, Any], transform: Transform) -> str:
    commands: list[str] = []
    current: tuple[float, float] | None = None
    for raw in obj.get("path") or []:
        command, *points = raw
        mapped = [transform(float(point[0]), float(point[1])) for point in points]
        if command == "m":
            current = mapped[0]
            commands.append(f"M {current[0]} {current[1]}")
        elif command == "l":
            current = mapped[0]
            commands.append(f"L {current[0]} {current[1]}")
        elif command == "c":
            first, second, end = mapped
            current = end
            commands.append(
                f"C {first[0]} {first[1]} {second[0]} {second[1]} {end[0]} {end[1]}"
            )
        elif command == "h":
            commands.append("Z")
        else:
            raise RuntimeError(
                f"Razavi Buffer/DFF extraction: unsupported PDF path command {command}"
            )
    return " ".join(commands)


def line(start: tuple[float, float], end: tuple[float, float], *, style=NORMAL) -> dict[str, Any]:
    return {
        "kind": "line",
        "from": {"x": rounded(start[0]), "y": rounded(start[1])},
        "to": {"x": rounded(end[0]), "y": rounded(end[1])},
        "style": style,
    }


def pin(
    name: str,
    role: str,
    x: int,
    y: int,
    direction: str,
    *,
    show_name: bool = False,
    display_name: str | None = None,
    text_style: str | None = None,
    text_size_scale: float | None = None,
) -> dict[str, Any]:
    presentation: dict[str, Any] = {"visibility": "visible", "leadLength": 20}
    if show_name:
        presentation["showName"] = True
    if display_name is not None:
        presentation["displayName"] = display_name
    if text_style is not None:
        presentation["textStyle"] = text_style
    if text_size_scale is not None:
        presentation["textSizeScale"] = text_size_scale
    return {
        "name": name,
        "role": role,
        "at": {"x": x, "y": y},
        "direction": direction,
        "presentation": presentation,
    }


def extract_buffer(page: Any) -> tuple[list[dict[str, Any]], dict[str, Any], tuple[float, float], float]:
    input_lead = find_object(page, "line", (150.978, 336.1832, 164.403, 336.1832), linewidth=0.717)
    output_lead = find_object(page, "line", (185.66, 336.1832, 193.27, 336.1832), linewidth=0.717)
    triangle = find_object(page, "curve", (164.4, 323.9012, 185.582, 349.5412), linewidth=1.434)

    # Figure 16.53 draws the same triangle family at a larger native scale than
    # Figure 16.25. Preserve its aspect ratio while matching the reviewed
    # inverter body's 28.748801 logical-unit height.
    scale = 28.748801 / (349.5412 - 323.9012)
    origin = (
        164.4 + 14.727526 / scale,
        336.1642,
    )
    transform = make_transform(*origin, scale)
    body_input = transform(float(triangle["x0"]), origin[1])
    body_output = transform(float(triangle["x1"]), origin[1])
    definition = {
        "schemaVersion": 1,
        "id": "buffer",
        "name": "Buffer",
        "viewBox": {"x": -44, "y": -24, "width": 88, "height": 48},
        "pins": [
            pin("A", "input", -40, 0, "west"),
            pin("Y", "output", 40, 0, "east"),
        ],
        "primitives": [
            line((-40, 0), body_input),
            {"kind": "path", "data": path_data(triangle, transform), "style": EMPHASIS},
            # The lead begins exactly on the vector apex: neither a gap nor an
            # intrusion is encoded in the reusable Symbol geometry.
            line(body_output, (40, 0)),
        ],
        "variants": [],
    }
    return [input_lead, output_lead, triangle], definition, origin, scale


def extract_dff(page: Any) -> tuple[list[dict[str, Any]], dict[str, Any], tuple[float, float], float]:
    body = find_object(page, "rect", (284.233, 40.4612, 313.48, 69.7072), linewidth=1.434)
    input_d = find_object(page, "line", (269.61, 47.7722, 284.233, 47.7722), linewidth=0.717)
    input_ck = find_object(page, "line", (269.61, 62.3962, 284.233, 62.3962), linewidth=0.717)
    output_q = find_object(page, "line", (313.404, 47.7722, 328.027, 47.7722), linewidth=0.717)
    output_qbar = find_object(page, "line", (313.404, 62.3962, 328.027, 62.3962), linewidth=0.717)
    overbar = find_object(page, "line", (305.208, 58.1912, 311.545, 58.1912), linewidth=0.717)

    scale = 40.0 / (float(body["bottom"]) - float(body["top"]))
    origin = (
        (float(body["x0"]) + float(body["x1"])) / 2,
        (float(body["top"]) + float(body["bottom"])) / 2,
    )
    transform = make_transform(*origin, scale)
    body_left, body_top = transform(float(body["x0"]), float(body["top"]))
    body_right, body_bottom = transform(float(body["x1"]), float(body["bottom"]))
    overbar_from = transform(float(overbar["x0"]), float(overbar["top"]))
    overbar_to = transform(float(overbar["x1"]), float(overbar["top"]))
    definition = {
        "schemaVersion": 1,
        "id": "d-flip-flop",
        "name": "D Flip-Flop",
        "viewBox": {"x": -44, "y": -24, "width": 88, "height": 48},
        "pins": [
            pin("D", "input", -40, -10, "west", show_name=True, text_style="math-symbol", text_size_scale=0.68),
            pin("CK", "clock", -40, 10, "west", show_name=True, text_style="math-symbol", text_size_scale=0.68),
            pin("Q", "output", 40, -10, "east", show_name=True, text_style="math-symbol", text_size_scale=0.68),
            pin(
                "QBAR",
                "output-complement",
                40,
                10,
                "east",
                show_name=True,
                display_name="Q",
                text_style="math-symbol",
                text_size_scale=0.68,
            ),
        ],
        "primitives": [
            line((-40, -10), (body_left, -10)),
            line((-40, 10), (body_left, 10)),
            {
                "kind": "path",
                "data": (
                    f"M {body_left} {body_top} L {body_right} {body_top} "
                    f"L {body_right} {body_bottom} L {body_left} {body_bottom} Z"
                ),
                "style": EMPHASIS,
            },
            line((body_right, -10), (40, -10)),
            line((body_right, 10), (40, 10)),
            line(overbar_from, overbar_to),
        ],
        "variants": [],
    }
    return [body, input_d, input_ck, output_q, output_qbar, overbar], definition, origin, scale


SPECS: dict[str, dict[str, Any]] = {
    "buffer": {
        "pdfPage": 703,
        "printedPage": 684,
        "figure": "16.53(a)",
        "extract": extract_buffer,
        "witnessWindow": {"width": 31, "height": 36, "minX": -18, "minY": -18},
        "scope": "direct buffer triangle and lead/body seams",
    },
    "d-flip-flop": {
        "pdfPage": 687,
        "printedPage": 668,
        "figure": "16.23(a)",
        "extract": extract_dff,
        "witnessWindow": {"width": 78, "height": 48, "minX": -39, "minY": -24},
        "scope": "generic D/CK/Q/Q-bar flip-flop block without external circuit ports",
    },
}


def render_witness(
    pdf_path: Path,
    page: Any,
    source_origin: tuple[float, float],
    scale: float,
    window: dict[str, float],
    output: Path,
    pdftoppm: str,
) -> dict[str, Any]:
    width = round(window["width"] * PIXELS_PER_LOGICAL)
    height = round(window["height"] * PIXELS_PER_LOGICAL)
    pixels_per_point = PIXELS_PER_LOGICAL * scale
    dpi = 72 * pixels_per_point
    media_left, media_top, _, _ = page.mediabox
    origin_full = {
        "x": (source_origin[0] - float(media_left)) * pixels_per_point,
        "y": (source_origin[1] - float(media_top)) * pixels_per_point,
    }
    crop_x = math.floor(origin_full["x"] + window["minX"] * PIXELS_PER_LOGICAL)
    crop_y = math.floor(origin_full["y"] + window["minY"] * PIXELS_PER_LOGICAL)
    executable = shutil.which(pdftoppm) or pdftoppm
    with tempfile.TemporaryDirectory(prefix="razavi-buffer-dff-") as temp_dir:
        raster_base = Path(temp_dir) / "source"
        subprocess.run(
            [
                executable,
                "-f",
                str(page.page_number),
                "-l",
                str(page.page_number),
                "-r",
                f"{dpi:.9f}",
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
        output.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(raster_base.with_suffix(".png")) as source_image:
            image = source_image.convert("RGBA")
            if image.size != (width, height):
                raise RuntimeError(
                    f"Razavi Buffer/DFF extraction: witness {image.size} != {(width, height)}"
                )
            image.save(output, format="PNG", optimize=False)
    return {
        "kind": "source-pdf-crop",
        "sourcePdfPage": page.page_number,
        "dpi": rounded(dpi),
        "pixels": {"width": width, "height": height},
        "pixelsPerLogical": PIXELS_PER_LOGICAL,
        "originPx": {
            "x": rounded(origin_full["x"] - crop_x),
            "y": rounded(origin_full["y"] - crop_y),
        },
        "window": {
            "width": width,
            "height": height,
            "minX": window["minX"],
            "minY": window["minY"],
        },
        "rotation": 0,
        "sourceCropPx": {"x": crop_x, "y": crop_y},
        "assetPath": output.name,
        "threshold": 160,
    }


def extract_one(
    pdf_path: Path,
    output_root: Path,
    asset_id: str,
    pdftoppm: str,
    source_hash: str,
    pdf: Any,
) -> None:
    spec = SPECS[asset_id]
    page = pdf.pages[spec["pdfPage"] - 1]
    objects, definition, origin, scale = spec["extract"](page)
    selected = [fingerprint(obj) for obj in objects]
    selected_hash = hashlib.sha256(
        json.dumps(selected, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    raster = render_witness(
        pdf_path,
        page,
        origin,
        scale,
        spec["witnessWindow"],
        output_root / f"{asset_id}-reference.png",
        pdftoppm,
    )
    evidence = {
        "schemaVersion": 1,
        "id": f"razavi-textbook-{asset_id}",
        "kind": "pdf-vector-extract",
        "source": {
            "title": TITLE,
            "sha256": source_hash,
            "pdfPage": spec["pdfPage"],
            "printedPage": spec["printedPage"],
            "figure": spec["figure"],
        },
        "selection": {
            "method": "direct-buffer-dff-vector-normalization",
            "scope": spec["scope"],
            "nativeObjectCount": len(selected),
            "nativeObjectSha256": selected_hash,
            "nativeObjects": selected,
        },
        "normalization": {
            "logicalUnitsPerPdfPoint": rounded(scale),
            "sourceOriginPdf": {"x": rounded(origin[0]), "y": rounded(origin[1])},
            "pinAnchorsLogical": [
                {"name": value["name"], **value["at"]} for value in definition["pins"]
            ],
            "strokeMapping": {
                "normal": {"sourcePdfPt": 0.717, "targetRole": "normal"},
                "body": {"sourcePdfPt": 1.434, "targetRole": "emphasis"},
            },
            "symbolDefinition": definition,
        },
        "derivation": {
            "pinExtension": "native leads extend collinearly to the existing x=+/-40 electrical anchors",
            "semantics": "pin identity is reconstructed explicitly; only visual geometry comes from PDF vectors",
        },
        "rasterWitness": raster,
    }
    (output_root / f"{asset_id}-vector-source.json").write_text(
        json.dumps(evidence, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def write_geometry_registry(output_root: Path) -> None:
    symbols: dict[str, Any] = {}
    for asset_id in SPECS:
        evidence = json.loads(
            (output_root / f"{asset_id}-vector-source.json").read_text(encoding="utf-8")
        )
        witness = evidence["rasterWitness"]
        symbols[asset_id] = {
            "assetPath": witness["assetPath"],
            "pixelsPerLogical": witness["pixelsPerLogical"],
            "originPx": witness["originPx"],
            "window": witness["window"],
            "rotation": witness["rotation"],
        }
    registry = {
        "schemaVersion": 1,
        "referenceId": "razavi-reference-v1",
        "family": {
            "kind": "direct-pdf-vector",
            "semanticBoundary": "electrical pins are reconstructed; visual geometry is source-owned",
        },
        "symbols": symbols,
    }
    (output_root / "buffer-dff-geometry.json").write_text(
        json.dumps(registry, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--asset", choices=[*SPECS, "all"], default="all")
    parser.add_argument("--pdftoppm", default="pdftoppm")
    args = parser.parse_args()
    pdf_path = args.pdf.resolve()
    source_hash = sha256(pdf_path)
    if source_hash != EXPECTED_PDF_SHA256:
        raise RuntimeError(
            f"Razavi Buffer/DFF extraction: source PDF SHA-256 mismatch: {source_hash}"
        )
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    assets = SPECS.keys() if args.asset == "all" else [args.asset]
    with pdfplumber.open(pdf_path) as pdf:
        for asset_id in assets:
            extract_one(pdf_path, output_root, asset_id, args.pdftoppm, source_hash, pdf)
            print(f"Extracted razavi-textbook-{asset_id}")
    if args.asset == "all":
        write_geometry_registry(output_root)


if __name__ == "__main__":
    main()
