#!/usr/bin/env python3
"""Convert a v1 schematic snapshot to Analog Canvas schema 48, offline."""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile
import shutil

from snapshot_checks import validate

ROOT = Path(__file__).resolve().parent
INSTALL_ROOT = ROOT.parents[2]
LOCK_PATH = INSTALL_ROOT / "upstream-lock.json"
if LOCK_PATH.is_file():
    UPSTREAM_LOCK = json.loads(LOCK_PATH.read_text())
    UPSTREAM = INSTALL_ROOT / UPSTREAM_LOCK["checkoutPath"]
else:
    package = INSTALL_ROOT / "package.json"
    if not package.is_file() or json.loads(package.read_text()).get("name") != "analog-canvas":
        raise RuntimeError("Cannot locate Analog Canvas or upstream-lock.json")
    UPSTREAM_LOCK = None
    UPSTREAM = INSTALL_ROOT


def uid(kind, *parts):
    return kind + "-" + hashlib.sha256(json.dumps(parts).encode()).hexdigest()[:16]


def xy(point):
    return {"x": point[0], "y": point[1]}


def orient(p, rotation, mirror):
    x, y = p
    if mirror == "x":
        x = -x
    for _ in range(rotation // 90):
        x, y = -y, x
    return x, y


def on_segment(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == 0 and dy == 0:
        return p == a
    cross = (p[0] - a[0]) * dy - (p[1] - a[1]) * dx
    return (abs(cross) <= 1e-9 * math.hypot(dx, dy) and
            min(a[0], b[0]) - 1e-9 <= p[0] <= max(a[0], b[0]) + 1e-9 and
            min(a[1], b[1]) - 1e-9 <= p[1] <= max(a[1], b[1]) + 1e-9)


def segment_distance_squared(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length_squared = dx * dx + dy * dy
    t = max(0, min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / length_squared)) if length_squared else 0
    q = (a[0] + t * dx, a[1] + t * dy)
    return (p[0]-q[0])**2 + (p[1]-q[1])**2


def simplify(points):
    result = []
    for p in points:
        if result and p == result[-1]:
            continue
        while len(result) >= 2 and on_segment(result[-1], result[-2], p):
            result.pop()
        result.append(p)
    return result


def orthogonal_points(points):
    result = [points[0]]
    for q in points[1:]:
        p = result[-1]
        if p[0] != q[0] and p[1] != q[1]:
            result.append((p[0], q[1]))
        result.append(q)
    return simplify(result)


def terminal_first(start, end, points):
    # Direction determines which end receives the vertical-first escape.
    if start["kind"] == "junction" and end["kind"] == "terminal":
        return end, start, list(reversed(points))
    return start, end, points


def terminal_is_anchor(refs, degree, point, endpoint_positions):
    return len(refs) == 1 and (degree <= 1 or
                               (degree == 2 and endpoint_positions[refs[0]] == point))


def split_source_segments(edges_by_net, nodes_by_net, transform):
    segments = defaultdict(list)
    for name, edges in edges_by_net.items():
        for a, b in edges:
            points = sorted((p for p in nodes_by_net[name] if on_segment(p, a, b)),
                            key=lambda p: (p[0]-a[0])*(b[0]-a[0]) + (p[1]-a[1])*(b[1]-a[1]))
            for p, q in zip(points, points[1:]):
                p, q = transform(p), transform(q)
                if p != q:
                    segments[name].append((p, q))
    return segments


def convert(data, config, upstream, presentation=None):
    validate(data)
    if presentation is None:
        presentation = json.loads((ROOT / "presentation_config.json").read_text())
    if presentation["version"] != 1:
        raise ValueError("Unsupported presentation configuration")
    show_instance_names = presentation.get("showInstanceNames", True)
    if not isinstance(show_instance_names, bool):
        raise ValueError("showInstanceNames must be boolean")
    for key in ("caseSensitive", "plainLabels", "decorateOpenEnds"):
        if not isinstance(presentation[key], bool):
            raise ValueError(f"{key} must be boolean")
    if presentation["bulkVisibility"] not in ("all", "hide-power-ground"):
        raise ValueError("bulkVisibility must be all or hide-power-ground (hide B on configured supply nets)")
    normalize = (lambda s: s) if presentation["caseSensitive"] else str.casefold
    for key in ("powerNets", "groundNets"):
        if not isinstance(presentation[key], list) or any(not isinstance(n, str) or not n for n in presentation[key]):
            raise ValueError(f"{key} must contain nonempty net names")
    powers = {normalize(n) for n in presentation["powerNets"]}
    grounds = {normalize(n) for n in presentation["groundNets"]}
    if powers & grounds:
        raise ValueError("A net cannot be both power and ground")
    domains = {n["id"]: "vdd" if normalize(n["name"]) in powers else
               "ground" if normalize(n["name"]) in grounds else None for n in data["nets"]}
    if config["version"] != 1:
        raise ValueError("Unsupported mapping version")
    grid, scale = config["grid"], config["scale"]
    if grid <= 0 or scale <= 0:
        raise ValueError("Grid and scale must be positive")
    snap = lambda x: round(x / grid) * grid
    project_id = uid("project", data["source"]["library"], data["source"]["cell"])
    doc_id = uid("document", project_id)
    transform = lambda p: (snap(p[0] * scale + 300), snap(-p[1] * scale + 400))
    rules = {r["instanceId"]: r for r in config["rules"]}
    if len(rules) != len(config["rules"]):
        raise ValueError("Duplicate library/cell mapping")
    report = {"source": data["source"], "mapping": config, "warnings": list(data["warnings"]), "information": [],
              "placements": [], "parameterSources": {}, "unconvertedShapes": []}
    report.update(presentation=presentation, hiddenBulkPins=[], endpointMarkers=[], hiddenBulkSegments=[], hiddenBulkLabels=[])
    report["replacedNetLabels"] = []
    if (upstream / ".git").exists():
        report["upstreamCommit"] = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=upstream, text=True).strip()
    else:
        manifest_path = INSTALL_ROOT / "release-manifest.json"
        manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {}
        report["upstreamCommit"] = manifest.get("analogCanvasCommit", "unknown")
    if UPSTREAM_LOCK and report["upstreamCommit"] != UPSTREAM_LOCK["commit"]:
        raise ValueError("Upstream revision differs from upstream-lock.json")
    document = {"id": doc_id, "name": data["source"]["cell"], "revision": 0, "sourceStatus": "in-sync",
                "netlist": {"name": data["source"]["cell"], "terminals": [], "formalParameters": []},
                "instances": [], "nets": [], "connectivityEvidence": [], "routes": [], "junctions": [],
                "annotations": [], "presentation": {"styleProfileId": "razavi-textbook-v1", "grid": grid,
                "compactness": "normal"}, "layoutGroups": [], "constraints": [], "noConnects": [], "drafting": {"objects": []}}
    project = {"schemaVersion": 48, "id": project_id, "name": data["source"]["cell"],
               "source": {"entry": None, "dialect": "none", "sourcePolicy": "copy", "files": []},
               "symbolLibrary": {"id": "razavi-symbols", "version": "1", "hash": "razavi-reference-v1"},
               "structureRevision": 0, "topDocumentId": doc_id, "documents": [document],
               "externalSubcircuitDefinitions": config.get("externalDefinitions", []), "simulationSetups": []}
    net_ids = {n["id"]: uid("net", doc_id, n["id"]) for n in data["nets"]}
    instance_ids = {i["id"]: uid("instance", doc_id, i["id"]) for i in data["instances"]}
    endpoints = defaultdict(lambda: defaultdict(list))
    hidden_bulk = defaultdict(set)
    added_terminals = defaultdict(list)
    endpoint_positions = {}
    pin_map = {}
    target_instances = {}
    port_by_instance = {}
    endpoint_outward = {}
    source_wire_directions = defaultdict(set)
    source_wire_peers = defaultdict(list)
    for shape in data["shapes"]:
        if shape["layer"] != "wire" or shape["type"] not in ("line", "path") or not shape["netId"]:
            continue
        points = [tuple(p) for p in shape["points"]]
        for a, b in zip(points, points[1:]):
            if a == b:
                continue
            direction = ((b[0] > a[0]) - (b[0] < a[0]), (b[1] > a[1]) - (b[1] < a[1]))
            source_wire_directions[(shape["netId"], a)].add(direction)
            source_wire_directions[(shape["netId"], b)].add((-direction[0], -direction[1]))
            if a[1] == b[1]:
                source_wire_peers[(shape["netId"], a)].append(b)
                source_wire_peers[(shape["netId"], b)].append(a)
    port_pin_at = tuple(config["portPinAt"])
    for term in data["terminals"]:
        for pin in term["pins"]:
            if not pin["instanceId"]:
                raise ValueError("Top-level pin without marker instance: " + term["name"])
            if pin["instanceId"] in port_by_instance:
                raise ValueError("Multiple ports share one marker")
            port_by_instance[pin["instanceId"]] = term

    def annotation(id_, kind, binding, object_id, offset, net_id=None):
        origin = target_instances[object_id]["placement"]["position"]
        a = {"id": id_, "kind": kind, "binding": binding,
             "anchor": {"kind": "object", "objectId": object_id, "localOffset": xy(offset),
                        "fallbackPosition": {"x": origin["x"] + offset[0], "y": origin["y"] + offset[1]}},
             "alignment": "start", "rotation": 0, "locked": False}
        if net_id:
            a["netId"] = net_id
        document["annotations"].append(a)

    for inst in data["instances"]:
        rule = rules.get(inst["id"])
        if rule is None:
            raise ValueError(f"No symbol mapping for {inst['library']}/{inst['cell']}")
        asset = config.get("customSymbols", {}).get(rule["symbol"])
        if asset is None:
            asset = config.get("symbolDefinitions", {}).get(rule["symbol"])
        if asset is None:
            raise ValueError("Missing Analog Canvas symbol definition: " + rule["symbol"])
        pins = {p["name"]: (p["at"]["x"], p["at"]["y"]) for p in asset["pins"]}
        variant = next((v for v in asset.get("variants", []) if v["id"] == asset.get("defaultVariantId")), {})
        for pin in variant.get("auxiliaryPins", []):
            at = pin.get("routing", {}).get("preferredLanding", pin["at"])
            pins[pin["name"]] = (at["x"], at["y"])
        identity = instance_ids[inst["id"]]
        source_pins = {}
        for terminal in inst["terminals"]:
            if len(terminal["pins"]) != 1:
                raise ValueError(f"Expected one pin figure for {inst['id']}.{terminal['name']}")
            mapped = rule["pins"].get(terminal["name"])
            if mapped not in pins:
                raise ValueError(f"No target pin for {inst['id']}.{terminal['name']}")
            source_pins[mapped] = transform(terminal["pins"][0]["worldCenter"])
            pin_map[(inst["id"], terminal["name"])] = (identity, mapped)
        if inst["id"] in port_by_instance:
            source_pins["P"] = transform(inst["position"])
        if not source_pins and "externalDefinitionId" not in rule:
            raise ValueError("No anchors: " + inst["id"])
        fit_pins = list(source_pins)
        if rule["symbol"] in ("nmos", "pmos"):
            fit_pins = [p for p in source_pins if p != "B"] or fit_pins
        # Match named terminal directions and centroid over all eight orientations.
        candidates = []
        if not fit_pins:
            candidates.append((0, 0, "none", transform(inst["position"])))
        for rotation in (0, 90, 180, 270):
            for mirror in ("none", "x"):
                # Boxes retain master geometry; do not infer mirror from collinear pins.
                source_orientation = {"R0": (0, "none"), "R90": (270, "none"),
                    "R180": (180, "none"), "R270": (90, "none"),
                    "MX": (180, "x"), "MY": (0, "x"),
                    "MXR90": (90, "x"), "MYR90": (270, "x")}.get(inst.get("orientation"))
                if "externalDefinitionId" in rule and source_orientation and (rotation, mirror) != source_orientation:
                    continue
                if not fit_pins:
                    continue
                offsets = [orient(pins[p], rotation, mirror) for p in fit_pins]
                origin = tuple(snap(sum(source_pins[p][axis] - q[axis] for p, q in zip(fit_pins, offsets)) / len(fit_pins)) for axis in (0, 1))
                error = sum((origin[a] + q[a] - source_pins[p][a]) ** 2 for p, q in zip(fit_pins, offsets) for a in (0, 1))
                candidates.append((error, rotation, mirror, origin))
        fit_error, rotation, mirror, origin = min(candidates)
        if rule["symbol"] in ("voltage-source", "pulse-voltage-source"):
            directions = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}
            for terminal in inst["terminals"]:
                mapped = rule["pins"].get(terminal["name"])
                pin = next((p for p in asset["pins"] if p["name"] == mapped), None)
                if not pin or pin.get("direction") not in directions or mapped not in fit_pins:
                    continue
                outward = orient(directions[pin["direction"]], rotation, mirror)
                source_point = tuple(terminal["pins"][0]["worldCenter"])
                incident = source_wire_directions[(terminal["netId"], source_point)]
                transverse = {(1, 0), (-1, 0)} if outward[1] else {(0, 1), (0, -1)}
                offset = orient(pins[mapped], rotation, mirror)
                if not transverse.issubset(incident) or tuple(origin[a] + offset[a] for a in (0, 1)) != source_pins[mapped]:
                    continue
                shifted = (origin[0] - outward[0] * grid, origin[1] - outward[1] * grid)
                shifted_error = sum((shifted[a] + orient(pins[p], rotation, mirror)[a] - source_pins[p][a]) ** 2
                                    for p in fit_pins for a in (0, 1))
                if shifted_error <= fit_error:
                    origin, fit_error = shifted, shifted_error
                    break
        target = {"id": identity, "symbolId": rule["symbol"], "placement": {
            "position": xy(origin), "rotation": rotation, "mirror": mirror}}
        if rule["symbol"] in ("nmos", "pmos"):
            target["symbolVariantId"] = "textbook-3terminal"
        target_instances[identity] = target
        document["instances"].append(target)
        for p, local in pins.items():
            q = orient(local, rotation, mirror)
            endpoint_positions[(identity, p)] = (origin[0] + q[0], origin[1] + q[1])
        for pin in asset["pins"]:
            direction = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}.get(pin.get("direction"))
            if direction:
                endpoint_outward[(identity, pin["name"])] = orient(direction, rotation, mirror)
        report["placements"].append({"sourceId": inst["id"], "targetId": identity,
                                     "placement": target["placement"], "fitSquaredError": fit_error})
        if inst["id"] in port_by_instance:
            term = port_by_instance[inst["id"]]
            tid = uid("terminal", doc_id, term["id"])
            document["netlist"]["terminals"].append({"id": tid, "name": term["name"],
                "direction": {"input": "input", "output": "output", "inputOutput": "inout"}.get(term["direction"], "passive"),
                "netId": net_ids[term["netId"]], "interfaceInstanceIds": [identity]})
            endpoints[term["netId"]][source_pins["P"]].append((identity, "P"))
            annotation(uid("label", identity), "instance-label", {"kind": "cell-terminal-name", "terminalId": tid}, identity, (-80, -10))
        else:
            target["reference"] = inst["name"]
            parameters = {}
            provenance = {}
            for field in ("effectiveCdfParameters", "properties"):
                for p in inst[field]:
                    name = rule["parameters"].get(p["name"].lower())
                    if name and p["value"] is not None and p["value"] != "":
                        parameters[name] = str(p["value"])
                        provenance[name] = field
            target["netlist"] = {"parameters": parameters}
            if "externalDefinitionId" in rule:
                target["netlist"]["binding"] = {"kind": "external-subcircuit", "definitionId": rule["externalDefinitionId"]}
                connected = {t["name"] for t in inst["terminals"] if t["netId"]}
                report.setdefault("sourceUnconnectedBoxPins", []).extend(
                    {"instanceId": identity, "pinName": p} for p in pins if p not in connected)
                report["warnings"].append(f"{inst['id']}: generic box preserves external pins only; no internal circuit or simulation model")
            elif "deviceClass" in rule:
                target["netlist"]["binding"] = {"kind": "primitive", "deviceClass": rule["deviceClass"]}
            else:
                report["information"].append(f"{inst['id']}: symbol/selected parameters preserved; simulation binding not asserted")
            report["parameterSources"][inst["id"]] = provenance
            annotation(uid("label", identity), "instance-label", {"kind": "instance-reference", "instanceId": identity}, identity, (40, -10))
            if rule["symbol"] == "ground":
                target.pop("reference", None)
                target.pop("netlist", None)
                document["annotations"].pop()
                for terminal in inst["terminals"]:
                    if terminal["netId"]:
                        net = next(n for n in data["nets"] if n["id"] == terminal["netId"])
                        document["connectivityEvidence"].append({"id": uid("claim", identity), "kind": "name-claim",
                            "netId": net_ids[net["id"]], "name": net["name"],
                            "scope": "global" if net["isGlobal"] else "local", "powerDomain": "ground",
                            "owner": {"kind": "power-marker", "objectId": identity}})
            terminal_nets = {rule["pins"].get(t["name"]): t["netId"] for t in inst["terminals"]}
            shared_supply_bulk = (rule["symbol"] in ("nmos", "pmos") and
                                  terminal_nets.get("D") == terminal_nets.get("S") == terminal_nets.get("B") and
                                  domains.get(terminal_nets.get("B")))
            for terminal in inst["terminals"]:
                if terminal["netId"]:
                    mapped = rule["pins"][terminal["name"]]
                    if (rule["symbol"] in ("nmos", "pmos") and mapped == "B" and
                            domains[terminal["netId"]] and
                            (presentation["bulkVisibility"] == "hide-power-ground" or shared_supply_bulk)):
                        hidden_bulk[terminal["netId"]].add(source_pins[mapped])
                        report["hiddenBulkPins"].append({"sourceId": inst["id"], "targetId": identity,
                                                        "pin": mapped, "netId": terminal["netId"]})
                        continue
                    endpoints[terminal["netId"]][source_pins[mapped]].append((identity, mapped))

    # A direct horizontal source wire can be preserved with a short capacitor lead
    # when the other pin is grounded and the required shift stays local.
    source_terminals_at = defaultdict(list)
    for inst in data["instances"]:
        for terminal in inst["terminals"]:
            if terminal["netId"] and len(terminal["pins"]) == 1:
                source_terminals_at[(terminal["netId"], tuple(terminal["pins"][0]["worldCenter"]))].append(
                    (inst["id"], terminal["name"]))
    for inst in data["instances"]:
        rule = rules[inst["id"]]
        if rule["symbol"] != "capacitor":
            continue
        top = next((t for t in inst["terminals"] if rule["pins"].get(t["name"]) == "1"), None)
        bottom = next((t for t in inst["terminals"] if rule["pins"].get(t["name"]) == "2"), None)
        if not top or not bottom or domains.get(bottom["netId"]) != "ground":
            continue
        cap_id = instance_ids[inst["id"]]
        if endpoint_outward.get((cap_id, "1")) != (0, -1):
            continue
        point = tuple(top["pins"][0]["worldCenter"])
        cap_x, cap_y = endpoint_positions[(cap_id, "1")]
        shifts = []
        for peer_point in source_wire_peers[(top["netId"], point)]:
            for peer_id, peer_name in source_terminals_at[(top["netId"], peer_point)]:
                if peer_id == inst["id"]:
                    continue
                peer_ref = pin_map[(peer_id, peer_name)]
                peer_x, peer_y = endpoint_positions[peer_ref]
                outward = endpoint_outward.get(peer_ref)
                if not outward or outward[1] != 0 or (cap_x - peer_x) * outward[0] <= 0:
                    continue
                shift = peer_y + grid - cap_y
                if 0 < shift <= 3 * grid:
                    shifts.append(shift)
        if len(shifts) != 1:
            continue
        shift = shifts[0]
        target_instances[cap_id]["placement"]["position"]["y"] += shift
        for key, position in list(endpoint_positions.items()):
            if key[0] == cap_id:
                endpoint_positions[key] = (position[0], position[1] + shift)
        placement_report = next(p for p in report["placements"] if p["targetId"] == cap_id)
        placement_report["fitSquaredError"] = sum(
            (endpoint_positions[(cap_id, rule["pins"][t["name"]])][axis] -
             transform(t["pins"][0]["worldCenter"])[axis]) ** 2
            for t in inst["terminals"] for axis in (0, 1))

    report["omittedPortInterfaces"] = [dict(t, targetNetId=net_ids.get(t["netId"]))
                                        for t in data.get("omittedPortInterfaces", [])]

    # Build a geometric graph per electrical net. Split at endpoints and same-net
    # junction dots, then collapse degree-two vertices into route bends.
    segments = defaultdict(list)
    source_segments = defaultdict(list)
    source_nodes = defaultdict(set)
    for inst in data["instances"]:
        for terminal in inst["terminals"]:
            if terminal["netId"]:
                source_nodes[terminal["netId"]].update(tuple(p["worldCenter"]) for p in terminal["pins"])
        if inst["id"] in port_by_instance:
            source_nodes[port_by_instance[inst["id"]]["netId"]].add(tuple(inst["position"]))
    # Explicitly omitted terminals use the same conservative leaf pruning as B.
    for attachment in data.get("omittedAttachments", []):
        hidden_bulk[attachment["netId"]].add(transform(attachment["point"]))
        source_nodes[attachment["netId"]].add(tuple(attachment["point"]))
    for shape in data["shapes"]:
        if shape["layer"] == "wire" and shape["type"] in ("line", "path"):
            if not shape["netId"]:
                raise ValueError("Wire without electrical net: " + shape["id"])
            points = [tuple(p) for p in shape["points"]]
            source_nodes[shape["netId"]].update(points)
            for a, b in zip(points, points[1:]):
                if a == b:
                    continue
                source_segments[shape["netId"]].append((a, b))
        elif shape["type"] == "ellipse" and shape["layer"] == "wire" and shape["netId"]:
            a, b = shape["bbox"]
            source_nodes[shape["netId"]].add(((a[0]+b[0])/2, (a[1]+b[1])/2))
        elif shape["type"] not in ("ellipse", "label", "textDisplay"):
            report["unconvertedShapes"].append(shape["id"])
    report["sdbTemplates"] = []
    for inst in data["instances"]:
        rule = rules[inst["id"]]
        if rule["symbol"] not in ("nmos", "pmos"):
            continue
        pins = {rule["pins"].get(t["name"]): t for t in inst["terminals"]}
        if not all(p in pins for p in ("D", "S", "B")):
            continue
        drain, source, bulk = (pins[p] for p in ("D", "S", "B"))
        net_id = drain["netId"]
        if not net_id or source["netId"] != net_id or bulk["netId"] != net_id:
            continue
        d, s, b = (tuple(t["pins"][0]["worldCenter"]) for t in (drain, source, bulk))
        axis = 0 if d[1] == s[1] == b[1] else 1 if d[0] == s[0] == b[0] else None
        if axis is None or not min(d[axis], s[axis]) < b[axis] < max(d[axis], s[axis]):
            continue
        edges = source_segments[net_id]
        def matching_edges(a, z):
            return [edge for edge in edges if edge == (a, z) or edge == (z, a)]
        short_edges = matching_edges(b, s)
        if len(short_edges) != 1 or any(p != b and p != s and on_segment(p, b, s)
                                            for p in source_nodes[net_id]):
            continue
        short_shape = next((shape for shape in data["shapes"] if shape["layer"] == "wire" and
                            shape["netId"] == net_id and shape["type"] in ("line", "path") and
                            len(shape["points"]) == 2 and
                            (tuple(map(tuple, shape["points"])) in ((b, s), (s, b)))), None)
        if not short_shape or any(shape.get("attachedWireId") == short_shape["id"]
                                  for shape in data["shapes"] if shape["type"] == "label"):
            continue
        rail_candidates = []
        for a, z in edges:
            if a[1-axis] != z[1-axis] or a[axis] != d[axis] or z[axis] != s[axis]:
                if a[1-axis] != z[1-axis] or a[axis] != s[axis] or z[axis] != d[axis]:
                    continue
            if a[1-axis] == d[1-axis]:
                continue
            rail = a[1-axis]
            left = tuple(rail if k != axis else d[k] for k in (0, 1))
            right = tuple(rail if k != axis else s[k] for k in (0, 1))
            if matching_edges(d, left) and matching_edges(s, right):
                rail_candidates.append(rail)
        if len(rail_candidates) != 1:
            continue
        join = tuple(rail_candidates[0] if k != axis else b[k] for k in (0, 1))
        contact = endpoint_positions[(instance_ids[inst["id"]], "B")]
        outward = endpoint_outward.get((instance_ids[inst["id"]], "B"))
        target_join = transform(join)
        if not outward or any(outward[k] == 0 and abs(contact[k] - target_join[k]) > grid for k in (0, 1)) or \
                sum((target_join[k] - contact[k]) * outward[k] for k in (0, 1)) <= 0:
            continue
        edges.remove(short_edges[0])
        if not domains[net_id]:
            edges.append((b, join))
            source_nodes[net_id].add(join)
        report["sdbTemplates"].append({"sourceId": inst["id"], "netId": net_id,
                                       "mode": "body-to-rail" if not domains[net_id] else "source-drain-only"})
    # Split in source space before grid snapping, so fractional diagonal taps
    # remain attached. Crossings alone add no node; each net has its own graph.
    segments = split_source_segments(source_segments, source_nodes, transform)
    report["sourceDiagonalSegments"] = sum(a[0] != b[0] and a[1] != b[1] for edges in source_segments.values() for a, b in edges)
    labeled_segments = defaultdict(set)
    wire_shapes = {shape["id"]: shape for shape in data["shapes"]
                   if shape["layer"] == "wire" and shape["type"] in ("line", "path")}
    for shape in data["shapes"]:
        if shape["type"] != "label" or not shape["netId"] or not shape.get("position"):
            continue
        attached = wire_shapes.get(shape.get("attachedWireId"))
        points = [tuple(p) for p in attached["points"]] if attached else []
        edges = list(zip(points, points[1:])) if attached else source_segments[shape["netId"]]
        if edges:
            a, b = min(edges, key=lambda edge: segment_distance_squared(shape["position"], *edge))
            if attached or segment_distance_squared(shape["position"], a, b) <= (3 * grid / scale) ** 2:
                labeled_segments[shape["netId"]].add((transform(a), transform(b)))
    for net in data["nets"]:
        name, nid = net["id"], net_ids[net["id"]]
        terms = [{"instanceId": pin_map[(t["instanceId"], t["pinName"])][0],
                  "pinName": pin_map[(t["instanceId"], t["pinName"])][1]} for t in net["terminals"]]
        terms += [{"instanceId": instance_ids[i], "pinName": "P"} for i, t in port_by_instance.items() if t["netId"] == name]
        document["nets"].append({"id": nid, "terminals": terms})
        segs = segments[name]
        nodes = set(endpoints[name]) | hidden_bulk[name] | {p for seg in segs for p in seg}
        for shape in data["shapes"]:
            if shape["type"] == "ellipse" and shape["layer"] == "wire" and shape["netId"] == name:
                a, b = shape["bbox"]
                nodes.add(transform(((a[0]+b[0])/2, (a[1]+b[1])/2)))
        graph = defaultdict(set)
        for a, b in segs:
            split = sorted(p for p in nodes if on_segment(p, a, b))
            for p, q in zip(split, split[1:]):
                graph[p].add(q)
                graph[q].add(p)
        removed = []
        # Only prune branches that start at a hidden B pin. Shared trunks stop
        # the walk; a component containing no visible pins is entirely hidden.
        for start in sorted(hidden_bulk[name]):
            component, pending = set(), [start]
            while pending:
                p = pending.pop()
                if p in component:
                    continue
                component.add(p)
                pending.extend(graph[p] - component)
            if not any(endpoints[name].get(p) for p in component):
                for p in component:
                    removed.extend((p, q) for q in graph[p] if p < q)
                    graph[p].clear()
                continue
            p = start
            while not endpoints[name].get(p) and len(graph[p]) == 1:
                q = next(iter(graph[p]))
                removed.append((p, q))
                graph[p].remove(q)
                graph[q].remove(p)
                p = q
        report["hiddenBulkSegments"].extend({"netId": name, "from": xy(a), "to": xy(b)} for a,b in removed)
        nodes = {p for p in nodes if graph[p] or endpoints[name].get(p)}
        # A pruned B attachment is not a newly authored open signal end.
        removed_nodes = {p for edge in removed for p in edge}
        free_ends = {p for p in nodes if len(graph[p]) == 1 and not endpoints[name].get(p)
                     and p not in removed_nodes}
        def labeled_open_branch(start):
            previous, current = None, start
            while True:
                if previous is not None and (len(graph[current]) != 2 or endpoints[name].get(current)):
                    return False
                following = graph[current] - ({previous} if previous is not None else set())
                if len(following) != 1:
                    return False
                next_point = next(iter(following))
                if any(on_segment(current, a, b) and on_segment(next_point, a, b)
                       for a, b in labeled_segments[name]):
                    return True
                previous, current = current, next_point
        anchors = {p for p in nodes if len(graph[p]) != 2 or p in endpoints[name]}
        if nodes and not anchors:
            anchors.add(min(nodes))
        node_refs = {}
        positions = {}
        for p in sorted(anchors):
            refs = endpoints[name].get(p, [])
            if terminal_is_anchor(refs, len(graph[p]), p, endpoint_positions):
                # A branch point exactly on its target pin needs no separate
                # junction or zero-length pin-to-junction route.
                i, pin = refs[0]
                node_refs[p] = {"kind": "terminal", "instanceId": i, "pinName": pin}
                positions[p] = endpoint_positions[(i, pin)]
            else:
                jid = uid("junction", nid, p)
                document["junctions"].append({"id": jid, "netId": nid, "position": xy(p),
                                               "role": "branch" if len(graph[p]) + len(refs) > 2 else "route-anchor"})
                node_refs[p] = {"kind": "junction", "junctionId": jid}
                positions[p] = p
        if presentation["decorateOpenEnds"]:
            marked_ends = free_ends if domains[name] else {p for p in free_ends if labeled_open_branch(p)}
            for p in sorted(marked_ends):
                marker_id = uid("end-marker", nid, p)
                domain = domains[name]
                if domain:
                    symbol, pin, local = ("vdd-port", "P", (0, 20)) if domain == "vdd" else ("ground", "0", (0, -10))
                    marker_point = p
                    if domain == "vdd" and len(graph[p]) == 1:
                        neighbor = next(iter(graph[p]))
                        refs = endpoints[name].get(neighbor, [])
                        if len(refs) == 1:
                            peer = refs[0]
                            peer_x, peer_y = endpoint_positions[peer]
                            outward = endpoint_outward.get(peer)
                            if (outward and outward[1] == 0 and peer_y == p[1] and
                                    (p[0] - peer_x) * outward[0] > 0):
                                marker_point = (p[0], p[1] - grid)
                    marker = {"id": marker_id, "symbolId": symbol, "placement": {
                        "position": xy((marker_point[0]-local[0], marker_point[1]-local[1])), "rotation": 0, "mirror": "none"}}
                    document["instances"].append(marker)
                    target_instances[marker_id] = marker
                    positions[p] = marker_point
                    endpoint_positions[(marker_id, pin)] = marker_point
                    reference = {"instanceId": marker_id, "pinName": pin}
                    terms.append(reference)
                    added_terminals[name].append((marker_id, pin))
                    old_jid = node_refs[p]["junctionId"]
                    document["junctions"] = [j for j in document["junctions"] if j["id"] != old_jid]
                    node_refs[p] = {"kind": "terminal", **reference}
                    document["connectivityEvidence"].append({"id": uid("claim", marker_id), "kind": "name-claim",
                        "netId": nid, "name": net["name"], "scope": "global" if net["isGlobal"] else "local",
                        "powerDomain": domain, "owner": {"kind": "power-marker", "objectId": marker_id}})
                else:
                    q = next(iter(graph[p]))
                    rotation = 0 if q[0] > p[0] else 180 if q[0] < p[0] else 90 if q[1] > p[1] else 270
                    offset = orient(port_pin_at, rotation, "none")
                    origin = (p[0]-offset[0], p[1]-offset[1])
                    marker = {"id": marker_id, "symbolId": "port", "placement": {
                        "position": xy(origin), "rotation": rotation, "mirror": "none"}}
                    document["instances"].append(marker)
                    target_instances[marker_id] = marker
                    endpoint_positions[(marker_id, "P")] = p
                    reference = {"instanceId": marker_id, "pinName": "P"}
                    terms.append(reference)
                    added_terminals[name].append((marker_id, "P"))
                    terminal_id = uid("terminal", marker_id)
                    document["netlist"]["terminals"].append({"id": terminal_id, "name": net["name"],
                        "direction": "passive", "netId": nid, "interfaceInstanceIds": [marker_id]})
                    annotation(uid("label", marker_id), "instance-label",
                               {"kind": "cell-terminal-name", "terminalId": terminal_id}, marker_id, (0, 0))
                    old_jid = node_refs[p]["junctionId"]
                    document["junctions"] = [j for j in document["junctions"] if j["id"] != old_jid]
                    node_refs[p] = {"kind": "terminal", **reference}
                report["endpointMarkers"].append({"id": marker_id, "netId": name, "name": net["name"],
                                                   "kind": domain or "port", "at": xy(p)})

        def route(start, end, points, key, preserve=False):
            start, end, points = terminal_first(start, end, points)
            points = simplify(points) if preserve else orthogonal_points(points)
            rid = uid("route", nid, key)
            legs = [{"id": uid("leg", rid, n), "mode": "manual", "to": {
                "kind": "bend", "bendId": uid("bend", rid, n), "position": xy(p)}} for n, p in enumerate(points[1:-1])]
            legs.append({"id": uid("leg", rid, "end"), "mode": "manual", "to": {"kind": "endpoint", "endpoint": end}})
            document["routes"].append({"id": rid, "netId": nid, "start": start, "legs": legs})
            if any(e["kind"] == "terminal" and e["pinName"] == "B" for e in (start, end)):
                document["routes"][-1]["presentation"] = "bulk-dashed"

        visited = set()
        for a in sorted(anchors):
            for b in sorted(graph[a]):
                if frozenset((a, b)) in visited:
                    continue
                path = [a, b]
                visited.add(frozenset((a, b)))
                while path[-1] not in anchors:
                    q = next(q for q in graph[path[-1]] if q != path[-2])
                    visited.add(frozenset((path[-1], q)))
                    path.append(q)
                end = path[-1]
                if any(p[0] != q[0] and p[1] != q[1] for p, q in zip(path, path[1:])):
                    points = [*orthogonal_points([positions[a], a]), *path[1:-1],
                              *orthogonal_points([end, positions[end]])]
                    route(node_refs[a], node_refs[end], points, path, preserve=True)
                else:
                    route(node_refs[a], node_refs[end], [positions[a], *path[1:-1], positions[end]], path)
        for p in sorted(anchors):
            if node_refs[p]["kind"] == "junction":
                for i, pin in endpoints[name].get(p, []):
                    route({"kind": "terminal", "instanceId": i, "pinName": pin}, node_refs[p],
                          [endpoint_positions[(i, pin)], p], [i, pin])
        # A formal cell pin already displays the net name; labels remain for nets without one.
        labels = [s for s in data["shapes"] if s["type"] == "label" and s["netId"] == name]
        has_pin_name = any(t["netId"] == nid for t in document["netlist"]["terminals"])
        if has_pin_name:
            for shape in labels:
                report["replacedNetLabels"].append({"sourceId": shape["id"], "netId": name})
            if net["isGlobal"] and labels:
                shape = labels[0]
                label_id = uid("netlabel", nid, shape["id"])
                document["annotations"].append({"id": label_id, "kind": "net-label", "netId": nid,
                    "binding": {"kind": "net-name", "netId": nid},
                    "anchor": {"kind": "free", "position": xy(transform(shape["position"]))},
                    "alignment": "start", "rotation": 0, "locked": False, "visible": False})
                document["connectivityEvidence"].append({"id": uid("claim", label_id), "kind": "name-claim",
                    "netId": nid, "name": net["name"], "owner": {"kind": "net-label", "annotationId": label_id},
                    "scope": "global"})
        retained_labels = 0
        labels_to_draw = [] if has_pin_name else labels
        for shape in labels_to_draw:
            position = transform(shape["position"])
            removed_distance = min((segment_distance_squared(position,a,b) for a,b in removed), default=float("inf"))
            kept_distance = min((segment_distance_squared(position,a,b) for a in nodes for b in graph[a]), default=float("inf"))
            if removed_distance <= (2*grid)**2 and removed_distance < kept_distance:
                report["hiddenBulkLabels"].append({"sourceId": shape["id"], "netId": name})
                continue
            retained_labels += 1
            label_id = uid("netlabel", nid, shape["id"])
            document["annotations"].append({"id": label_id, "kind": "net-label", "netId": nid,
                "binding": {"kind": "net-name", "netId": nid},
                "anchor": {"kind": "free", "position": xy(transform(shape["position"]))},
                "alignment": "start", "rotation": 0, "locked": False})
            document["connectivityEvidence"].append({"id": uid("claim", label_id), "kind": "name-claim",
                "netId": nid, "name": net["name"], "owner": {"kind": "net-label", "annotationId": label_id},
                "scope": "global" if net["isGlobal"] else "local"})
        if not retained_labels and not any(t["netId"] == name for t in data["terminals"]):
            document["connectivityEvidence"].append({"id": uid("hint", nid), "kind": "net-name-hint",
                "netId": nid, "sourceName": net["name"], "origin": "legacy-explicit-net-property"})
    # Compare complete electrical membership, including formal ports.
    for source_net, target_net in zip(data["nets"], document["nets"]):
        expected = {pin_map[(t["instanceId"], t["pinName"])] for t in source_net["terminals"]}
        expected |= {(instance_ids[i], "P") for i, t in port_by_instance.items() if t["netId"] == source_net["id"]}
        expected |= set(added_terminals[source_net["id"]])
        actual = {(t["instanceId"], t["pinName"]) for t in target_net["terminals"]}
        if expected != actual:
            raise ValueError("Connectivity changed: " + source_net["id"])
    for a in document["annotations"]:
        if a.get("binding", {}).get("kind") == "instance-reference":
            a["visible"] = show_instance_names
    if presentation["plainLabels"]:
        for a in document["annotations"]:
            binding = a["binding"]
            if binding["kind"] == "instance-reference":
                text = target_instances[binding["instanceId"]]["reference"]
            elif binding["kind"] == "cell-terminal-name":
                text = next(t["name"] for t in document["netlist"]["terminals"] if t["id"] == binding["terminalId"])
            else:
                text = next(e["name"] for e in document["connectivityEvidence"] if e["kind"] == "name-claim" and e["owner"] == {"kind": "net-label", "annotationId": a["id"]})
            a["formatOverride"] = {"runs": [{"kind": "text", "value": text}]}
    report["counts"] = {key: len(document[key]) for key in ("instances", "nets", "routes", "junctions", "annotations")}
    report["electricalMembershipVerified"] = True
    report["information"].append("Parameter expressions are preserved; no simulation equivalence claimed.")
    return project, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--mapping", type=Path, default=ROOT / "symbol_mapping.json")
    parser.add_argument("--presentation", type=Path, default=ROOT / "presentation_config.json")
    parser.add_argument("--upstream", type=Path, default=UPSTREAM)
    parser.add_argument("--force", action="store_true", help="Replace existing generated outputs")
    parser.add_argument("--allow-symbol-overlap", action="store_true")
    parser.add_argument("--allow-label-overlap", action="store_true",
                        help="Export with residual label overlaps; other checks remain mandatory")
    args = parser.parse_args()
    if not args.output.name.endswith(".icproj.json"):
        parser.error("Output must end with .icproj.json")
    if args.upstream.resolve() != UPSTREAM.resolve():
        parser.error("Official validation must use the configured Analog Canvas checkout")
    if args.output.exists() and not args.force:
        parser.error("Output exists; use another filename or --force")
    project, report = convert(json.loads(args.input.read_text()), json.loads(args.mapping.read_text()), args.upstream,
                              json.loads(args.presentation.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="canvas-convert-") as directory:
        temp = Path(directory) / args.output.name
        temp.write_text(json.dumps(project, ensure_ascii=False, indent=2) + "\n")

        def fail_with_diagnostics(message):
            failure_dir = Path(tempfile.mkdtemp(prefix=args.output.stem + ".failed-",
                                               dir=args.output.parent))
            for artifact in Path(directory).iterdir():
                if artifact != temp:
                    shutil.copyfile(artifact, failure_dir / artifact.name)
            parser.exit(1, f"{message} Diagnostics: {failure_dir}\nNo final project was written.\n")

        try:
            subprocess.run(["node", str(ROOT / "refine_canvas.mjs"), str(temp),
                            str(report["presentation"].get("boxStubLength", 40))], check=True)
        except subprocess.CalledProcessError:
            fail_with_diagnostics("Conversion refinement or schema validation failed.")
        command = ["node", str(ROOT / "validate_canvas.mjs"), str(temp)]
        source_open = Path(directory) / "source-unconnected-box-pins.json"
        source_open.write_text(json.dumps(report.get("sourceUnconnectedBoxPins", [])))
        command.extend(["--source-unconnected-box-pins", str(source_open)])
        boundary_file = Path(directory) / "source-omitted-port-interfaces.json"
        boundary_file.write_text(json.dumps(report.get("omittedPortInterfaces", [])))
        command.extend(["--source-omitted-port-interfaces", str(boundary_file)])
        if args.allow_label_overlap:
            command.append("--allow-label-overlap")
        if args.allow_symbol_overlap:
            command.append("--allow-symbol-overlap")
        result = subprocess.run(command)
        if result.returncode:
            validation_file = temp.with_name(temp.name.replace(".icproj.json", ".validation.json"))
            if not validation_file.exists():
                validation_file.write_text(json.dumps({
                    "schemaValid": False,
                    "validatorExitCode": result.returncode,
                    "blockingErc": [],
                    "blockingVisual": [],
                }, indent=2) + "\n")
            # Preserve diagnostics without publishing an unchecked project or replacing old outputs.
            fail_with_diagnostics("Conversion validation failed.")
        validation = json.loads(temp.with_name(temp.name.replace(".icproj.json", ".validation.json")).read_text())
        report["validation"] = validation
        refinement = json.loads(temp.with_name(temp.name.replace(".icproj.json", ".refinement.json")).read_text())
        report["routeRefinement"] = {key: refinement[key] for key in ("boxRoutes", "endMarkers", "bulkJoins", "timings")}
        if validation["visual"]:
            print("WARNING: exported with visual observations; review the SVG and validation report.")
        final_document = json.loads(temp.read_text())["documents"][0]
        report["counts"] = {key: len(final_document[key]) for key in report["counts"]}
        temp.with_suffix(".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        artifacts = list(Path(directory).iterdir())
        for artifact in artifacts:
            if (args.output.parent / artifact.name).exists() and not args.force:
                raise FileExistsError(args.output.parent / artifact.name)
        for artifact in artifacts:
            shutil.copyfile(artifact, args.output.parent / artifact.name)
    print(json.dumps(report["counts"]))


if __name__ == "__main__":
    main()
