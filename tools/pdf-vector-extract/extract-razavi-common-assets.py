#!/usr/bin/env python3
"""Extract and normalize the remaining common Razavi symbol families.

This tool is deliberately separate from the raster fidelity harness. It pins
the textbook PDF, fingerprints native vector objects in a tight source region,
and emits one normalized SymbolDefinition plus an isolated raster witness per
asset. Electrical pin extensions that are not present in the source figure are
recorded as semantic normalization rather than presented as extracted art.
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
TITLE = "Design of Analog CMOS Integrated Circuits, Second Edition"
RASTER_DPI = 300.0
PIXELS_PER_LOGICAL = 2.4
RAZAVI_NORMAL_STROKE = 1.6
# Figure 13.5 closed-switch blade: its centreline starts 0.312427 logical
# units beyond the pivot-circle centreline.  This deliberately overlaps the
# circle's visible ring while remaining outside its hollow interior.
SWITCH_BLADE_CONTACT_CLEARANCE = 0.312427
BJT_ARROW_MAGNIFICATION = 1.18
# Native Figure 12.6 NPN arrow coordinates relative to its true tip. Figure
# 12.11 PNP is the same triangle mirrored along the local y axis.
BJT_ARROW_TEMPLATE_PDF = [(-2.982, -2.981), (-4.473, 0), (0, 0)]

NORMAL = {"strokeRole": "normal", "lineCap": "butt", "lineJoin": "miter"}
EMPHASIS = {"strokeRole": "emphasis", "lineCap": "butt", "lineJoin": "miter"}


def rounded(value: float) -> float:
    return round(float(value), 6)


def pin(name: str, role: str, x: int, y: int, direction: str, lead: int = 10) -> dict[str, Any]:
    return {
        "name": name,
        "role": role,
        "at": {"x": x, "y": y},
        "direction": direction,
        "presentation": {"visibility": "visible", "leadLength": lead},
    }


def line(x1: float, y1: float, x2: float, y2: float, style: dict[str, Any] = NORMAL) -> dict[str, Any]:
    return {"kind": "line", "from": {"x": x1, "y": y1}, "to": {"x": x2, "y": y2}, "style": style}


def polyline(points: list[tuple[float, float]], style: dict[str, Any] = NORMAL) -> dict[str, Any]:
    return {"kind": "polyline", "points": [{"x": x, "y": y} for x, y in points], "style": style}


def circle(x: float, y: float, radius: float, fill: str = "none") -> dict[str, Any]:
    return {"kind": "circle", "center": {"x": x, "y": y}, "radius": radius, "fill": fill, "stroke": "foreground", "style": NORMAL}


def polygon(points: list[tuple[float, float]]) -> dict[str, Any]:
    return {"kind": "polygon", "points": [{"x": x, "y": y} for x, y in points], "fill": "foreground", "stroke": "none"}


def outline_polygon(points: list[tuple[float, float]], style: dict[str, Any] = NORMAL) -> dict[str, Any]:
    return {"kind": "polygon", "points": [{"x": x, "y": y} for x, y in points], "fill": "none", "stroke": "foreground", "style": style}


def symbol(symbol_id: str, name: str, view_box: tuple[float, float, float, float], pins: list[dict[str, Any]], primitives: list[dict[str, Any]], aliases: list[str]) -> dict[str, Any]:
    x, y, width, height = view_box
    return {
        "schemaVersion": 1,
        "id": symbol_id,
        "name": name,
        "viewBox": {"x": x, "y": y, "width": width, "height": height},
        "pins": pins,
        "primitives": primitives,
        "variants": [],
        "aliases": aliases,
    }


def segment_polygon_intersections(
    start: tuple[float, float],
    end: tuple[float, float],
    polygon_points: list[tuple[float, float]],
) -> list[tuple[float, tuple[float, float]]]:
    def cross(left: tuple[float, float], right: tuple[float, float]) -> float:
        return left[0] * right[1] - left[1] * right[0]

    direction = (end[0] - start[0], end[1] - start[1])
    intersections: list[tuple[float, tuple[float, float]]] = []
    edges = zip(polygon_points, [*polygon_points[1:], polygon_points[0]])
    for edge_start, edge_end in edges:
        edge = (edge_end[0] - edge_start[0], edge_end[1] - edge_start[1])
        denominator = cross(direction, edge)
        if math.isclose(denominator, 0, abs_tol=1e-9):
            continue
        offset = (edge_start[0] - start[0], edge_start[1] - start[1])
        t = cross(offset, edge) / denominator
        u = cross(offset, direction) / denominator
        if -1e-9 <= t <= 1 + 1e-9 and -1e-9 <= u <= 1 + 1e-9:
            point_value = (start[0] + t * direction[0], start[1] + t * direction[1])
            if not any(math.isclose(t, existing[0], abs_tol=1e-7) for existing in intersections):
                intersections.append((t, point_value))
    return sorted(intersections, key=lambda value: value[0])


def clipped_arrow_branch(
    base: tuple[float, float],
    junction: tuple[float, float],
    pin_point: tuple[float, float],
    arrow: list[tuple[float, float]],
) -> list[dict[str, Any]]:
    intersections = segment_polygon_intersections(base, junction, arrow)
    if len(intersections) != 2:
        raise RuntimeError(f"Razavi common extraction: expected two BJT arrow intersections, got {len(intersections)}")
    direction = (junction[0] - base[0], junction[1] - base[1])
    branch_length = math.hypot(*direction)
    # A centerline that stops exactly at a filled polygon boundary can expose a
    # one-pixel white seam after SVG antialiasing.  Carry each side 0.75 stroke
    # widths into the black arrow interior.  The overlap remains bounded by the
    # two polygon intersections, so it cannot flatten or pass beyond the tip.
    overlap_t = RAZAVI_NORMAL_STROKE * 0.75 / branch_length
    entry_t = min(
        intersections[0][0] + overlap_t,
        (intersections[0][0] + intersections[1][0]) / 2,
    )
    exit_t = max(
        intersections[1][0] - overlap_t,
        (intersections[0][0] + intersections[1][0]) / 2,
    )

    def at(t: float) -> tuple[float, float]:
        return (
            rounded(base[0] + t * direction[0]),
            rounded(base[1] + t * direction[1]),
        )

    entry = at(entry_t)
    exit_point = at(exit_t)
    result = [line(base[0], base[1], entry[0], entry[1])]
    if not (
        math.isclose(exit_point[0], junction[0], abs_tol=1e-6)
        and math.isclose(exit_point[1], junction[1], abs_tol=1e-6)
    ):
        result.append(polyline([exit_point, junction, pin_point]))
    else:
        result.append(line(junction[0], junction[1], pin_point[0], pin_point[1]))
    return result


def rear_supported_arrow_branch(
    tip: tuple[float, float],
    junction: tuple[float, float],
    pin_point: tuple[float, float],
    source_arrow: list[tuple[float, float]],
) -> tuple[list[dict[str, Any]], list[tuple[float, float]]]:
    # Match the established PMOS support topology without changing the source
    # arrow artwork.  In the native PNP polygon source_arrow[2] is the true
    # left-pointing tip.  Move all three vertices by one common delta so that
    # tip touches the base bar; rotation or independent rescaling would change
    # the arrow style.  The only support begins at the opposite edge midpoint.
    source_tip = source_arrow[2]
    delta = (tip[0] - source_tip[0], tip[1] - source_tip[1])
    arrow = [
        (rounded(point[0] + delta[0]), rounded(point[1] + delta[1]))
        for point in source_arrow
    ]
    base_center = (
        rounded((arrow[0][0] + arrow[1][0]) / 2),
        rounded((arrow[0][1] + arrow[1][1]) / 2),
    )
    return [polyline([base_center, junction, pin_point])], arrow


def shared_bjt_arrow(
    tip: tuple[float, float],
    native_to_logical: float,
    mirror_x: bool,
) -> list[tuple[float, float]]:
    direction = -1 if mirror_x else 1
    return [
        (
            rounded(tip[0] + direction * x * native_to_logical * BJT_ARROW_MAGNIFICATION),
            rounded(tip[1] + y * native_to_logical * BJT_ARROW_MAGNIFICATION),
        )
        for x, y in BJT_ARROW_TEMPLATE_PDF
    ]


def bjt_definition(kind: str) -> dict[str, Any]:
    # Both source figures use 0.717 pt normal strokes.  Scale every native
    # coordinate by the same ratio that maps that stroke to the product's
    # Razavi 1.6-unit normal role; this retains arrow/body proportions instead
    # of making the arrow appear half-sized beside a doubled line weight.
    scale = RAZAVI_NORMAL_STROKE / 0.717

    def point(x: float, y: float) -> tuple[float, float]:
        return (rounded(x * scale), rounded(y * scale))

    base_x = point(-8.946, 0)[0]
    if kind == "npn":
        base_top, base_bottom = point(0, -6.645)[1], point(0, 6.637)[1]
        upper_base, upper_junction = point(-8.946, -2.982), point(0, -6.710)
        lower_base, lower_junction = point(-8.946, 2.983), point(0, 6.709)
        arrow = shared_bjt_arrow(lower_junction, scale, mirror_x=False)
        primitives = [
            line(-40, 0, base_x, 0),
            line(base_x, base_top, base_x, base_bottom, EMPHASIS),
            polyline([upper_base, upper_junction, (0, -30)]),
            *clipped_arrow_branch(lower_base, lower_junction, (0, 30), arrow),
            polygon(arrow),
        ]
        pins = [
            pin("C", "collector", 0, -30, "north"),
            pin("B", "base", -40, 0, "west"),
            pin("E", "emitter", 0, 30, "south"),
        ]
        name = "NPN Bipolar Transistor"
        aliases = ["bjt-npn", "bipolar-npn"]
    elif kind == "pnp":
        base_top, base_bottom = point(0, -6.639)[1], point(0, 6.643)[1]
        upper_base, upper_junction = point(-8.946, -2.982), point(0, -6.710)
        lower_base, lower_junction = point(-8.946, 2.982), point(0, 6.709)
        source_arrow = shared_bjt_arrow(upper_base, scale, mirror_x=True)
        arrow_support, arrow = rear_supported_arrow_branch(
            upper_base,
            upper_junction,
            (0, -30),
            source_arrow,
        )
        primitives = [
            line(-40, 0, base_x, 0),
            line(base_x, base_top, base_x, base_bottom, EMPHASIS),
            *arrow_support,
            polyline([lower_base, lower_junction, (0, 30)]),
            polygon(arrow),
        ]
        pins = [
            pin("C", "collector", 0, 30, "south"),
            pin("B", "base", -40, 0, "west"),
            pin("E", "emitter", 0, -30, "north"),
        ]
        name = "PNP Bipolar Transistor"
        aliases = ["bjt-pnp", "bipolar-pnp"]
    else:
        raise RuntimeError(f"Unsupported BJT kind {kind}")

    return symbol(kind, name, (-44, -34, 52, 68), pins, primitives, aliases)


def npn_bjt() -> dict[str, Any]:
    # Figure 12.6 Q1, origin (216.540, 233.9362).
    return bjt_definition("npn")


def pnp_bjt() -> dict[str, Any]:
    # Figure 12.11 Q1, origin (198.382, 261.6822).
    return bjt_definition("pnp")


SPECS: dict[str, dict[str, Any]] = {
    "pnp": {
        "pdfPage": 537, "printedPage": 518, "figure": "12.11",
        "crop": (180.4, 248.9, 198.5, 274.5), "method": "direct-device-vector-normalization",
        "definition": pnp_bjt(),
        "selectionMode": "inside",
        "sourceOriginPdf": (198.382, 261.6822),
        "witnessWindow": {"width": 125, "height": 164, "minX": -44, "minY": -34},
        "witnessStrokeWidths": {"normal": RAZAVI_NORMAL_STROKE, "emphasis": 2.4},
        "derivation": {
            "geometry": "uniformly scaled from Figure 12.11 Q1 native vectors",
            "junctionCleanup": "collector/emitter diagonal and vertical leads are emitted as joined polylines",
            "arrowCleanup": "PMOS-style support topology: the PNP triangle's true left-pointing tip meets the base bar, with no tip-side centerline and one rear support from the opposite edge to the emitter lead",
            "arrowCalibration": "horizontal mirror of the shared Figure 12.6 triangle template, enlarged 1.18x from direct-PDF arrow ink measurement",
        },
    },
    "npn": {
        "pdfPage": 533, "printedPage": 514, "figure": "12.6",
        "crop": (198.5, 221.0, 216.7, 246.8), "method": "direct-device-vector-normalization",
        "definition": npn_bjt(),
        "selectionMode": "inside",
        "sourceOriginPdf": (216.54, 233.9362),
        "witnessWindow": {"width": 125, "height": 164, "minX": -44, "minY": -34},
        "witnessStrokeWidths": {"normal": RAZAVI_NORMAL_STROKE, "emphasis": 2.4},
        "derivation": {
            "geometry": "uniformly scaled from Figure 12.6 Q1 native vectors",
            "junctionCleanup": "collector/emitter diagonal and vertical leads are emitted as joined polylines",
            "arrowCleanup": "the emitter centerline is clipped at the native arrow polygon, overlapped 1.2 logical units inside its fill to suppress raster seams, and the arrow is rendered last",
            "arrowCalibration": "shared Figure 12.6 triangle template enlarged 1.18x from direct-PDF arrow ink measurement",
        },
    },
    "diode": {
        "pdfPage": 661, "printedPage": 642, "figure": "15.54",
        "crop": (180.0, 95.0, 455.0, 125.0), "method": "direct-family-observation",
        "definition": symbol(
            "diode", "Diode", (-24, -10, 48, 20),
            [pin("A", "anode", -20, 0, "west"), pin("K", "cathode", 20, 0, "east")],
            [line(-20, 0, -8.333334, 0), outline_polygon([(-8.333334, -6.75), (-8.333334, 6.75), (5.833334, 0)]), line(6.666666, -7.333334, 6.666666, 7.333334, EMPHASIS), line(6.666666, 0, 20, 0)],
            ["pn-diode", "rectifier-diode"],
        ),
        # Figure 15.54 D2 is a vertical diode.  The generated product symbol
        # is a horizontal presentation of that source form, so its fidelity
        # diff is intentionally allowed to reveal orientation/normalization
        # divergence rather than silently comparing against a redrawn proxy.
        # Refined against the native cathode bar centreline.  The initial
        # reading sat about two witness pixels low, which made a correctly
        # scaled candidate require the maximum registration translation.
        "sourceOriginPdf": (275.739, 102.676),
        # Keep the witness bounded by the two declared +/-20-unit pin anchors.
        # The old 48x116 crop included neighbouring circuit wire beyond those
        # anchors, so a correct product lead was mis-scored as too short.
        "witnessWindow": {"width": 48, "height": 96, "minX": -10, "minY": -20},
    },
    "voltage-amplifier": {
        "pdfPage": 307, "printedPage": 288, "figure": "8.24",
        "crop": (220.0, 25.0, 390.0, 95.0), "method": "direct-family-observation",
        "definition": symbol(
            "voltage-amplifier", "Voltage Amplifier", (-44, -28, 88, 56),
            [pin("IN", "input", -40, 0, "west", 20), pin("OUT", "output", 40, 0, "east", 20)],
            # Figure 8.24 native triangle vertices, normalized through the
            # 0.717 pt -> 1.6 logical-unit normal-stroke scale.  Its height is
            # intentionally greater than its width; do not uniform-scale it.
            [line(-40, 0, -23.63, 0), {"kind": "path", "data": "M -23.63 -28.62 L -23.63 28.62 L 23.63 0 Z", "style": EMPHASIS}, line(23.63, 0, 40, 0)],
            ["gain-block", "voltage-gain", "a0"],
        ),
        "sourceOriginPdf": (248.238, 60.9472),
        # Figure 8.24 places the context labels e and v_pi beside the native
        # block.  The fidelity witness deliberately covers the triangle and
        # its immediate leads only; those labels are circuit annotations, not
        # part of the reusable voltage-amplifier symbol.
        "witnessWindow": {"width": 125, "height": 135, "minX": -26, "minY": -28},
    },
    "ideal-switch": {
        "pdfPage": 560, "printedPage": 541, "figure": "13.4",
        # This tight region contains exactly the three native switch lines and
        # two contact circles.  The previous broad region started at y=420 and
        # accidentally fingerprinted the S2 label and adjacent feedback
        # wiring, then rendered a hand-authored proxy with the wrong scale.
        "crop": (235.0, 446.5, 262.0, 454.8),
        "method": "direct-device-vector-normalization",
        "witnessStrokeWidths": {"normal": RAZAVI_NORMAL_STROKE},
        "witnessWindow": {"width": 164, "height": 72, "minX": -34, "minY": -18},
        "derivation": {
            "geometry": "uniformly normalized from the five native Figure 13.4 switch objects",
            "scale": "native 0.717 pt stroke mapped to the Razavi normal 1.6 logical-unit stroke",
            "pinExtension": "native horizontal leads extended only to the nearest symmetric 10-unit anchors at x=-30 and x=30",
        },
    },
    "closed-switch": {
        "pdfPage": 561, "printedPage": 542, "figure": "13.5 (S2)",
        # S2 has two native horizontal lead segments, two hollow contacts, and
        # one native angled blade. Keep the selection tight enough to exclude
        # the surrounding feedback loop and C2.
        "crop": (272.5, 52.0, 299.0, 56.3),
        "method": "direct-device-vector-normalization",
        "witnessStrokeWidths": {"normal": RAZAVI_NORMAL_STROKE},
        "derivation": {
            "geometry": "uniformly normalized from Figure 13.5 S2 native lead segments, hollow contacts, and angled blade",
            "scale": "native 0.717 pt stroke mapped to the Razavi normal 1.6 logical-unit stroke",
            "pinExtension": "native circuit wiring is excluded; isolated horizontal leads extend to symmetric 10-unit anchors at x=-30 and x=30",
            "rasterWitness": "direct source-PDF crop registered around the measured contact midpoint; it is not candidate-generated artwork",
        },
    },
    "externally-controlled-switch": {
        "pdfPage": 696, "printedPage": 677, "figure": "16.38 (S1)",
        # S1 contributes one vertical switched path, two hollow contacts, one
        # diagonal blade, and the Q_A control line entering from the left.
        # The crop excludes I1, the output trunk, the S1 label, and the PFD.
        "crop": (260.0, 188.0, 304.0, 216.0),
        "method": "direct-device-vector-normalization",
        "witnessStrokeWidths": {"normal": RAZAVI_NORMAL_STROKE},
        # Compare only the device's normalized pin span. Figure 16.38 places
        # the S1 designator immediately to the right and surrounding charge-
        # pump wiring continues left; neither belongs to the Symbol geometry.
        "witnessWindow": {"width": 88, "height": 164, "minX": -30, "minY": -34},
        "derivation": {
            "geometry": "uniformly normalized from Figure 16.38 S1 native main leads, hollow contacts, blade, and Q_A control line",
            "scale": "native 0.717 pt stroke mapped to the Razavi normal 1.6 logical-unit stroke",
            "pinExtension": "surrounding charge-pump wiring is excluded; the switched path and single-ended control line terminate at the nearest 10-unit anchors",
            "semantics": "the source establishes a single-ended logical control terminal, not the four-terminal differential control voltage required by a SPICE S primitive",
        },
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def object_fingerprint(obj: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"objectType": obj.get("object_type"), "linewidth": rounded(obj.get("linewidth", 0) or 0)}
    for key in ("x0", "top", "x1", "bottom"):
        if key in obj:
            result[key] = rounded(obj[key])
    path = obj.get("path")
    if path:
        result["path"] = path
    return result


def compact_fingerprint(value: dict[str, Any]) -> dict[str, Any]:
    result = {key: item for key, item in value.items() if key != "path"}
    if "path" in value:
        encoded = json.dumps(value["path"], sort_keys=True, separators=(",", ":"), default=str).encode()
        result["pathCommandCount"] = len(value["path"])
        result["pathSha256"] = hashlib.sha256(encoded).hexdigest()
    return result


def overlaps(obj: dict[str, Any], crop: tuple[float, float, float, float]) -> bool:
    left, top, right, bottom = crop
    return not (float(obj.get("x1", -math.inf)) < left or float(obj.get("x0", math.inf)) > right or float(obj.get("bottom", -math.inf)) < top or float(obj.get("top", math.inf)) > bottom)


def inside(obj: dict[str, Any], crop: tuple[float, float, float, float]) -> bool:
    left, top, right, bottom = crop
    return (
        float(obj.get("x0", -math.inf)) >= left
        and float(obj.get("x1", math.inf)) <= right
        and float(obj.get("top", -math.inf)) >= top
        and float(obj.get("bottom", math.inf)) <= bottom
    )


def ideal_switch_objects(page: Any, crop: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    candidates = [obj for obj in [*page.lines, *page.curves] if overlaps(obj, crop)]
    lines = [
        obj for obj in candidates
        if obj.get("object_type") == "line"
        and float(obj.get("x0", 0)) >= crop[0]
        and float(obj.get("x1", 0)) <= crop[2]
        and float(obj.get("top", 0)) >= crop[1]
        and float(obj.get("bottom", 0)) <= crop[3]
    ]
    circles = [
        obj for obj in candidates
        if obj.get("object_type") == "curve"
        and obj.get("stroke") is True
        and obj.get("fill") is False
        and 2.8 <= float(obj.get("x1", 0)) - float(obj.get("x0", 0)) <= 2.9
        and 2.8 <= float(obj.get("bottom", 0)) - float(obj.get("top", 0)) <= 2.9
        and float(obj.get("x0", 0)) >= crop[0]
        and float(obj.get("x1", 0)) <= crop[2]
        and float(obj.get("top", 0)) >= crop[1]
        and float(obj.get("bottom", 0)) <= crop[3]
    ]
    if len(lines) != 3 or len(circles) != 2:
        raise RuntimeError(
            f"Razavi common extraction: expected 3 lines and 2 circles for ideal-switch, got {len(lines)} and {len(circles)}"
        )
    selected = [*lines, *circles]
    widths = {rounded(value.get("linewidth", 0) or 0) for value in selected}
    if widths != {0.717}:
        raise RuntimeError(f"Razavi common extraction: unexpected ideal-switch stroke widths {sorted(widths)}")
    return selected


def closed_switch_objects(page: Any, crop: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    candidates = [obj for obj in [*page.lines, *page.curves] if inside(obj, crop)]
    lines = [obj for obj in candidates if obj.get("object_type") == "line"]
    circles = [
        obj for obj in candidates
        if obj.get("object_type") == "curve"
        and obj.get("stroke") is True
        and obj.get("fill") is False
        and 2.8 <= float(obj.get("x1", 0)) - float(obj.get("x0", 0)) <= 2.9
        and 2.8 <= float(obj.get("bottom", 0)) - float(obj.get("top", 0)) <= 2.9
    ]
    if len(lines) != 3 or len(circles) != 2:
        raise RuntimeError(
            f"Razavi common extraction: expected two leads, one blade, and two contacts for closed-switch, got {len(lines)} and {len(circles)}"
        )
    horizontal = [
        value
        for value in lines
        if math.isclose(float(value["top"]), float(value["bottom"]), abs_tol=1e-6)
    ]
    blade = [value for value in lines if value not in horizontal]
    if len(horizontal) != 2 or len(blade) != 1:
        raise RuntimeError("Razavi common extraction: closed-switch object topology changed")
    selected = [*horizontal, blade[0], *circles]
    widths = {rounded(value.get("linewidth", 0) or 0) for value in selected}
    if widths != {0.717}:
        raise RuntimeError(f"Razavi common extraction: unexpected closed-switch stroke widths {sorted(widths)}")
    return selected


def externally_controlled_switch_objects(
    page: Any, crop: tuple[float, float, float, float]
) -> list[dict[str, Any]]:
    candidates = [obj for obj in [*page.lines, *page.curves] if inside(obj, crop)]
    lines = [obj for obj in candidates if obj.get("object_type") == "line"]
    vertical = [
        value
        for value in lines
        if math.isclose(float(value["x0"]), float(value["x1"]), abs_tol=1e-6)
    ]
    if len(vertical) != 2:
        raise RuntimeError("Razavi common extraction: externally controlled switch main leads changed")
    main_x = sum(float(value["x0"]) for value in vertical) / len(vertical)
    circles = [
        obj
        for obj in candidates
        if obj.get("object_type") == "curve"
        and obj.get("stroke") is True
        and obj.get("fill") is False
        and 2.8 <= float(obj.get("x1", 0)) - float(obj.get("x0", 0)) <= 2.9
        and 2.8 <= float(obj.get("bottom", 0)) - float(obj.get("top", 0)) <= 2.9
        and math.isclose(
            (float(obj["x0"]) + float(obj["x1"])) / 2,
            main_x,
            abs_tol=0.1,
        )
    ]
    if len(lines) != 4 or len(circles) != 2:
        raise RuntimeError(
            "Razavi common extraction: expected two main leads, one blade, one control lead, "
            f"and two contacts for externally-controlled-switch, got {len(lines)} and {len(circles)}"
        )
    horizontal = [
        value
        for value in lines
        if math.isclose(float(value["top"]), float(value["bottom"]), abs_tol=1e-6)
    ]
    blade = [value for value in lines if value not in horizontal and value not in vertical]
    if len(horizontal) != 1 or len(vertical) != 2 or len(blade) != 1:
        raise RuntimeError("Razavi common extraction: externally controlled switch topology changed")
    selected = [*vertical, horizontal[0], blade[0], *circles]
    widths = {rounded(value.get("linewidth", 0) or 0) for value in selected}
    if widths != {0.717}:
        raise RuntimeError(
            f"Razavi common extraction: unexpected externally controlled switch stroke widths {sorted(widths)}"
        )
    return selected


def ideal_switch_definition(objects: list[dict[str, Any]]) -> dict[str, Any]:
    lines = [value for value in objects if value.get("object_type") == "line"]
    contacts = sorted(
        [value for value in objects if value.get("object_type") == "curve"],
        key=lambda value: float(value["x0"]),
    )
    horizontal = sorted(
        [value for value in lines if math.isclose(float(value["top"]), float(value["bottom"]), abs_tol=1e-6)],
        key=lambda value: float(value["x0"]),
    )
    blades = [value for value in lines if value not in horizontal]
    if len(horizontal) != 2 or len(blades) != 1:
        raise RuntimeError("Razavi common extraction: ideal-switch object topology changed")

    left_lead, right_lead = horizontal
    blade = blades[0]
    native_stroke = float(blade["linewidth"])
    scale = RAZAVI_NORMAL_STROKE / native_stroke
    source_left = float(left_lead["x0"])
    source_right = float(right_lead["x1"])
    origin_x = (source_left + source_right) / 2
    baseline_y = sum(float(value["top"]) for value in horizontal) / len(horizontal)

    def nx(value: float) -> float:
        return rounded((float(value) - origin_x) * scale)

    def ny(value: float) -> float:
        return rounded((float(value) - baseline_y) * scale)

    def normalized_circle(value: dict[str, Any]) -> dict[str, Any]:
        center_x = (float(value["x0"]) + float(value["x1"])) / 2
        center_y = (float(value["top"]) + float(value["bottom"])) / 2
        diameter = (
            float(value["x1"]) - float(value["x0"])
            + float(value["bottom"]) - float(value["top"])
        ) / 2
        return circle(nx(center_x), ny(center_y), rounded(diameter * scale / 2))

    blade_path = blade.get("path") or []
    if len(blade_path) != 2:
        raise RuntimeError("Razavi common extraction: ideal-switch blade path changed")
    blade_start = blade_path[0][1]
    blade_end = blade_path[1][1]
    left_contact = normalized_circle(contacts[0])
    right_contact = normalized_circle(contacts[1])
    blade_start_normalized = (nx(blade_start[0]), ny(blade_start[1]))
    blade_end_normalized = (nx(blade_end[0]), ny(blade_end[1]))

    def clip_start_outside_contact(
        start: tuple[float, float],
        end: tuple[float, float],
        contact: dict[str, Any],
    ) -> tuple[float, float]:
        # The source blade begins inside the hollow pivot circle. Clip it to
        # the same centreline clearance as the closed-switch blade. This
        # overlaps the circle ring continuously but stays well outside the
        # hollow inner void; clipping at the outer ink edge creates a gap.
        center = contact["center"]
        radius = float(contact["radius"]) + SWITCH_BLADE_CONTACT_CLEARANCE
        dx, dy = end[0] - start[0], end[1] - start[1]
        ox, oy = start[0] - center["x"], start[1] - center["y"]
        quadratic_a = dx * dx + dy * dy
        quadratic_b = 2 * (ox * dx + oy * dy)
        quadratic_c = ox * ox + oy * oy - radius * radius
        discriminant = quadratic_b * quadratic_b - 4 * quadratic_a * quadratic_c
        if quadratic_a <= 0 or discriminant < 0:
            raise RuntimeError("Razavi common extraction: cannot clip ideal-switch blade")
        intersections = sorted(
            value
            for value in (
                (-quadratic_b - math.sqrt(discriminant)) / (2 * quadratic_a),
                (-quadratic_b + math.sqrt(discriminant)) / (2 * quadratic_a),
            )
            if 0 <= value <= 1
        )
        if not intersections:
            raise RuntimeError("Razavi common extraction: ideal-switch blade misses pivot contact")
        t = intersections[-1]
        return (rounded(start[0] + t * dx), rounded(start[1] + t * dy))

    clipped_blade_start = clip_start_outside_contact(
        blade_start_normalized,
        blade_end_normalized,
        left_contact,
    )
    primitives = [
        # Merge the small semantic extension into each source lead so butt caps
        # cannot create a raster seam at the on-grid pin anchor.  Stop its
        # centerline at the circle centerline boundary, never inside the hollow
        # contact where a butt cap would show as a protrusion.
        line(-30, 0, rounded(left_contact["center"]["x"] - left_contact["radius"]), 0),
        left_contact,
        line(*clipped_blade_start, *blade_end_normalized),
        right_contact,
        line(rounded(right_contact["center"]["x"] + right_contact["radius"]), 0, 30, 0),
    ]
    return symbol(
        "ideal-switch",
        "Open Switch",
        (-34, -18, 68, 30),
        [pin("1", "passive", -30, 0, "west"), pin("2", "passive", 30, 0, "east")],
        primitives,
        ["switch-open", "two-terminal-switch"],
    )


def closed_switch_definition(objects: list[dict[str, Any]]) -> dict[str, Any]:
    lines = [value for value in objects if value.get("object_type") == "line"]
    horizontal = sorted(
        [
            value
            for value in lines
            if math.isclose(float(value["top"]), float(value["bottom"]), abs_tol=1e-6)
        ],
        key=lambda value: float(value["x0"]),
    )
    blade = next(value for value in lines if value not in horizontal)
    if len(horizontal) != 2:
        raise RuntimeError("Razavi common extraction: closed-switch lead topology changed")
    contacts = sorted(
        [value for value in objects if value.get("object_type") == "curve"],
        key=lambda value: float(value["x0"]),
    )
    native_stroke = float(blade["linewidth"])
    scale = RAZAVI_NORMAL_STROKE / native_stroke
    centers = [
        (
            (float(value["x0"]) + float(value["x1"])) / 2,
            (float(value["top"]) + float(value["bottom"])) / 2,
        )
        for value in contacts
    ]
    origin_x = (centers[0][0] + centers[1][0]) / 2
    baseline_y = sum(center[1] for center in centers) / len(centers)

    def nx(value: float) -> float:
        return rounded((value - origin_x) * scale)

    def ny(value: float) -> float:
        return rounded((value - baseline_y) * scale)

    def normalized_circle(value: dict[str, Any]) -> dict[str, Any]:
        center_x = (float(value["x0"]) + float(value["x1"])) / 2
        center_y = (float(value["top"]) + float(value["bottom"])) / 2
        diameter = (
            float(value["x1"]) - float(value["x0"])
            + float(value["bottom"]) - float(value["top"])
        ) / 2
        return circle(nx(center_x), ny(center_y), rounded(diameter * scale / 2))

    left_contact, right_contact = [normalized_circle(value) for value in contacts]
    blade_path = blade.get("path") or []
    if len(blade_path) != 2:
        raise RuntimeError("Razavi common extraction: closed-switch blade path changed")
    blade_start = blade_path[0][1]
    blade_end = blade_path[1][1]

    def native_point(value: tuple[float, float]) -> tuple[float, float]:
        return (nx(float(value[0])), ny(float(value[1])))

    return symbol(
        "closed-switch",
        "Closed Switch",
        (-34, -12, 68, 24),
        [pin("1", "passive", -30, 0, "west"), pin("2", "passive", 30, 0, "east")],
        [
            # Native leads are 0.10 unit above the contact axis.  Preserve
            # their x extent but normalize y to the two pin anchors so the
            # symbol joins an external wire on one exact centreline.
            line(-30, 0, rounded(left_contact["center"]["x"] - left_contact["radius"]), 0),
            left_contact,
            line(*native_point(blade_start), *native_point(blade_end)),
            right_contact,
            line(rounded(right_contact["center"]["x"] + right_contact["radius"]), 0, 30, 0),
        ],
        ["switch-closed", "two-terminal-closed-switch"],
    )


def externally_controlled_switch_definition(
    objects: list[dict[str, Any]],
) -> dict[str, Any]:
    lines = [value for value in objects if value.get("object_type") == "line"]
    contacts = sorted(
        [value for value in objects if value.get("object_type") == "curve"],
        key=lambda value: float(value["top"]),
    )
    control = next(
        value
        for value in lines
        if math.isclose(float(value["top"]), float(value["bottom"]), abs_tol=1e-6)
    )
    blade = next(
        value
        for value in lines
        if not math.isclose(float(value["top"]), float(value["bottom"]), abs_tol=1e-6)
        and not math.isclose(float(value["x0"]), float(value["x1"]), abs_tol=1e-6)
    )
    native_stroke = float(blade["linewidth"])
    scale = RAZAVI_NORMAL_STROKE / native_stroke
    centers = [
        (
            (float(value["x0"]) + float(value["x1"])) / 2,
            (float(value["top"]) + float(value["bottom"])) / 2,
        )
        for value in contacts
    ]
    origin_x = sum(center[0] for center in centers) / len(centers)
    # The control pin is the one externally driven terminal. Keeping its native
    # centerline as y=0 preserves the blade/control joint while placing that
    # terminal exactly on the editor grid.
    origin_y = float(control["top"])

    def nx(value: float) -> float:
        return rounded((float(value) - origin_x) * scale)

    def ny(value: float) -> float:
        return rounded((float(value) - origin_y) * scale)

    def normalized_circle(value: dict[str, Any]) -> dict[str, Any]:
        center_x = (float(value["x0"]) + float(value["x1"])) / 2
        center_y = (float(value["top"]) + float(value["bottom"])) / 2
        diameter = (
            float(value["x1"]) - float(value["x0"])
            + float(value["bottom"]) - float(value["top"])
        ) / 2
        return circle(nx(center_x), ny(center_y), rounded(diameter * scale / 2))

    top_contact, bottom_contact = [normalized_circle(value) for value in contacts]
    blade_path = blade.get("path") or []
    if len(blade_path) != 2:
        raise RuntimeError("Razavi common extraction: externally controlled switch blade path changed")
    blade_points = [
        (nx(float(command[1][0])), ny(float(command[1][1])))
        for command in blade_path
    ]
    blade_points.sort(
        key=lambda point: math.hypot(
            point[0] - float(top_contact["center"]["x"]),
            point[1] - float(top_contact["center"]["y"]),
        )
    )
    blade_start, blade_end = blade_points

    # Match the established open-switch treatment: the source centerline
    # begins on the hollow contact's inner edge. Move it to the outer ring with
    # a small bounded overlap so antialiasing cannot reveal a white seam or a
    # line protruding through the hollow center.
    center = top_contact["center"]
    radius = float(top_contact["radius"]) + SWITCH_BLADE_CONTACT_CLEARANCE
    dx, dy = blade_end[0] - blade_start[0], blade_end[1] - blade_start[1]
    ox, oy = blade_start[0] - center["x"], blade_start[1] - center["y"]
    a = dx * dx + dy * dy
    b = 2 * (ox * dx + oy * dy)
    c = ox * ox + oy * oy - radius * radius
    discriminant = b * b - 4 * a * c
    if a <= 0 or discriminant < 0:
        raise RuntimeError("Razavi common extraction: cannot clip controlled-switch blade")
    intersections = sorted(
        value
        for value in (
            (-b - math.sqrt(discriminant)) / (2 * a),
            (-b + math.sqrt(discriminant)) / (2 * a),
        )
        if 0 <= value <= 1
    )
    if not intersections:
        raise RuntimeError("Razavi common extraction: controlled-switch blade misses contact")
    t = intersections[-1]
    clipped_start = (
        rounded(blade_start[0] + t * dx),
        rounded(blade_start[1] + t * dy),
    )
    control_end_x = nx(float(control["x1"]))

    return symbol(
        "externally-controlled-switch",
        "Externally Controlled Switch",
        (-34, -34, 68, 68),
        [
            pin("P", "passive", 0, -30, "north"),
            pin("N", "passive", 0, 30, "south"),
            pin("CTRL", "input", -30, 0, "west"),
        ],
        [
            line(0, -30, 0, rounded(top_contact["center"]["y"] - top_contact["radius"])),
            top_contact,
            line(*clipped_start, *blade_end),
            line(-30, 0, control_end_x, 0),
            bottom_contact,
            line(0, rounded(bottom_contact["center"]["y"] + bottom_contact["radius"]), 0, 30),
        ],
        ["pin-controlled-switch", "logic-controlled-switch"],
    )


def closed_switch_origin(objects: list[dict[str, Any]]) -> tuple[float, float]:
    contacts = sorted(
        [value for value in objects if value.get("object_type") == "curve"],
        key=lambda value: float(value["x0"]),
    )
    centers = [
        (
            (float(value["x0"]) + float(value["x1"])) / 2,
            (float(value["top"]) + float(value["bottom"])) / 2,
        )
        for value in contacts
    ]
    return (
        (centers[0][0] + centers[1][0]) / 2,
        sum(center[1] for center in centers) / len(centers),
    )


def ideal_switch_origin(objects: list[dict[str, Any]]) -> tuple[float, float]:
    contacts = sorted(
        [value for value in objects if value.get("object_type") == "curve"],
        key=lambda value: float(value["x0"]),
    )
    centers = [
        (
            (float(value["x0"]) + float(value["x1"])) / 2,
            (float(value["top"]) + float(value["bottom"])) / 2,
        )
        for value in contacts
    ]
    return (
        (centers[0][0] + centers[1][0]) / 2,
        sum(center[1] for center in centers) / len(centers),
    )


def externally_controlled_switch_origin(
    objects: list[dict[str, Any]],
) -> tuple[float, float]:
    contacts = [value for value in objects if value.get("object_type") == "curve"]
    control = next(
        value
        for value in objects
        if value.get("object_type") == "line"
        and math.isclose(float(value["top"]), float(value["bottom"]), abs_tol=1e-6)
    )
    return (
        sum((float(value["x0"]) + float(value["x1"])) / 2 for value in contacts)
        / len(contacts),
        float(control["top"]),
    )


def render_source_crop_witness(
    pdf_path: Path,
    page: Any,
    origin_pdf: tuple[float, float],
    output: Path,
    pdftoppm: str,
    window: dict[str, float] | None = None,
) -> dict[str, Any]:
    # The source coordinates are uniformly mapped from native points to logical
    # units. Render the original PDF at the matching native-points-to-pixels
    # scale and crop a fixed logical window around that origin. Unlike the
    # older helper above, this image is direct source evidence, never a Symbol
    # rendering disguised as a reference.
    scale = RAZAVI_NORMAL_STROKE / 0.717
    pixels_per_point = PIXELS_PER_LOGICAL * scale
    dpi = 72 * pixels_per_point
    # The witness always comes from the source PDF.  Its crop is fixed in the
    # source-derived logical coordinates recorded in evidence, never inferred
    # from a candidate Symbol render.
    if window is None:
        window = {"width": 96, "height": 48, "minX": -20, "minY": -8}
    media_left, media_top, _, _ = page.mediabox
    origin_full = {
        "x": (origin_pdf[0] - float(media_left)) * pixels_per_point,
        "y": (origin_pdf[1] - float(media_top)) * pixels_per_point,
    }
    crop_x = math.floor(origin_full["x"] + window["minX"] * PIXELS_PER_LOGICAL)
    crop_y = math.floor(origin_full["y"] + window["minY"] * PIXELS_PER_LOGICAL)
    executable = shutil.which(pdftoppm) or pdftoppm
    with tempfile.TemporaryDirectory(prefix="razavi-source-crop-") as temp_dir:
        raster_base = Path(temp_dir) / "source"
        subprocess.run(
            [
                executable,
                "-f", str(page.page_number), "-l", str(page.page_number),
                "-r", f"{dpi:.9f}", "-png", "-singlefile",
                "-x", str(crop_x), "-y", str(crop_y),
                "-W", str(window["width"]), "-H", str(window["height"]),
                str(pdf_path), str(raster_base),
            ],
            check=True,
            capture_output=True,
        )
        rendered = raster_base.with_suffix(".png")
        output.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(rendered) as image:
            rgba = image.convert("RGBA")
            if rgba.size != (window["width"], window["height"]):
                raise RuntimeError(
                    f"Razavi common extraction: source crop size {rgba.size} != {(window['width'], window['height'])}"
                )
            rgba.save(output, format="PNG", optimize=False)
    return {
        "kind": "source-pdf-crop",
        "sourcePdfPage": page.page_number,
        "dpi": rounded(dpi),
        "pixels": {"width": window["width"], "height": window["height"]},
        "pixelsPerLogical": PIXELS_PER_LOGICAL,
        "originPx": {
            "x": rounded(origin_full["x"] - crop_x),
            "y": rounded(origin_full["y"] - crop_y),
        },
        "window": window,
        "sourceCropPx": {"x": crop_x, "y": crop_y},
        "assetPath": output.name,
        "threshold": 160,
    }


def extract_one(pdf_path: Path, output_root: Path, asset_id: str, pdftoppm: str, source_hash: str, pdf: Any) -> None:
    spec = SPECS[asset_id]
    page = pdf.pages[spec["pdfPage"] - 1]
    if asset_id == "ideal-switch":
        source_objects = ideal_switch_objects(page, spec["crop"])
        definition = ideal_switch_definition(source_objects)
    elif asset_id == "closed-switch":
        source_objects = closed_switch_objects(page, spec["crop"])
        definition = closed_switch_definition(source_objects)
    elif asset_id == "externally-controlled-switch":
        source_objects = externally_controlled_switch_objects(page, spec["crop"])
        definition = externally_controlled_switch_definition(source_objects)
    else:
        selector = inside if spec.get("selectionMode") == "inside" else overlaps
        source_objects = [obj for obj in [*page.lines, *page.curves, *page.rects] if selector(obj, spec["crop"])]
        definition = spec["definition"]
    selected = [object_fingerprint(obj) for obj in source_objects]
    if not selected:
        raise RuntimeError(f"Razavi common extraction: no native vector objects found for {asset_id}")
    selected_hash = hashlib.sha256(json.dumps(selected, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
    png_path = output_root / f"{asset_id}-reference.png"
    source_origin = (
        closed_switch_origin(source_objects)
        if asset_id == "closed-switch"
        else externally_controlled_switch_origin(source_objects)
        if asset_id == "externally-controlled-switch"
        else ideal_switch_origin(source_objects)
        if asset_id == "ideal-switch"
        else spec["sourceOriginPdf"]
        if "sourceOriginPdf" in spec
        else (
            (float(source_objects[0]["x0"]) + float(source_objects[0]["x1"])) / 2,
            (float(source_objects[0]["top"]) + float(source_objects[0]["bottom"])) / 2,
        )
    )
    raster = render_source_crop_witness(
        pdf_path,
        page,
        source_origin,
        png_path,
        pdftoppm,
        None if asset_id == "closed-switch" else spec["witnessWindow"],
    )
    evidence = {
        "schemaVersion": 1,
        "id": f"razavi-textbook-{asset_id}",
        "kind": "pdf-vector-extract",
        "source": {"title": TITLE, "sha256": source_hash, "pdfPage": spec["pdfPage"], "printedPage": spec["printedPage"], "figure": spec["figure"]},
        "selection": {"method": spec["method"], "boundsPdf": {"left": spec["crop"][0], "top": spec["crop"][1], "right": spec["crop"][2], "bottom": spec["crop"][3]}, "nativeObjectCount": len(selected), "nativeObjectSha256": selected_hash, "nativeObjectSample": [compact_fingerprint(value) for value in selected[:12]]},
        "normalization": {"pinAnchorsLogical": [{"name": value["name"], **value["at"]} for value in definition["pins"]], "strokeMapping": {"normal": {"targetRole": "normal"}, "emphasis": {"targetRole": "emphasis"}}, "symbolDefinition": definition},
        "rasterWitness": raster,
    }
    if "derivation" in spec:
        evidence["derivation"] = spec["derivation"]
    json_path = output_root / f"{asset_id}-vector-source.json"
    json_path.write_text(
        json.dumps(evidence, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def write_geometry_registry(output_root: Path) -> None:
    symbols: dict[str, Any] = {}
    for asset_id in SPECS:
        evidence = json.loads((output_root / f"{asset_id}-vector-source.json").read_text(encoding="utf-8"))
        witness = evidence["rasterWitness"]
        witness_window = witness.get("window")
        symbols[asset_id] = {
            "assetPath": witness["assetPath"],
            "pixelsPerLogical": witness["pixelsPerLogical"],
            "originPx": witness["originPx"],
            "window": witness_window or {
                "width": witness["pixels"]["width"],
                "height": witness["pixels"]["height"],
                "minX": evidence["normalization"]["symbolDefinition"]["viewBox"]["x"],
                "minY": evidence["normalization"]["symbolDefinition"]["viewBox"]["y"],
            },
        }
    registry = {"schemaVersion": 1, "referenceId": "razavi-reference-v1", "symbols": symbols}
    (output_root / "common-symbol-geometry.json").write_text(
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
        raise RuntimeError(f"Razavi common extraction: source PDF SHA-256 mismatch: {source_hash}")
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    assets = SPECS.keys() if args.asset == "all" else [args.asset]
    with pdfplumber.open(pdf_path) as pdf:
        for asset_id in assets:
            extract_one(pdf_path, output_root, asset_id, args.pdftoppm, source_hash, pdf)
            print(f"Extracted razavi-textbook-{asset_id}")
    write_geometry_registry(output_root)


if __name__ == "__main__":
    main()
