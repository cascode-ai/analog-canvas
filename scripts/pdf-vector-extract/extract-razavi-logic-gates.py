#!/usr/bin/env python3
"""Extract Razavi logic-gate vectors and direct PDF crop witnesses.

The extractor is intentionally independent from the raster fidelity runner.
It fingerprints native objects in Figures 16.2, 16.24, and 16.25, maps the
11.469 pt two-input pitch to the product's 20-unit pin pitch, and emits five
direct SymbolDefinitions. OR and XNOR remain generator-level compositions of
the reviewed NOR/XOR bodies and the reviewed two-input negation bubble.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable

import pdfplumber
from PIL import Image


EXPECTED_PDF_SHA256 = "a6031d1149c2c6191a1f0e541065165b72dafc4bc4ab4b0ea37af41b7cb0f739"
TITLE = "Design of Analog CMOS Integrated Circuits, Second Edition"
RASTER_DPI = 300.0
PIXELS_PER_LOGICAL = 2.4
SOURCE_INPUT_PITCH = 11.469
LOGICAL_INPUT_PITCH = 20.0
SCALE = LOGICAL_INPUT_PITCH / SOURCE_INPUT_PITCH
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
    candidates = [*page.lines, *page.curves, *page.rects]
    for obj in candidates:
        if obj.get("object_type") != object_type:
            continue
        actual = tuple(float(obj[key]) for key in ("x0", "top", "x1", "bottom"))
        if not all(close(value, expected) for value, expected in zip(actual, bounds)):
            continue
        if linewidth is not None and not close(float(obj.get("linewidth", 0) or 0), linewidth, 0.002):
            continue
        return obj
    raise RuntimeError(
        f"Razavi logic-gate extraction: missing {object_type} {bounds} on PDF page {page.page_number}"
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


def make_horizontal_transform(
    origin_x: float, origin_y: float, *, reverse_x: bool = False
) -> Transform:
    direction = -1 if reverse_x else 1

    def transform(x: float, y: float) -> tuple[float, float]:
        return (
            rounded(direction * (x - origin_x) * SCALE),
            rounded((y - origin_y) * SCALE),
        )

    return transform


def make_down_to_right_transform(origin_x: float, origin_y: float) -> Transform:
    def transform(x: float, y: float) -> tuple[float, float]:
        return (
            rounded((y - origin_y) * SCALE),
            rounded((x - origin_x) * SCALE),
        )

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
        elif command == "v":
            if current is None:
                raise RuntimeError("Razavi logic-gate extraction: v before move")
            second, end = mapped
            commands.append(
                f"C {current[0]} {current[1]} {second[0]} {second[1]} {end[0]} {end[1]}"
            )
            current = end
        elif command == "y":
            first, end = mapped
            commands.append(
                f"C {first[0]} {first[1]} {end[0]} {end[1]} {end[0]} {end[1]}"
            )
            current = end
        elif command == "h":
            commands.append("Z")
        else:
            raise RuntimeError(f"Razavi logic-gate extraction: unsupported PDF path command {command}")
    return " ".join(commands)


def line(start: tuple[float, float], end: tuple[float, float]) -> dict[str, Any]:
    return {
        "kind": "line",
        "from": {"x": rounded(start[0]), "y": rounded(start[1])},
        "to": {"x": rounded(end[0]), "y": rounded(end[1])},
        "style": NORMAL,
    }


def path(obj: dict[str, Any], transform: Transform) -> dict[str, Any]:
    return {"kind": "path", "data": path_data(obj, transform), "style": EMPHASIS}


def circle_from_object(
    obj: dict[str, Any], transform: Transform, *, part: str = "negation-bubble"
) -> dict[str, Any]:
    center_pdf = (
        (float(obj["x0"]) + float(obj["x1"])) / 2,
        (float(obj["top"]) + float(obj["bottom"])) / 2,
    )
    center = transform(*center_pdf)
    radius = rounded((float(obj["x1"]) - float(obj["x0"])) / 2 * SCALE)
    return {
        "kind": "circle",
        "center": {"x": center[0], "y": center[1]},
        "radius": radius,
        "part": part,
        # Textbook negation bubbles use the same 1.434 pt stroke as the gate
        # body, not the 0.717 pt external leads. Keeping that distinction is
        # also what closes the body/bubble silhouette after normalization.
        "style": EMPHASIS,
    }


def pin(name: str, role: str, x: int, y: int, direction: str) -> dict[str, Any]:
    return {
        "name": name,
        "role": role,
        "at": {"x": x, "y": y},
        "direction": direction,
        "presentation": {"visibility": "visible", "leadLength": 20},
    }


def two_input_symbol(
    symbol_id: str, name: str, primitives: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "id": symbol_id,
        "name": name,
        "viewBox": {"x": -44, "y": -24, "width": 88, "height": 48},
        "pins": [
            pin("A", "input", -40, -10, "west"),
            pin("B", "input", -40, 10, "west"),
            pin("Y", "output", 40, 0, "east"),
        ],
        "primitives": primitives,
        "variants": [],
    }


def inverter_symbol(primitives: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "id": "inverter",
        "name": "Inverter",
        "viewBox": {"x": -44, "y": -24, "width": 88, "height": 48},
        "pins": [
            pin("A", "input", -40, 0, "west"),
            pin("Y", "output", 40, 0, "east"),
        ],
        "primitives": primitives,
        "variants": [],
    }


def extract_xor(page: Any) -> tuple[list[dict[str, Any]], dict[str, Any], tuple[float, float]]:
    input_a = find_object(page, "line", (203.94, 51.3042, 215.987, 51.3042), linewidth=0.717)
    input_b = find_object(page, "line", (204.119, 62.7732, 216.167, 62.7732), linewidth=0.717)
    output = find_object(page, "line", (237.668, 57.0402, 244.573, 57.0402), linewidth=0.717)
    body = find_object(page, "curve", (217.305, 46.8672, 237.811, 67.2922), linewidth=1.434)
    exclusive = find_object(page, "curve", (213.561, 46.8682, 217.75, 67.3432), linewidth=1.434)
    origin = ((203.94 + 244.573) / 2, (51.3042 + 62.7732) / 2)
    transform = make_horizontal_transform(*origin)
    body_input_a = transform(float(input_a["x1"]), float(input_a["top"]))
    body_input_b = transform(float(input_b["x1"]), float(input_b["top"]))
    body_output = transform(float(body["x1"]), origin[1])
    primitives = [
        line((-40, -10), body_input_a),
        line((-40, 10), body_input_b),
        path(body, transform),
        path(exclusive, transform),
        line(body_output, (40, 0)),
    ]
    objects = [input_a, input_b, output, body, exclusive]
    return objects, two_input_symbol("xor-gate", "XOR Gate", primitives), origin


def extract_nor(page: Any) -> tuple[list[dict[str, Any]], dict[str, Any], tuple[float, float]]:
    input_a = find_object(page, "line", (461.997, 467.5342, 470.643, 467.5342), linewidth=0.717)
    input_b = find_object(page, "line", (462.131, 479.0032, 470.464, 479.0032), linewidth=0.717)
    output = find_object(page, "line", (492.779, 473.2702, 499.684, 473.2702), linewidth=0.717)
    body = find_object(page, "curve", (468.026, 463.098, 488.531, 483.523), linewidth=1.434)
    bubble = find_object(page, "curve", (489.008, 471.264, 492.878, 475.134), linewidth=1.434)
    origin = ((461.997 + 499.684) / 2, (467.5342 + 479.0032) / 2)
    transform = make_horizontal_transform(*origin)
    primitives = [
        line((-40, -10), transform(float(input_a["x1"]), float(input_a["top"]))),
        line((-40, 10), transform(float(input_b["x1"]), float(input_b["top"]))),
        path(body, transform),
        circle_from_object(bubble, transform),
        line(transform(float(output["x0"]), float(output["top"])), (40, 0)),
    ]
    objects = [input_a, input_b, output, body, bubble]
    return objects, two_input_symbol("nor-gate", "NOR Gate", primitives), origin


def extract_and(page: Any) -> tuple[list[dict[str, Any]], dict[str, Any], tuple[float, float]]:
    output = find_object(page, "line", (161.647, 524.8802, 172.399, 524.8802), linewidth=0.717)
    input_a = find_object(page, "line", (192.47, 519.1462, 201.162, 519.1462), linewidth=0.717)
    input_b = find_object(page, "line", (192.47, 530.6142, 201.251, 530.6142), linewidth=0.717)
    body_curve = find_object(page, "curve", (172.758, 516.1442, 182.077, 533.4372), linewidth=1.434)
    body_flat = find_object(page, "curve", (181.36, 516.2342, 192.291, 533.4372), linewidth=1.434)
    origin = ((161.647 + 201.251) / 2, (519.1462 + 530.6142) / 2)
    transform = make_horizontal_transform(*origin, reverse_x=True)
    primitives = [
        line((-40, -10), transform(float(input_a["x0"]), float(input_a["bottom"]))),
        line((-40, 10), transform(float(input_b["x0"]), float(input_b["bottom"]))),
        path(body_flat, transform),
        path(body_curve, transform),
        line(transform(float(output["x1"]), float(output["top"])), (40, 0)),
    ]
    objects = [input_a, input_b, output, body_curve, body_flat]
    return objects, two_input_symbol("and-gate", "AND Gate", primitives), origin


def extract_nand(page: Any) -> tuple[list[dict[str, Any]], dict[str, Any], tuple[float, float]]:
    input_a = find_object(page, "line", (236.327, 286.2172, 236.327, 292.1302), linewidth=0.717)
    input_b = find_object(page, "line", (247.796, 286.1722, 247.796, 292.1302), linewidth=0.717)
    output = find_object(page, "line", (242.062, 316.7712, 242.062, 324.9692), linewidth=0.717)
    body_flat = find_object(page, "curve", (233.505, 292.3092, 250.709, 302.9722), linewidth=1.434)
    body_curve = find_object(page, "curve", (233.505, 302.5242, 250.709, 311.8422), linewidth=1.434)
    bubble = find_object(page, "curve", (240.132, 313.1132, 244.003, 316.9832), linewidth=1.434)
    origin = ((236.327 + 247.796) / 2, (286.1722 + 324.9692) / 2)
    transform = make_down_to_right_transform(*origin)
    primitives = [
        line((-40, -10), transform(float(input_a["x0"]), float(input_a["bottom"]))),
        line((-40, 10), transform(float(input_b["x0"]), float(input_b["bottom"]))),
        path(body_flat, transform),
        path(body_curve, transform),
        circle_from_object(bubble, transform),
        line(transform(float(output["x0"]), float(output["top"])), (40, 0)),
    ]
    objects = [input_a, input_b, output, body_flat, body_curve, bubble]
    return objects, two_input_symbol("nand-gate", "NAND Gate", primitives), origin


def extract_inverter(page: Any) -> tuple[list[dict[str, Any]], dict[str, Any], tuple[float, float]]:
    input_lead = find_object(page, "line", (242.062, 316.7712, 242.062, 324.9692), linewidth=0.717)
    output_lead = find_object(page, "line", (242.062, 342.8912, 242.062, 350.0582), linewidth=0.717)
    triangle = find_object(page, "curve", (233.46, 324.9692, 249.946, 338.5892), linewidth=1.434)
    bubble = find_object(page, "curve", (239.917, 338.6012, 244.218, 342.9022), linewidth=1.434)
    origin = (242.062, (316.7712 + 350.0582) / 2)
    transform = make_down_to_right_transform(*origin)
    primitives = [
        line((-40, 0), transform(float(input_lead["x0"]), float(input_lead["bottom"]))),
        path(triangle, transform),
        circle_from_object(bubble, transform),
        line(transform(float(output_lead["x0"]), float(output_lead["top"])), (40, 0)),
    ]
    objects = [input_lead, output_lead, triangle, bubble]
    return objects, inverter_symbol(primitives), origin


SPECS: dict[str, dict[str, Any]] = {
    "xor-gate": {
        "pdfPage": 671,
        "printedPage": 652,
        "figure": "16.2",
        "extract": extract_xor,
        "rotation": 0,
        "witnessWindow": {"width": 84, "height": 48, "minX": -42, "minY": -24},
        "scope": ["direct XOR body, exclusive curve, and lead junctions"],
    },
    "and-gate": {
        "pdfPage": 687,
        "printedPage": 668,
        "figure": "16.24(a)",
        "extract": extract_and,
        "rotation": 180,
        "witnessWindow": {"width": 64.1, "height": 31, "minX": -29.5, "minY": -15.5},
        "scope": ["direct AND body and lead junctions"],
    },
    "nor-gate": {
        "pdfPage": 687,
        "printedPage": 668,
        "figure": "16.24(b)",
        "extract": extract_nor,
        "rotation": 0,
        "witnessWindow": {"width": 63, "height": 36.4, "minX": -30, "minY": -18.2},
        "scope": ["direct NOR body, negation bubble, and lead junctions"],
    },
    "nand-gate": {
        "pdfPage": 688,
        "printedPage": 669,
        "figure": "16.25(a)",
        "extract": extract_nand,
        "rotation": 90,
        "witnessWindow": {"width": 31, "height": 67.1, "minX": -15.5, "minY": -34.2},
        "scope": ["direct NAND body, negation bubble, and lead junctions"],
    },
    "inverter": {
        "pdfPage": 688,
        "printedPage": 669,
        "figure": "16.25(a)",
        "extract": extract_inverter,
        "rotation": 90,
        "witnessWindow": {"width": 30, "height": 57.5, "minX": -15.5, "minY": -28.2},
        "scope": ["direct inverter triangle, negation bubble, and lead junctions"],
    },
}


def render_witness(
    pdf_path: Path,
    page: Any,
    source_origin: tuple[float, float],
    definition: dict[str, Any],
    rotation: int,
    window: dict[str, float],
    output: Path,
    pdftoppm: str,
) -> dict[str, Any]:
    # Crop the fixed, source-owned footprint recorded by each spec. Figure
    # 16.24/16.25 place gates in connected latch circuits, so a generic large
    # window would admit neighbouring wires or another gate.
    logical_width = window["width"]
    logical_height = window["height"]
    width = round(logical_width * PIXELS_PER_LOGICAL)
    height = round(logical_height * PIXELS_PER_LOGICAL)
    min_x = window["minX"]
    min_y = window["minY"]
    pixels_per_point = PIXELS_PER_LOGICAL * SCALE
    dpi = 72 * pixels_per_point
    media_left, media_top, _, _ = page.mediabox
    origin_full = {
        "x": (source_origin[0] - float(media_left)) * pixels_per_point,
        "y": (source_origin[1] - float(media_top)) * pixels_per_point,
    }
    crop_x = math.floor(origin_full["x"] + min_x * PIXELS_PER_LOGICAL)
    crop_y = math.floor(origin_full["y"] + min_y * PIXELS_PER_LOGICAL)
    executable = shutil.which(pdftoppm) or pdftoppm
    with tempfile.TemporaryDirectory(prefix="razavi-logic-gate-") as temp_dir:
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
                    f"Razavi logic-gate extraction: witness {image.size} != {(width, height)}"
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
        "window": {"width": width, "height": height, "minX": min_x, "minY": min_y},
        "rotation": rotation,
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
    objects, definition, origin = spec["extract"](page)
    selected = [fingerprint(obj) for obj in objects]
    selected_hash = hashlib.sha256(
        json.dumps(selected, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    png_path = output_root / f"logic-{asset_id}-reference.png"
    raster = render_witness(
        pdf_path,
        page,
        origin,
        definition,
        spec["rotation"],
        spec["witnessWindow"],
        png_path,
        pdftoppm,
    )
    evidence_id = f"razavi-textbook-logic-{asset_id}"
    evidence = {
        "schemaVersion": 1,
        "id": evidence_id,
        "kind": "pdf-vector-extract",
        "source": {
            "title": TITLE,
            "sha256": source_hash,
            "pdfPage": spec["pdfPage"],
            "printedPage": spec["printedPage"],
            "figure": spec["figure"],
        },
        "selection": {
            "method": "direct-logic-gate-vector-normalization",
            "nativeObjectCount": len(selected),
            "nativeObjectSha256": selected_hash,
            "nativeObjects": selected,
        },
        "normalization": {
            "sourceInputPitchPdf": SOURCE_INPUT_PITCH,
            "logicalInputPitch": LOGICAL_INPUT_PITCH,
            "logicalUnitsPerPdfPoint": rounded(SCALE),
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
            "orientation": f"native source orientation is recorded as {spec['rotation']} degrees relative to the product default",
        },
        "rasterWitness": raster,
    }
    if asset_id in {"xor-gate", "nor-gate"}:
        body = next(
            primitive for primitive in definition["primitives"] if primitive["kind"] == "path"
        )
        match = re.match(r"M\s+(-?[0-9.]+)\s+(-?[0-9.]+)", body["data"])
        if match is None:
            raise RuntimeError(
                f"Razavi logic-gate extraction: missing body output anchor for {asset_id}"
            )
        evidence["normalization"]["compositionAnchors"] = {
            "bodyOutput": {"x": float(match.group(1)), "y": float(match.group(2))}
        }
    (output_root / f"logic-{asset_id}-vector-source.json").write_text(
        json.dumps(evidence, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def write_geometry_registry(output_root: Path) -> None:
    symbols: dict[str, Any] = {}
    for asset_id in SPECS:
        evidence = json.loads(
            (output_root / f"logic-{asset_id}-vector-source.json").read_text(
                encoding="utf-8"
            )
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
            "inputPitchPdf": SOURCE_INPUT_PITCH,
            "inputPitchLogical": LOGICAL_INPUT_PITCH,
            "logicalUnitsPerPdfPoint": rounded(SCALE),
            "derivedSymbols": {
                "or-gate": "nor-gate body with the output bubble removed",
                "xnor-gate": "xor-gate body with the reviewed two-input negation bubble added",
            },
        },
        "symbols": symbols,
    }
    (output_root / "logic-gate-geometry.json").write_text(
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
            f"Razavi logic-gate extraction: source PDF SHA-256 mismatch: {source_hash}"
        )
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    assets = SPECS.keys() if args.asset == "all" else [args.asset]
    with pdfplumber.open(pdf_path) as pdf:
        for asset_id in assets:
            extract_one(pdf_path, output_root, asset_id, args.pdftoppm, source_hash, pdf)
            print(f"Extracted razavi-textbook-logic-{asset_id}")
    if args.asset == "all":
        write_geometry_registry(output_root)


if __name__ == "__main__":
    main()
