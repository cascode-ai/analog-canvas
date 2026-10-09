"""Read back and verify the geometry-faithful HES library through PyAether."""

import json
import os
import sys
import runpy
from collections import Counter

sys.path.insert(0, globals().get("AETHER_TOOLS_ROOT", os.path.dirname(globals().get("__file__", ""))))
from analog_canvas_hes_parameters import parameter_plan, read_parameters, check_parameters
from analog_canvas_hes_contract import validate_manifest
from analog_canvas_hes_ports import graphical_port_readback

import pyAether as ae


ROOT = globals()["AETHER_IMPORT_ROOT"]
SPEC = globals().get("AETHER_VERIFY_SPEC", os.path.join(ROOT, "aether_hes_import_spec.json"))
OUTPUT = globals().get("AETHER_VERIFY_OUTPUT", os.path.join(ROOT, "aether_hes_readback.json"))

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


def object_name(value):
    for attribute in (
        "name",
        "getName",
        "_emyNet__getName",
        "_emyTerm__getName",
        "_emyInst__getName",
        "_emyInstTerm__getName",
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


def term_net_name(term):
    for attribute in ("getNet", "_emyTerm__getNet", "_emyInstTerm__getNet"):
        if not hasattr(term, attribute):
            continue
        try:
            return object_name(getattr(term, attribute)())
        except Exception:
            pass
    return None


def term_direction(term):
    for attribute in ("direction", "_emyTerm__getDirection"):
        if not hasattr(term, attribute):
            continue
        try:
            value = getattr(term, attribute)
            return str(value() if callable(value) else value)
        except Exception:
            pass
    return None


def master_term_name(inst_term):
    if hasattr(inst_term, "getTermName"):
        try:
            name = inst_term.getTermName()
            if name is not None:
                return str(name)
        except Exception:
            pass
    for attribute in ("getTerm", "_emyInstTerm__getTerm"):
        if hasattr(inst_term, attribute):
            try:
                return object_name(getattr(inst_term, attribute)())
            except Exception:
                pass
    return object_name(inst_term)


ae.emyInitTcl()
ae.emyInitDb()
with open(SPEC, "r", encoding="utf-8") as handle:
    spec = json.load(handle)
validate_manifest(spec)
library = spec["targetLibrary"]
helpers = runpy.run_path(os.path.join(globals().get("AETHER_TOOLS_ROOT", os.path.dirname(__file__)), "analog-canvas-hes-pyaether-import.py"))


def wire_key(net, start, end):
    return (net, *sorted((tuple(start), tuple(end))))

rows = []
for source in spec["circuits"]:
    layout = helpers["build_layout"](source)
    cv = ae.dbOpenCV(library, source["cellName"], "schematic", "r")
    block = cv.getTopBlock()
    instances = list(block.getInsts())
    nets = list(block.getNets())
    terms = list(block.getTerms())
    instance_names = sorted(filter(None, (object_name(item) for item in instances)))
    net_names = sorted(filter(None, (object_name(item) for item in nets)))
    term_map = {
        object_name(term): term_net_name(term)
        for term in terms
        if object_name(term) is not None
    }
    term_directions = {
        object_name(term): term_direction(term)
        for term in terms
        if object_name(term) is not None
    }
    expected_instances = sorted(item["reference"] for item in source["instances"])
    expected_nets = sorted(source["nets"])
    expected_terms = {item["name"]: item["netName"] for item in source["ports"]}
    expected_directions = {
        item["name"]: "inputOutput" for item in source["ports"]
    }
    expected_pin_count = len(source["sourceGeometry"]["portOccurrences"]) + len(
        source["sourceGeometry"].get("localBulkLabels", [])
    )
    expected_instance_terms = {
        item["reference"]: {
            node["pinName"]: node["netName"] for node in item["nodes"]
        }
        for item in source["instances"]
    }
    expected_orientations = layout["orientations"]
    expected_instance_set = set(expected_instances)
    device_instances = sorted(
        name for name in instance_names if name in expected_instance_set
    )
    pin_instances = sorted(
        name for name in instance_names if name not in expected_instance_set
    )

    actual_instance_terms = {}
    actual_orientations = {}
    actual_parameters = {}
    parameter_mismatches = {}
    placement_mismatches = {}
    source_by_ref = {item["reference"]: item for item in source["instances"]}
    for instance in instances:
        name = object_name(instance)
        if name not in expected_instance_set:
            continue
        actual_orientations[name] = str(instance.getOrient())
        position = (instance.dbuTransform.xOffset(), instance.dbuTransform.yOffset())
        if tuple(layout["placements"][name]) != position:
            placement_mismatches[name] = {"expected": layout["placements"][name], "actual": position}
        if spec["schema"] == "analog-canvas-hes-pyaether-import-v8":
            expected = parameter_plan(source_by_ref[name])["expected"]
            actual_parameters[name] = read_parameters(ae, instance, expected)
            mismatch = check_parameters(actual_parameters[name], expected)
            if mismatch:
                parameter_mismatches[name] = mismatch
        actual_instance_terms[name] = {
            master_term_name(inst_term): term_net_name(inst_term)
            for inst_term in list(instance.getInstTerms())
            if master_term_name(inst_term) is not None
        }
    instance_term_mismatches = {}
    for reference, expected in expected_instance_terms.items():
        actual = actual_instance_terms.get(reference, {})
        actual_relevant = {name: actual.get(name) for name in expected}
        if actual_relevant != expected:
            instance_term_mismatches[reference] = {
                "expected": expected,
                "actual": actual_relevant,
            }
    orientation_mismatches = {
        reference: {
            "expected": expected,
            "actual": actual_orientations.get(reference),
        }
        for reference, expected in expected_orientations.items()
        if actual_orientations.get(reference) != expected
    }

    expected_wires = Counter(wire_key(*segment) for segment in helpers["planned_wire_segments"](layout))
    port_readback = graphical_port_readback(terms, layout, object_name, term_net_name, helpers["pin_orientation"])
    actual_wires = Counter()
    expected_markers = Counter((item["netName"], item["netName"], tuple(item["xy"]))
                               for item in layout.get("internalNetMarkers", []))
    actual_markers = Counter()
    for shape in block.getShapes():
        if type(shape).__name__ == "emyText" and shape.getNet() is not None:
            point = shape.dbuOrigin
            actual_markers[(object_name(shape.getNet()), str(shape.text), tuple(point))] += 1
        if type(shape).__name__ != "emyLine":
            continue
        points = shape.dbuPoints
        for start, end in zip(points, points[1:]):
            actual_wires[wire_key(object_name(shape.getNet()), start, end)] += 1

    row = {
        "cellName": source["cellName"],
        "deviceInstances": device_instances,
        "pinInstances": pin_instances,
        "nets": net_names,
        "termToNet": term_map,
        "termDirections": term_directions,
        "expectedPortOccurrences": expected_pin_count,
        "instanceTermMismatches": instance_term_mismatches,
        "orientationMismatches": orientation_mismatches,
        "parameters": actual_parameters,
        "parameterMismatches": parameter_mismatches,
        "placementMismatches": placement_mismatches,
        "graphicalPortReadback": port_readback,
        "allGraphicalPortsMatch": port_readback["passed"],
        "allInstancePositionsMatch": not placement_mismatches and port_readback["passed"],
        "allWireSegmentsMatch": expected_wires == actual_wires,
        "allInternalNetMarkersMatch": expected_markers == actual_markers,
        "missingWireSegments": [[key, count] for key, count in (expected_wires - actual_wires).items()],
        "unexpectedWireSegments": [[key, count] for key, count in (actual_wires - expected_wires).items()],
        "allParametersMatch": not parameter_mismatches and (
            spec["schema"] != "analog-canvas-hes-pyaether-import-v8"
            or len(actual_parameters) == len(expected_instances)
        ),
        "deviceInstanceCountMatches": len(device_instances) == len(expected_instances),
        "deviceInstanceNamesMatch": device_instances == expected_instances,
        "pinInstanceCountMatches": len(pin_instances) == expected_pin_count,
        "pinInstancesAreAetherGenerated": all(
            name.startswith("PIN") for name in pin_instances
        ),
        "netNamesMatch": net_names == expected_nets,
        "termToNetMatches": term_map == expected_terms,
        "allTermsAreInout": term_directions == expected_directions,
        "allDeviceTermNetsMatch": not instance_term_mismatches,
        "allInstanceOrientationsMatch": not orientation_mismatches and port_readback["passed"],
    }
    row["passed"] = all(
        row[key]
        for key in (
            "deviceInstanceCountMatches",
            "deviceInstanceNamesMatch",
            "pinInstanceCountMatches",
            "pinInstancesAreAetherGenerated",
            "netNamesMatch",
            "termToNetMatches",
            "allTermsAreInout",
            "allDeviceTermNetsMatch",
            "allInstanceOrientationsMatch",
            "allParametersMatch",
            "allInstancePositionsMatch",
            "allWireSegmentsMatch",
            "allInternalNetMarkersMatch",
            "allGraphicalPortsMatch",
        )
    )
    rows.append(row)
    cv.close()

result = {
    "schema": "analog-canvas-hes-pyaether-readback-v4",
    "library": library,
    "method": "PyAether saved database readback: device terminals, directions, orientations and CDF parameters",
    "passed": all(item["passed"] for item in rows),
    "circuits": rows,
}
with open(OUTPUT, "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2, ensure_ascii=True)
    handle.write("\n")
print(
    "ANALOG_CANVAS_HES_READBACK_%s %s"
    % ("OK" if result["passed"] else "FAILED", OUTPUT)
)
if not result["passed"]:
    raise ValueError("Aether saved database verification failed; see " + OUTPUT)
