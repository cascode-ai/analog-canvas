#!/usr/bin/env python3
"""Measure the accepted six-panel Razavi raster reference.

This is a developer calibration tool, not a runtime dependency. It converts
the reference's anti-aliased ink into a small set of geometry ratios that can
be compared with the Symbol DSL and the Razavi style profile. The coordinate
template is intentionally tied to the reviewed 1204x794 reference image; a
different crop must be aligned explicitly instead of silently producing false
"pixel exact" numbers.

Requires: Python 3.11+, OpenCV, NumPy.
Usage:
  python scripts/calibration/razavi/measure-reference.py <reference.png>
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

EXPECTED_SIZE = (1204, 794)  # width, height
INK_THRESHOLD = 200
CORE_THRESHOLD = 160


def bounds(mask: np.ndarray, left: int, top: int, right: int, bottom: int) -> dict[str, int]:
    """Return the inclusive dark-ink bounds in one known semantic ROI."""
    ys, xs = np.where(mask[top:bottom, left:right])
    if len(xs) == 0:
        raise ValueError(f"no ink in ROI {(left, top, right, bottom)}")
    x0, x1 = left + int(xs.min()), left + int(xs.max())
    y0, y1 = top + int(ys.min()), top + int(ys.max())
    return {
        "left": x0,
        "top": y0,
        "right": x1,
        "bottom": y1,
        "width": x1 - x0 + 1,
        "height": y1 - y0 + 1,
    }


def run_at(mask: np.ndarray, x: int, top: int, bottom: int) -> int:
    """Largest dark run on a vertical cross section, in pixels."""
    values = mask[top:bottom, x]
    runs: list[int] = []
    start: int | None = None
    for index, value in enumerate(values):
        if value and start is None:
            start = index
        elif not value and start is not None:
            runs.append(index - start)
            start = None
    if start is not None:
        runs.append(len(values) - start)
    return max(runs, default=0)


def horizontal_run_at(mask: np.ndarray, y: int, left: int, right: int) -> int:
    """Largest dark run on a horizontal cross section, in pixels."""
    values = mask[y, left:right]
    runs: list[int] = []
    start: int | None = None
    for index, value in enumerate(values):
        if value and start is None:
            start = index
        elif not value and start is not None:
            runs.append(index - start)
            start = None
    if start is not None:
        runs.append(len(values) - start)
    return max(runs, default=0)


def rectangle_edges(box: dict[str, int]) -> dict[str, float]:
    """Convert inclusive core-pixel bounds to vector edges."""
    return {
        "left": box["left"] - 0.5,
        "top": box["top"] - 0.5,
        "right": box["right"] + 0.5,
        "bottom": box["bottom"] + 0.5,
    }


def longest_row_center(
    mask: np.ndarray, left: int, top: int, right: int, bottom: int
) -> float:
    lengths = np.count_nonzero(mask[top:bottom, left:right], axis=1)
    maximum = int(lengths.max())
    rows = np.where(lengths == maximum)[0] + top
    return round(float(rows.mean()), 4)


def vertical_core_bounds(
    mask: np.ndarray, left: int, top: int, right: int, bottom: int
) -> dict[str, int]:
    """Bounds of persistent vertical ink, excluding short crossing leads."""
    roi = mask[top:bottom, left:right]
    counts = np.count_nonzero(roi, axis=0)
    maximum = int(counts.max())
    columns = np.where(counts >= maximum * 0.8)[0] + left
    selected = mask[top:bottom, columns]
    rows = np.where(np.any(selected, axis=1))[0] + top
    return {
        "left": int(columns.min()),
        "top": int(rows.min()),
        "right": int(columns.max()),
        "bottom": int(rows.max()),
        "width": int(columns.max() - columns.min() + 1),
        "height": int(rows.max() - rows.min() + 1),
    }


def point(x: float, y: float) -> dict[str, float]:
    return {"x": round(float(x), 4), "y": round(float(y), 4)}


def segment(x1: float, y1: float, x2: float, y2: float) -> dict[str, dict[str, float]]:
    return {"from": point(x1, y1), "to": point(x2, y2)}


def build_mos_geometry(core: np.ndarray, reference_hash: str) -> dict[str, object]:
    """Extract the complete final MOS presentation map from fixed semantic ROIs."""
    pixels_per_logical = 1.72

    nmos_outer = rectangle_edges(vertical_core_bounds(core, 140, 190, 149, 245))
    nmos_inner = rectangle_edges(vertical_core_bounds(core, 149, 190, 157, 245))
    nmos_channel = vertical_core_bounds(core, 177, 180, 182, 252)
    nmos_channel_x = (nmos_channel["left"] + nmos_channel["right"]) / 2
    nmos_upper_y = longest_row_center(core, 156, 202, 182, 210)
    nmos_lower_y = longest_row_center(core, 156, 224, 182, 234)
    nmos_origin_y = (nmos_upper_y + nmos_lower_y) / 2
    nmos_origin_x = nmos_channel_x - 10 * pixels_per_logical
    nmos_arrow = bounds(core, 163, 223, 178, 237)

    pmos_outer = rectangle_edges(vertical_core_bounds(core, 504, 55, 513, 110))
    pmos_inner = rectangle_edges(vertical_core_bounds(core, 514, 55, 522, 112))
    pmos_channel = vertical_core_bounds(core, 542, 45, 547, 118)
    pmos_channel_x = (pmos_channel["left"] + pmos_channel["right"]) / 2
    pmos_upper_y = longest_row_center(core, 521, 64, 547, 78)
    pmos_lower_y = longest_row_center(core, 521, 90, 547, 102)
    pmos_origin_y = (pmos_upper_y + pmos_lower_y) / 2
    pmos_origin_x = pmos_channel_x - 10 * pixels_per_logical
    pmos_arrow = bounds(core, 521, 63, 536, 79)

    def pins(origin_x: float, origin_y: float) -> dict[str, dict[str, float]]:
        return {
            "D": point(origin_x + 10 * pixels_per_logical, origin_y - 20 * pixels_per_logical),
            "G": point(origin_x - 20 * pixels_per_logical, origin_y),
            "S": point(origin_x + 10 * pixels_per_logical, origin_y + 20 * pixels_per_logical),
            "B": point(origin_x + 20 * pixels_per_logical, origin_y),
        }

    nmos_pins = pins(nmos_origin_x, nmos_origin_y)
    pmos_pins = pins(pmos_origin_x, pmos_origin_y)
    nmos_gate_y = nmos_origin_y
    pmos_gate_y = pmos_origin_y

    return {
        "schemaVersion": 1,
        "referenceId": "razavi-reference-v1",
        "referenceSha256": reference_hash,
        "coordinateSystem": "reference-raster-pixels",
        "pixelThreshold": CORE_THRESHOLD,
        "symbols": {
            "nmos": {
                "evidencePanel": "a-lower-M2",
                "pixelsPerLogical": pixels_per_logical,
                "originPx": point(nmos_origin_x, nmos_origin_y),
                "pinsPx": nmos_pins,
                "gateBarsPx": [nmos_outer, nmos_inner],
                "channelsPx": {
                    "upper": segment(nmos_inner["right"], nmos_upper_y, nmos_channel_x, nmos_upper_y),
                    "lower": segment(nmos_inner["right"], nmos_lower_y, nmos_channel_x, nmos_lower_y),
                },
                "leadsPx": {
                    "D": segment(nmos_channel_x, nmos_upper_y, nmos_pins["D"]["x"], nmos_pins["D"]["y"]),
                    "G": segment(nmos_outer["right"], nmos_gate_y, nmos_pins["G"]["x"], nmos_pins["G"]["y"]),
                    "S": segment(nmos_channel_x, nmos_lower_y, nmos_pins["S"]["x"], nmos_pins["S"]["y"]),
                },
                "sourceArrowPx": {
                    "support": segment(nmos_inner["right"], nmos_lower_y, nmos_channel_x, nmos_lower_y),
                    "tip": point(nmos_channel_x, nmos_lower_y),
                    "baseTop": point(nmos_arrow["left"] + 1, nmos_arrow["top"] - 0.5),
                    "baseBottom": point(nmos_arrow["left"] + 1, nmos_arrow["bottom"] + 0.5),
                },
                "bulkExtensionPx": {
                    "supports": [
                        segment(nmos_inner["right"], nmos_gate_y, nmos_channel_x, nmos_gate_y),
                        segment(nmos_channel_x + 11, nmos_gate_y, nmos_pins["B"]["x"], nmos_pins["B"]["y"]),
                    ],
                    "tip": point(nmos_channel_x, nmos_gate_y),
                    "baseTop": point(nmos_channel_x + 11, nmos_gate_y - 6),
                    "baseBottom": point(nmos_channel_x + 11, nmos_gate_y + 6),
                },
            },
            "pmos": {
                "evidencePanel": "b-upper-M3",
                "pixelsPerLogical": pixels_per_logical,
                "originPx": point(pmos_origin_x, pmos_origin_y),
                "pinsPx": pmos_pins,
                "gateBarsPx": [pmos_outer, pmos_inner],
                "channelsPx": {
                    "upper": segment(pmos_inner["right"], pmos_upper_y, pmos_channel_x, pmos_upper_y),
                    "lower": segment(pmos_inner["right"], pmos_lower_y, pmos_channel_x, pmos_lower_y),
                },
                "leadsPx": {
                    "D": segment(pmos_channel_x, pmos_upper_y, pmos_pins["D"]["x"], pmos_pins["D"]["y"]),
                    "G": segment(pmos_outer["right"], pmos_gate_y, pmos_pins["G"]["x"], pmos_pins["G"]["y"]),
                    "S": segment(pmos_channel_x, pmos_lower_y, pmos_pins["S"]["x"], pmos_pins["S"]["y"]),
                },
                "sourceArrowPx": {
                    "support": segment(pmos_inner["right"], pmos_upper_y, pmos_channel_x, pmos_upper_y),
                    "tip": point(pmos_arrow["left"] + 1, pmos_upper_y),
                    "baseTop": point(pmos_arrow["right"] - 1, pmos_arrow["top"] - 0.5),
                    "baseBottom": point(pmos_arrow["right"] - 1, pmos_arrow["bottom"] + 0.5),
                },
                "bulkExtensionPx": {
                    "supports": [
                        segment(pmos_inner["right"], pmos_gate_y, pmos_pins["B"]["x"] - 11, pmos_pins["B"]["y"]),
                    ],
                    "tip": point(pmos_pins["B"]["x"], pmos_gate_y),
                    "baseTop": point(pmos_pins["B"]["x"] - 11, pmos_gate_y - 6.5),
                    "baseBottom": point(pmos_pins["B"]["x"] - 11, pmos_gate_y + 6.5),
                },
            },
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("reference", type=Path)
    parser.add_argument("--check-mos-geometry", type=Path)
    parser.add_argument("--mos-geometry-only", action="store_true")
    args = parser.parse_args()
    raw = args.reference.read_bytes()
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise SystemExit(f"cannot decode {args.reference}")
    height, width = image.shape
    if (width, height) != EXPECTED_SIZE:
        raise SystemExit(
            f"reference must be {EXPECTED_SIZE[0]}x{EXPECTED_SIZE[1]} pixels; got {width}x{height}"
        )
    ink = image < INK_THRESHOLD
    core = image < CORE_THRESHOLD
    reference_hash = hashlib.sha256(raw).hexdigest()
    mos_geometry = build_mos_geometry(core, reference_hash)

    if args.mos_geometry_only:
        print(json.dumps(mos_geometry, indent=2))
        return

    if args.check_mos_geometry is not None:
        checked = json.loads(args.check_mos_geometry.read_text(encoding="utf-8"))
        if checked != mos_geometry:
            raise SystemExit(f"MOS geometry is stale: {args.check_mos_geometry}")

    # Panel (a) has the cleanest MOS, VDD, wire, and route-marker examples.
    vdd_bar = {
        "length": horizontal_run_at(ink, 26, 155, 205),
        "thickness": run_at(ink, 165, 20, 36),
    }
    vdd_stem = {
        "length": run_at(ink, 179, 32, 76),
        "thickness": horizontal_run_at(ink, 50, 173, 186),
    }
    mos_gate = {
        "length": run_at(ink, 154, 55, 110),
        "thickness": horizontal_run_at(ink, 80, 151, 162),
    }
    instance_label = bounds(ink, 183, 68, 236, 110)
    power_label = bounds(ink, 202, 4, 275, 44)

    # The triangle shares its tip with the channel. Its base, gate span, and
    # channel endpoint are therefore measured separately, not with a fragile
    # connected-component heuristic.
    mos_arrow_base = bounds(ink, 163, 87, 167, 104)
    mos_arrow_pixels = {"length": 14, "width": mos_arrow_base["height"]}

    # Panel (c) gives an unobscured independent source. The head dimensions
    # include the anti-aliased outer edge used by the SVG rasterizer.
    source_circle = bounds(ink, 790, 94, 837, 141)
    source_head_pixels = {"length": 20, "width": 20}

    # The left-pointing current marker in panel (a) has a 23px tip-to-base
    # span and a 15px base. Gate length supplies the common px/logical scale.
    marker_pixels = {"length": 23, "width": 15}
    gate_length_logical = 24.39567
    px_per_logical = mos_gate["length"] / gate_length_logical
    source_circle_diameter_logical = 2 * 10.629922
    source_px_per_logical = source_circle["width"] / source_circle_diameter_logical

    report = {
        "reference": {
            "path": str(args.reference),
            "sha256": reference_hash,
            "pixels": {"width": width, "height": height},
            "inkThreshold": INK_THRESHOLD,
        },
        "pixels": {
            "vddBar": vdd_bar,
            "vddStem": vdd_stem,
            "mosGateBar": mos_gate,
            "mosArrow": mos_arrow_pixels,
            "sourceCircle": source_circle,
            "sourceHead": source_head_pixels,
            "routeMarkerHead": marker_pixels,
            "instanceLabel": instance_label,
            "powerLabel": power_label,
            "wireCore": run_at(ink, 120, 75, 91),
        },
        "normalized": {
            "mosPixelsPerLogical": round(px_per_logical, 4),
            "mosArrowLength": round(mos_arrow_pixels["length"] / px_per_logical, 4),
            "mosArrowWidth": round(mos_arrow_pixels["width"] / px_per_logical, 4),
            "sourcePixelsPerLogical": round(source_px_per_logical, 4),
            "sourceHeadLength": round(source_head_pixels["length"] / source_px_per_logical, 4),
            "sourceHeadWidth": round(source_head_pixels["width"] / source_px_per_logical, 4),
            "routeMarkerHeadLength": round(marker_pixels["length"] / px_per_logical, 4),
            "routeMarkerHeadWidth": round(marker_pixels["width"] / px_per_logical, 4),
        },
        "recommendedRuntimeParameters": {
            "mosSourceArrowLengthScale": 0.8,
            "mosSourceArrowHalfWidthScale": 1.65,
            "independentCurrentHeadLengthScale": 1.65,
            "independentCurrentHeadHalfWidthScale": 1.15,
            "routeMarkerHeadLength": 14,
            "routeMarkerHeadWidth": 9,
            "unchanged": [
                "wire/symbol normal stroke ratio",
                "gate-bar emphasis ratio",
                "ground 1:0.5:0.25 bars",
                "port origin dot ratio",
                "Arial bold-italic 16px text with 0.68 subscript scale",
            ],
        },
        "mosGeometry": mos_geometry,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
