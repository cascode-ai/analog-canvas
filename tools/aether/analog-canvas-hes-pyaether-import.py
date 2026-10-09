"""Recreate Analog Canvas geometry in an HES-backed Aether library.

Run inside Aether's Python Console. PyAether performs every database edit.
The source SPICE IR remains the electrical authority, while the source
placements, transforms, routes, junctions, and repeated ports control drawing.
"""

import json
import math
import os
import sys

sys.path.insert(0, globals().get("AETHER_TOOLS_ROOT", os.path.dirname(globals().get("__file__", ""))))
from analog_canvas_hes_parameters import parameter_plan, read_parameters, check_parameters
from analog_canvas_hes_contract import validate_manifest

try:
    import pyAether as ae
except ModuleNotFoundError:
    ae = None


LIBRARY = globals().get("AETHER_IMPORT_LIBRARY")
TECH_LIBRARY = "hes"
WORK_ROOT = globals().get("AETHER_IMPORT_ROOT", "")
LIBRARY_PARENT = globals().get("AETHER_LIBRARY_PARENT", "")
SPEC_PATH = os.path.join(WORK_ROOT, "aether_hes_import_spec.json")
RESULT_PATH = os.path.join(WORK_ROOT, "aether_hes_import_result.json")
JOURNAL_PATH = os.path.join(WORK_ROOT, "import-journal.jsonl")
LINE_LAYER = 228
DRAWING = ae.emvPurposeNumberDrawing if ae is not None else None
SCALE = 4
ORIGIN_X = 500
ORIGIN_Y = 500
LOCAL_LABEL_STUB_LENGTH = 80


def record_import_event(phase, cell, **details):
    # Native crashes bypass Python exceptions; persist the last attempted operation.
    with open(JOURNAL_PATH, "a", encoding="utf-8") as handle:
        handle.write(json.dumps({"phase": phase, "cellName": cell, **details}) + "\n")


def save_import_progress(imported, failures, expected_count):
    result = {"schema": "analog-canvas-hes-pyaether-result-v8", "library": LIBRARY,
              "technology": TECH_LIBRARY, "method": "PyAether database API with Analog Canvas source geometry",
              "expectedCircuitCount": expected_count, "savedCircuitCount": len(imported),
              "importComplete": len(imported) == expected_count and not failures,
              "readbackVerified": False, "circuits": imported, "failures": failures}
    with open(RESULT_PATH + ".tmp", "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, ensure_ascii=True)
        handle.write("\n")
    os.replace(RESULT_PATH + ".tmp", RESULT_PATH)


ORIENTATION_BY_SOURCE = {
    (0, "none"): "R0",
    (0, "horizontal"): "MY",
    (0, "vertical"): "MX",
    (0, "both"): "R180",
    (90, "none"): "R270",
    (90, "horizontal"): "MYR90",
    (90, "vertical"): "MXR90",
    (90, "both"): "R90",
    (180, "none"): "R180",
    (180, "horizontal"): "MX",
    (180, "vertical"): "MY",
    (180, "both"): "R0",
    (270, "none"): "R90",
    (270, "horizontal"): "MXR90",
    (270, "vertical"): "MYR90",
    (270, "both"): "R270",
}

TARGET_PIN_OFFSETS = {
    "hes/n_mos_a": {"D": (40, 30), "G": (0, 0), "S": (40, -30), "B": (50, -10)},
    "hes/p_mos_a": {"D": (40, -30), "G": (0, 0), "S": (40, 30), "B": (50, 10)},
    "hes/cap_mim": {"PLUS": (0, 0), "MINUS": (0, -60)},
    "hes/res_met": {"PLUS": (0, 0), "MINUS": (0, -60)},
    "analog/res": {"P": (0, 0), "N": (60, 0)},
    "analog/idc": {"P": (0, 0), "N": (0, -60)},
    "analog/vdc": {"P": (0, 0), "N": (0, -60)},
    "analog/ind": {"P": (0, 0), "N": (60, 0)},
    "analog/cap": {"P": (0, 0), "N": (60, 0)},
}


def object_name(value):
    for attribute in (
        "name",
        "getName",
        "_emyInst__getName",
        "_emyInstTerm__getName",
        "_emyTerm__getName",
        "_emyNet__getName",
    ):
        if not hasattr(value, attribute):
            continue
        result = getattr(value, attribute)
        try:
            result = result() if callable(result) else result
        except Exception:
            continue
        if result is not None:
            return str(result)
    return None


def master_term_name(inst_term):
    for method in ("getTermName",):
        if hasattr(inst_term, method):
            try:
                result = getattr(inst_term, method)()
                if result is not None:
                    return str(result)
            except Exception:
                pass
    for method in ("getTerm", "_emyInstTerm__getTerm"):
        if hasattr(inst_term, method):
            try:
                return object_name(getattr(inst_term, method)())
            except Exception:
                pass
    return object_name(inst_term)


def read_master_pin_offsets(library, cell):
    master = ae.dbOpenCV(library, cell, "symbol", "r")
    result = {}
    try:
        for term in list(master.getTopBlock().getTerms()):
            pins = list(term.getPins())
            if len(pins) != 1:
                raise ValueError(
                    "%s/%s.%s expected one pin, got %d"
                    % (library, cell, object_name(term), len(pins))
                )
            figures = list(pins[0].getFigs())
            if len(figures) != 1:
                raise ValueError(
                    "%s/%s.%s expected one pin figure, got %d"
                    % (library, cell, object_name(term), len(figures))
                )
            box = figures[0].dbuBox
            left = box.left() if callable(box.left) else box.left
            right = box.right() if callable(box.right) else box.right
            bottom = box.bottom() if callable(box.bottom) else box.bottom
            top = box.top() if callable(box.top) else box.top
            result[object_name(term)] = (
                int((left + right) // 2),
                int((bottom + top) // 2),
            )
    finally:
        master.close()
    return result


def validate_target_pin_offsets():
    for master_name, expected in TARGET_PIN_OFFSETS.items():
        library, cell = master_name.split("/", 1)
        actual = read_master_pin_offsets(library, cell)
        if actual != expected:
            raise ValueError(
                "%s target pin coordinates changed: expected=%r actual=%r"
                % (master_name, expected, actual)
            )


def db_point(design, xy):
    point = ae.emyPointF()
    ae.emyDbu2UU(design, (int(xy[0]), int(xy[1])), point)
    return point


def segment(design, net, start, end):
    start = tuple(map(int, start))
    end = tuple(map(int, end))
    if start == end:
        return 0
    figures = ae.dbCrtSchWire(
        design, [db_point(design, start), db_point(design, end)]
    )
    for figure in figures:
        figure.addToNet(net)
        ae.dbAddFigToNet(figure, net)
    return len(figures)


def orthogonal_path(design, net, points):
    count = 0
    for start, end in zip(points, points[1:]):
        start = tuple(map(int, start))
        end = tuple(map(int, end))
        if start[0] != end[0] and start[1] != end[1]:
            bend = (end[0], start[1])
            count += segment(design, net, start, bend)
            count += segment(design, net, bend, end)
        else:
            count += segment(design, net, start, end)
    return count


def source_path(design, net, points):
    count = 0
    for start, end in zip(points, points[1:]):
        count += segment(design, net, start, end)
    return count


def junction(block, net, xy):
    x, y = xy
    dot = ae.emyEllipse.create(
        block, LINE_LAYER, DRAWING, (x - 5, y - 5, x + 5, y + 5)
    )
    dot.addToNet(net)


def source_orientation(transform):
    key = (int(transform.get("rotation", 0)) % 360, transform.get("mirror", "none"))
    if key not in ORIENTATION_BY_SOURCE:
        raise ValueError("Unsupported source transform %r" % (key,))
    return ORIENTATION_BY_SOURCE[key]


def orient_offset(offset, orient):
    x, y = offset
    if orient == "R0":
        return x, y
    if orient == "R90":
        return -y, x
    if orient == "R180":
        return -x, -y
    if orient == "R270":
        return y, -x
    if orient == "MY":
        return -x, y
    if orient == "MX":
        return x, -y
    if orient == "MXR90":
        return y, x
    if orient == "MYR90":
        return -y, -x
    raise ValueError("Unsupported Aether orientation %s" % orient)


def instance_orientation(item):
    source = source_orientation(item["sourceTransform"])
    # Native R/L/C symbols are horizontal; Canvas uses a vertical basis.
    horizontal = item["targetLibrary"] == "analog" and item["targetCell"] in ("res", "ind", "cap")
    basis = "R270" if horizontal else "R0"
    axes = [(1, 0), (0, 1)]
    wanted = [orient_offset(orient_offset(axis, basis), source) for axis in axes]
    for orient in ("R0", "R90", "R180", "R270", "MX", "MY", "MXR90", "MYR90"):
        if [orient_offset(axis, orient) for axis in axes] == wanted:
            return orient
    raise ValueError("Unsupported symbol basis")


def instance_base_offsets(item):
    master_name = "%s/%s" % (item["targetLibrary"], item["targetCell"])
    if master_name not in TARGET_PIN_OFFSETS:
        raise ValueError(
            "Unsupported target master %s on %s"
            % (master_name, item["reference"])
        )
    return TARGET_PIN_OFFSETS[master_name]


def instance_anchors(item, origin, orient):
    result = {}
    for pin_name, offset in instance_base_offsets(item).items():
        dx, dy = orient_offset(offset, orient)
        result[pin_name] = (origin[0] + dx, origin[1] + dy)
    return result


def anchor_pin_pair(item):
    if item["deviceClass"] == "mos":
        return "D", "S"
    return ("P", "N") if "P" in instance_base_offsets(item) else ("PLUS", "MINUS")


def pin_orientation(port):
    if "targetOrient" in port:
        return port["targetOrient"]
    symbol = port["sourceSymbolId"]
    if symbol == "vdd-port":
        return "R270"
    if symbol == "ground":
        return "R90"
    orient = source_orientation(port["sourceTransform"])
    vector = orient_offset((1, 0), orient)
    return {
        (1, 0): "R0",
        (0, 1): "R90",
        (-1, 0): "R180",
        (0, -1): "R270",
    }[vector]


def create_pin(design, net, port, xy):
    api_direction = (
        "inputOutput" if port["direction"] == "inout" else port["direction"]
    )
    pin = ae.dbCrtSchPin(
        design,
        port["name"],
        db_point(design, xy),
        api_direction,
        False,
        pin_orientation(port),
    )
    if pin is None:
        raise ValueError("PyAether failed to create pin %s" % port["name"])
    term = pin.getTerm()
    if term is None:
        raise ValueError("PyAether pin %s has no terminal" % port["name"])
    term.moveToNet(net)


def enforce_minimum_separation(origins, constraints):
    """Solve integer difference bounds without breaking exact alignment groups."""
    result = dict(origins)
    for iteration in range(len(result)):
        changed = False
        for start, end, distance in constraints:
            lower_bound = result[start] + distance
            if result[end] < lower_bound:
                result[end] = lower_bound
                changed = True
        if not changed:
            return result
    raise ValueError("Inconsistent diagonal direction constraints")


def build_layout(source, *, _reference_only=False):
    geometry = source["sourceGeometry"]
    bounds = geometry["bounds"]
    policy = source.get("geometryPolicy", {})
    compact = policy.get("name") == "hes-symbol-pitch-v1"
    if policy and not compact:
        raise ValueError("Unknown geometry policy %r" % policy)
    # Canvas MOS D/S pitch is 40; the validated HES master pitch is 60 DBU.
    spacing_factor = float(policy.get("spacingFactor", 1.0))
    if not math.isfinite(spacing_factor) or spacing_factor <= 0:
        raise ValueError("spacingFactor must be finite and positive")
    scale = 1.5 * spacing_factor if compact else SCALE
    local_stub_length = int(round(30 * spacing_factor)) if compact else LOCAL_LABEL_STUB_LENGTH

    def convert(point):
        return (
            ORIGIN_X + int(round((point["x"] - bounds["minX"]) * scale)),
            ORIGIN_Y + int(round((bounds["maxY"] - point["y"]) * scale)),
        )

    preferred = {}
    orientations = {}
    source_endpoint_targets = {}
    for item in source["instances"]:
        origin = convert(item["sourcePosition"])
        orient = instance_orientation(item)
        if compact and not item.get("sourceExpandedFrom"):
            pair = anchor_pin_pair(item)
            source_pins = item["sourcePinPositions"]
            a, b = (source_pins[pin] for pin in pair)
            if item["deviceClass"] == "mos" and abs(a["x"] - b["x"]) + abs(a["y"] - b["y"]) != 40:
                raise ValueError("Unexpected Canvas MOS pitch on %s" % item["reference"])
            midpoint = convert({"x": (a["x"] + b["x"]) / 2, "y": (a["y"] + b["y"]) / 2})
            target_pins = instance_base_offsets(item)
            offsets = [orient_offset(target_pins[pin], orient) for pin in pair]
            origin = tuple(int(round(midpoint[axis] - (offsets[0][axis] + offsets[1][axis]) / 2)) for axis in (0, 1))
        variable = "instance:%s" % item["reference"]
        preferred[variable] = origin
        orientations[item["reference"]] = orient
        source_id = item.get("sourceExpandedInstanceId", item.get("sourceExpandedFrom", item["id"]))
        for node in item["nodes"]:
            key = (source_id, node["sourcePinName"])
            offset = orient_offset(
                instance_base_offsets(item)[node["pinName"]], orient
            )
            source_endpoint_targets.setdefault(key, []).append(
                {
                    "expression": (variable, offset),
                    "reference": item["reference"],
                    "pinName": node["pinName"],
                    "netName": node["netName"],
                }
            )

    ports = []
    port_variables = {}
    for port in geometry["portOccurrences"]:
        target = dict(port)
        variable = "port:%s" % port["occurrenceId"]
        preferred[variable] = convert(port["sourcePosition"])
        port_variables[port["occurrenceId"]] = variable
        target["variable"] = variable
        ports.append(target)

    net_markers = []
    for marker in geometry.get("internalNetMarkers", []):
        target = dict(marker)
        variable = "marker:%s" % marker["occurrenceId"]
        preferred[variable] = convert(marker["sourcePosition"])
        port_variables[marker["occurrenceId"]] = variable
        target["variable"] = variable
        net_markers.append(target)

    junction_variables = {}
    for item in geometry["junctions"]:
        variable = "junction:%s" % item["id"]
        preferred[variable] = convert(item["sourcePosition"])
        junction_variables[item["id"]] = variable

    def endpoint_expression(endpoint):
        if endpoint["kind"] == "junction":
            return (junction_variables[endpoint["junctionId"]], (0, 0))
        instance_id = endpoint["instanceId"]
        if instance_id in port_variables:
            return (port_variables[instance_id], (0, 0))
        rows = source_endpoint_targets.get((instance_id, endpoint["pinName"]), [])
        if not rows:
            raise ValueError(
                "%s cannot resolve source endpoint %s.%s"
                % (source["cellName"], instance_id, endpoint["pinName"])
            )
        return rows[0]["expression"]

    equations = {0: [], 1: []}
    geometry_edges = []

    def add_exact_edge(kind, edge_id, source_a, expression_a, source_b, expression_b):
        same_x = source_a["x"] == source_b["x"]
        same_y = source_a["y"] == source_b["y"]
        metadata = {"kind": kind, "id": edge_id}
        expected_delta = (
            int(round((source_b["x"] - source_a["x"]) * scale)),
            int(round((source_a["y"] - source_b["y"]) * scale)),
        )
        if same_x:
            equations[0].append((expression_a, expression_b, metadata))
        if same_y:
            equations[1].append((expression_a, expression_b, metadata))
        geometry_edges.append(
            {
                "kind": kind,
                "id": edge_id,
                "sourceA": source_a,
                "sourceB": source_b,
                "sameX": same_x,
                "sameY": same_y,
                "expectedDelta": expected_delta,
                "expressionA": expression_a,
                "expressionB": expression_b,
            }
        )

    route_rows = []
    for route in geometry["routes"]:
        source_points = [route["start"]["sourcePoint"]]
        expressions = [endpoint_expression(route["start"])]
        for index, step in enumerate(route["steps"]):
            if step["kind"] == "bend":
                variable = "bend:%s:%d" % (route["id"], index)
                preferred[variable] = convert(step["position"])
                source_points.append(step["position"])
                expressions.append((variable, (0, 0)))
            else:
                source_points.append(step["sourcePoint"])
                expressions.append(endpoint_expression(step))
        for index, (source_a, source_b, expression_a, expression_b) in enumerate(
            zip(
                source_points,
                source_points[1:],
                expressions,
                expressions[1:],
            )
        ):
            add_exact_edge(
                "route",
                "%s:%d" % (route["id"], index),
                source_a,
                expression_a,
                source_b,
                expression_b,
            )
        route_rows.append((route, expressions))

    contact_rows = []
    for contact in geometry["contacts"]:
        expressions = [endpoint_expression(item) for item in contact["endpoints"]]
        source_points = [item["sourcePoint"] for item in contact["endpoints"]]
        for index in range(1, len(expressions)):
            add_exact_edge(
                "contact",
                "%s:%d" % (contact["id"], index),
                source_points[0],
                expressions[0],
                source_points[index],
                expressions[index],
            )
        contact_rows.append((contact, expressions))

    annotation_rows = []
    for item in geometry.get("annotationStubs", []):
        if item.get("anchorJunctionId"):
            start_expression = (
                junction_variables[item["anchorJunctionId"]],
                (0, 0),
            )
        else:
            start_variable = "annotation-start:%s" % item["annotationId"]
            preferred[start_variable] = convert(item["start"])
            start_expression = (start_variable, (0, 0))
        end_expression = (
            port_variables[item["annotationId"]],
            (0, 0),
        )
        add_exact_edge(
            "annotation",
            item["annotationId"],
            item["start"],
            start_expression,
            item["end"],
            end_expression,
        )
        annotation_rows.append((item, start_expression, end_expression))

    if compact and spacing_factor != 1.0:
        baseline_source = dict(source)
        baseline_source["geometryPolicy"] = dict(policy, spacingFactor=1.0)
        # The tight layout is only a placement reference, not the delivered drawing.
        baseline = build_layout(baseline_source, _reference_only=True)
        instance_by_variable = {"instance:" + item["reference"]: item for item in source["instances"]}
        for variable, point in baseline["coordinateVariables"].items():
            item = instance_by_variable.get(variable)
            offset = (0, 0)
            if item is not None:
                pins = instance_base_offsets(item)
                pair = anchor_pin_pair(item)
                oriented = [orient_offset(pins[pin], orientations[item["reference"]]) for pin in pair]
                offset = tuple((oriented[0][axis] + oriented[1][axis]) / 2 for axis in (0, 1))
            preferred[variable] = tuple(int(round(origin + (point[axis] + offset[axis] - origin) * spacing_factor - offset[axis])) for axis, origin in enumerate((ORIGIN_X, ORIGIN_Y)))

    def solve_axis(axis):
        graph = {variable: [] for variable in preferred}
        for left, right, metadata in equations[axis]:
            left_variable, left_offset = left
            right_variable, right_offset = right
            delta = left_offset[axis] - right_offset[axis]
            graph[left_variable].append((right_variable, delta, metadata))
            graph[right_variable].append((left_variable, -delta, metadata))

        values = {}
        components = {}
        relative_offsets = {}
        origins = {}
        component_count = 0
        for root in sorted(graph):
            if root in values:
                continue
            component_count += 1
            relative = {root: 0}
            pending = [root]
            for current in pending:
                for neighbor, delta, metadata in graph[current]:
                    expected = relative[current] + delta
                    if neighbor in relative:
                        if relative[neighbor] != expected:
                            raise ValueError(
                                "%s has inconsistent exact %s constraints at %s: %d != %d"
                                % (
                                    source["cellName"],
                                    "X" if axis == 0 else "Y",
                                    metadata,
                                    relative[neighbor],
                                    expected,
                                )
                            )
                        continue
                    relative[neighbor] = expected
                    pending.append(neighbor)
            # Each equality component has one translation degree of freedom.
            # Spacing edits prioritize device centers; bends and ports follow
            # their exact pin constraints instead of stretching device spacing.
            targets = {node: offset for node, offset in relative.items() if compact and spacing_factor != 1.0 and node.startswith("instance:")}
            if not targets:
                targets = relative
            origin = int(
                round(
                    sum(preferred[node][axis] - offset for node, offset in targets.items())
                    / float(len(targets))
                )
            )
            for node, offset in relative.items():
                values[node] = origin + offset
                components[node] = root
                relative_offsets[node] = offset
            origins[root] = origin

        # Pin sizes can reverse a short diagonal after alignment. Move entire
        # equality groups, never individual pins or a wire's electrical endpoint.
        bounds = []
        for edge in geometry_edges:
            if edge["sameX"] or edge["sameY"]:
                continue
            left, left_offset = edge["expressionA"]
            right, right_offset = edge["expressionB"]
            left_value = relative_offsets[left] + left_offset[axis]
            right_value = relative_offsets[right] + right_offset[axis]
            if edge["expectedDelta"][axis] > 0:
                bounds.append((components[left], components[right], left_value - right_value + 1))
            else:
                bounds.append((components[right], components[left], right_value - left_value + 1))
        if bounds:
            shifted = enforce_minimum_separation(origins, bounds)
            values = {node: shifted[components[node]] + relative_offsets[node] for node in values}
        return values, component_count

    solved_x, x_components = solve_axis(0)
    solved_y, y_components = solve_axis(1)
    solved = {
        variable: (solved_x[variable], solved_y[variable])
        for variable in preferred
    }

    def expression_point(expression, coordinates):
        variable, offset = expression
        point = coordinates[variable]
        return (point[0] + offset[0], point[1] + offset[1])

    def edge_violation(edge, coordinates):
        first = expression_point(edge["expressionA"], coordinates)
        second = expression_point(edge["expressionB"], coordinates)
        axes = []
        if edge["sameX"] and first[0] != second[0]:
            axes.append("X")
        if edge["sameY"] and first[1] != second[1]:
            axes.append("Y")
        if not edge["sameX"] and not edge["sameY"]:
            actual_delta = (second[0] - first[0], second[1] - first[1])
            expected_delta = edge["expectedDelta"]
            if actual_delta[0] == 0 or (actual_delta[0] > 0) != (expected_delta[0] > 0):
                axes.append("DX")
            if actual_delta[1] == 0 or (actual_delta[1] > 0) != (expected_delta[1] > 0):
                axes.append("DY")
        return axes, first, second

    before_violations = []
    after_violations = []
    for edge in geometry_edges:
        before_axes, before_a, before_b = edge_violation(edge, preferred)
        after_axes, after_a, after_b = edge_violation(edge, solved)
        if before_axes:
            before_violations.append(
                {
                    "kind": edge["kind"],
                    "id": edge["id"],
                    "axes": before_axes,
                    "targetA": before_a,
                    "targetB": before_b,
                }
            )
        if after_axes:
            after_violations.append(
                {
                    "kind": edge["kind"],
                    "id": edge["id"],
                    "axes": after_axes,
                    "targetA": after_a,
                    "targetB": after_b,
                }
            )
    if after_violations and not _reference_only:
        raise ValueError(
            "%s retains %d exact coordinate violations at spacing %s: %r"
            % (source["cellName"], len(after_violations), spacing_factor, after_violations)
        )

    placements = {
        item["reference"]: solved["instance:%s" % item["reference"]]
        for item in source["instances"]
    }
    anchors = {
        item["reference"]: instance_anchors(
            item,
            placements[item["reference"]],
            orientations[item["reference"]],
        )
        for item in source["instances"]
    }
    for port in ports + net_markers:
        port["xy"] = solved[port.pop("variable")]

    junction_points = {
        item["id"]: solved[junction_variables[item["id"]]]
        for item in geometry["junctions"]
    }

    bulk_stubs = []
    for label in geometry.get("localBulkLabels", []):
        anchor = anchors[label["reference"]][label["pinName"]]
        origin = placements[label["reference"]]
        dx, dy = anchor[0] - origin[0], anchor[1] - origin[1]
        if abs(dx) >= abs(dy):
            outward = (1 if dx >= 0 else -1, 0)
        else:
            outward = (0, 1 if dy >= 0 else -1)
        endpoint = (
            anchor[0] + local_stub_length * outward[0],
            anchor[1] + local_stub_length * outward[1],
        )
        inward = (-outward[0], -outward[1])
        target_orient = {
            (1, 0): "R0",
            (0, 1): "R90",
            (-1, 0): "R180",
            (0, -1): "R270",
        }[inward]
        port = dict(label)
        port.update(
            {
                "occurrenceId": "BULK_%s" % label["reference"],
                "sourceSymbolId": "bulk-label",
                "targetOrient": target_orient,
                "xy": endpoint,
            }
        )
        ports.append(port)
        bulk_stubs.append(
            {"netName": label["netName"], "points": [anchor, endpoint]}
        )

    bulk_shorts = [
        {
            "netName": item["netName"],
            "points": [
                anchors[item["reference"]][item["bulkPinName"]],
                anchors[item["reference"]][item["sourcePinName"]],
            ],
        }
        for item in geometry.get("localBulkShorts", [])
    ]

    annotation_stubs = [
        {
            "netName": item["netName"],
            "points": [
                expression_point(start_expression, solved),
                expression_point(end_expression, solved),
            ],
        }
        for item, start_expression, end_expression in annotation_rows
    ]

    routes = []
    for route, expressions in route_rows:
        points = [expression_point(item, solved) for item in expressions]
        routes.append({"id": route["id"], "netName": route["netName"], "points": points})

    contacts = []
    for contact, expressions in contact_rows:
        points = [expression_point(item, solved) for item in expressions]
        contacts.append(
            {"id": contact["id"], "netName": contact["netName"], "points": points}
        )

    expanded_links = []
    for (_source_id, _source_pin), rows in source_endpoint_targets.items():
        by_net = {}
        for row in rows:
            by_net.setdefault(row["netName"], []).append(
                expression_point(row["expression"], solved)
            )
        for net_name, points in by_net.items():
            if len(points) > 1:
                expanded_links.append({"netName": net_name, "points": points})

    return {
        "coordinateVariables": solved,
        "placements": placements,
        "orientations": orientations,
        "anchors": anchors,
        "ports": ports,
        "internalNetMarkers": net_markers,
        "routes": routes,
        "contacts": contacts,
        "expandedLinks": expanded_links,
        "bulkStubs": bulk_stubs,
        "bulkShorts": bulk_shorts,
        "annotationStubs": annotation_stubs,
        "junctions": [
            {
                "netName": item["netName"],
                "xy": junction_points[item["id"]],
                "role": item["role"],
            }
            for item in geometry["junctions"]
        ],
        "geometryAudit": {
            "coordinateScale": scale,
            "spacingFactor": spacing_factor,
            "placementReference": "source/target pin-pair midpoint" if compact else "legacy instance origin",
            "method": "exact orthogonal constraints plus direct source-diagonal segments",
            "diagonalPolicy": "preserve a direct diagonal and its direction after target-PDK pin-offset conversion",
            "sourceEdges": len(geometry_edges),
            "horizontalEdges": sum(1 for item in geometry_edges if item["sameY"]),
            "verticalEdges": sum(1 for item in geometry_edges if item["sameX"]),
            "diagonalEdges": sum(
                1 for item in geometry_edges
                if not item["sameX"] and not item["sameY"]
            ),
            "xEquations": len(equations[0]),
            "yEquations": len(equations[1]),
            "xComponents": x_components,
            "yComponents": y_components,
            "beforeViolationCount": len(before_violations),
            "afterViolationCount": len(after_violations),
            "beforeViolations": before_violations,
            "afterViolations": after_violations,
        },
    }


def bind_instance_terms(instance, item, nets, design=None, cell=None):
    expected = {node["pinName"]: node["netName"] for node in item["nodes"]}
    bound = set()
    for inst_term in list(instance.getInstTerms()):
        pin_name = master_term_name(inst_term)
        if pin_name not in expected:
            continue
        net_name = expected[pin_name]
        net = ae.dbFindNetByName(design, net_name) if design is not None else nets[net_name]
        if net is None or net == 0:
            raise ValueError("%s.%s: native net is missing: %s" % (item["reference"], pin_name, net_name))
        if cell is not None:
            record_import_event("bind-terminal", cell, reference=item["reference"],
                                terminal=pin_name, net=net_name)
        inst_term.addToNet(net)
        bound.add(pin_name)
    if bound != set(expected):
        raise ValueError(
            "%s terminal bind mismatch expected=%s actual=%s"
            % (item["reference"], sorted(expected), sorted(bound))
        )


def planned_wire_segments(layout):
    """Enumerate exact source segments and deterministic local connector elbows."""
    segments = []

    def add(net, points, orthogonal=False):
        for start, end in zip(points, points[1:]):
            start, end = tuple(map(int, start)), tuple(map(int, end))
            if start == end:
                continue
            if orthogonal and start[0] != end[0] and start[1] != end[1]:
                bend = (end[0], start[1])
                segments.extend([(net, start, bend), (net, bend, end)])
            else:
                segments.append((net, start, end))

    for route in layout["routes"]:
        add(route["netName"], route["points"])
    for key in ("contacts", "expandedLinks"):
        for item in layout[key]:
            for point in item["points"][1:]:
                add(item["netName"], [item["points"][0], point], True)
    for key in ("bulkStubs", "bulkShorts", "annotationStubs"):
        for item in layout[key]:
            add(item["netName"], item["points"], True)
    return segments


def build_cell(source):
    layout = build_layout(source)
    cell_file = os.path.join(
        LIBRARY_PARENT, LIBRARY, source["cellName"], "schematic", "sch.oa"
    )
    if os.path.isfile(cell_file):
        raise FileExistsError("Refusing to reuse or overwrite %s; choose a new library or run the verifier explicitly" % cell_file)

    ae.dbNewCV(LIBRARY, source["cellName"], "schematic")
    design = ae.dbOpenCV(LIBRARY, source["cellName"], "schematic", "w")
    if design is None:
        raise RuntimeError("Aether could not open new cell %s/%s" % (LIBRARY, source["cellName"]))
    try:
        return populate_cell(source, layout, design)
    finally:
        design.close()


def populate_cell(source, layout, design):
    block = design.getTopBlock()
    if block is None:
        block = ae.emyBlock.create(design)
    nets = {}
    for name in source["nets"]:
        net = ae.dbCrtNet(design, name)
        if net is None or net == 0:
            raise ValueError("%s: Aether rejected net name %r" % (source["cellName"], name))
        nets[name] = net
    for port in source["ports"]:
        term = ae.dbCrtTerm(nets[port["netName"]], port["name"], "inputOutput")
        if term is None or term == 0:
            raise ValueError("%s: Aether rejected terminal %r" % (source["cellName"], port["name"]))

    parameters = {}
    for item in source["instances"]:
        record_import_event("instance", source["cellName"], reference=item["reference"],
                            master=item["targetLibrary"] + "/" + item["targetCell"])
        master = ae.dbOpenCV(item["targetLibrary"], item["targetCell"], "symbol", "r")
        if master is None:
            raise RuntimeError("Cannot open native master for " + item["reference"])
        record_import_event("create-instance", source["cellName"], reference=item["reference"])
        instance = ae.dbCrtInst(
            design,
            db_point(design, layout["placements"][item["reference"]]),
            master,
            inst=item["reference"],
            orient=layout["orientations"][item["reference"]],
        )
        if instance is None:
            raise RuntimeError("Cannot create native instance " + item["reference"])
        bind_instance_terms(instance, item, nets, design, source["cellName"])
        plan = parameter_plan(item)
        for name, value in plan["writes"]:
            record_import_event("parameter", source["cellName"], reference=item["reference"],
                                parameter=name, value=value)
            if not ae.dbSetInstParam(instance, name, value, mode=1):
                raise ValueError("%s: parameter write failed: %s=%s" % (item["reference"], name, value))
        actual = read_parameters(ae, instance, plan["expected"])
        mismatches = check_parameters(actual, plan["expected"])
        if mismatches:
            raise ValueError("%s: PDK changed requested parameters: %r" % (item["reference"], mismatches))
        parameters[item["reference"]] = actual
        # Keep the master's native interpreted labels. schSetPropertyDisplay
        # creates extra instance text; it does not hide inherited CDF labels.
        master.close()

    record_import_event("wires", source["cellName"])
    wire_figures = 0
    for net_name, start, end in planned_wire_segments(layout):
        wire_figures += segment(design, nets[net_name], start, end)
    for item in layout["junctions"]:
        if item["role"] == "branch":
            junction(block, nets[item["netName"]], item["xy"])
    for port in layout["ports"]:
        record_import_event("port", source["cellName"], port=port)
        create_pin(design, nets[port["netName"]], port, port["xy"])
    for marker in layout["internalNetMarkers"]:
        label = ae.dbCrtLabel(design, db_point(design, marker["xy"]), marker["netName"],
                              0.05, layer="228", draft=False)
        if label is None:
            raise RuntimeError("Cannot create internal net marker %s" % marker["netName"])
        ae.dbAddFigToNet(label, nets[marker["netName"]])

    record_import_event("save", source["cellName"])
    design.save()
    return {
        "cellName": source["cellName"],
        "galleryId": source["galleryId"],
        "galleryName": source["galleryName"],
        "instances": len(source["instances"]),
        "logicalPorts": [item["name"] for item in source["ports"]],
        "portOccurrences": len(layout["ports"]),
        "bulkLabels": len(source["sourceGeometry"].get("localBulkLabels", [])),
        "bulkShorts": len(source["sourceGeometry"].get("localBulkShorts", [])),
        "nets": len(source["nets"]),
        "wireFigures": wire_figures,
        "reusedExistingCell": False,
        "geometryMode": "Analog Canvas faithful",
        "sourceRoutes": source["sourceGeometry"]["sourceRouteCount"],
        "retainedRoutes": source["sourceGeometry"]["retainedRouteCount"],
        "sourceTransformsApplied": True,
        "repeatedPortsApplied": True,
        "instanceTermNetsBoundDirectly": True,
        "parametersWrittenAndReadBack": parameters,
        "labelMode": "native-pdk",
        "nativeNameMap": source.get("nativeNameMap", {}),
        "sizingAdjustments": [{"reference": item["reference"], **item["targetSizingAdjustment"]}
                              for item in source["instances"] if item.get("targetSizingAdjustment")],
        "logicalOnlyPorts": source["sourceGeometry"].get("logicalOnlyPorts", []),
        "geometryAudit": layout["geometryAudit"],
    }


def main():
    if ae is None:
        raise RuntimeError("Run this importer inside Aether's PyAether console")
    if not os.path.isabs(WORK_ROOT) or not os.path.isabs(LIBRARY_PARENT) or not os.path.isdir(LIBRARY_PARENT):
        raise ValueError("Set absolute AETHER_IMPORT_ROOT and an existing AETHER_LIBRARY_PARENT")
    ae.emyInitTcl()
    ae.emyInitDb()
    with open(SPEC_PATH, "r", encoding="utf-8") as handle:
        spec = json.load(handle)
    validate_manifest(spec)
    validate_target_pin_offsets()
    if spec["schema"] != "analog-canvas-hes-pyaether-import-v8":
        raise ValueError("Export a v8 manifest with explicit source units first")
    if spec["targetTechnology"] != TECH_LIBRARY:
        raise ValueError("Unexpected target technology")
    if spec["targetLibrary"] != LIBRARY:
        raise ValueError("Unexpected target library")
    # Validate the whole batch before making any database changes.
    for source in spec["circuits"]:
        path = os.path.join(LIBRARY_PARENT, LIBRARY, source["cellName"], "schematic", "sch.oa")
        if os.path.exists(path):
            raise FileExistsError("Existing cell: %s. Import into a new library; nothing was changed." % path)
        if any(port.get("synthesized") for port in source["sourceGeometry"]["portOccurrences"]):
            raise ValueError("Invented graphical ports are not allowed")
        build_layout(source)
        for item in source["instances"]:
            parameter_plan(item)

    library_path = os.path.join(LIBRARY_PARENT, LIBRARY)
    if os.path.exists(library_path):
        raise FileExistsError("Target library path already exists: %s. Keep the bundle directory separate from the native library." % library_path)
    library = ae.dbCreateLib(LIBRARY, path=LIBRARY_PARENT, attachTechLib=TECH_LIBRARY)
    if library is None:
        raise RuntimeError("Aether could not create target library %s; no cells were imported" % LIBRARY)
    imported = []
    save_import_progress(imported, [], len(spec["circuits"]))
    for source in spec["circuits"]:
        record_import_event("cell-start", source["cellName"])
        try:
            imported.append(build_cell(source))
        except Exception as error:
            record_import_event("cell-failed", source["cellName"], error=str(error))
            save_import_progress(imported, [{"cellName": source["cellName"], "error": str(error)}],
                                 len(spec["circuits"]))
            raise
        record_import_event("cell-saved", source["cellName"], result=imported[-1])
        save_import_progress(imported, [], len(spec["circuits"]))
    audit_path = os.path.join(WORK_ROOT, "aether_hes_geometry_audit.json")
    audit = {
        "schema": "analog-canvas-hes-geometry-audit-v1",
        "library": LIBRARY,
        "method": "exact orthogonal constraints and direct source diagonals; no heuristic snapping",
        "passed": all(
            item["geometryAudit"]["afterViolationCount"] == 0
            for item in imported
        ),
        "circuits": [
            {
                "cellName": item["cellName"],
                **item["geometryAudit"],
            }
            for item in imported
        ],
    }
    with open(audit_path, "w", encoding="utf-8") as handle:
        json.dump(audit, handle, indent=2, ensure_ascii=True)
        handle.write("\n")
    print("ANALOG_CANVAS_HES_FAITHFUL_IMPORT_OK " + RESULT_PATH)
    for item in imported:
        print(
            "  {cellName}: {instances} devices, {nets} nets, "
            "portOccurrences={portOccurrences}, geometry={geometryMode}".format(**item)
        )


if __name__ == "__main__":
    main()
