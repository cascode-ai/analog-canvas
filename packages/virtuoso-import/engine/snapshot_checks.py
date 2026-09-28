"""Offline compatibility validator. No Virtuoso process or network client."""
def validate(data):
    if data.get("schemaVersion") != 1 or data.get("format") != "analog-agent.schematic":
        raise ValueError("Unsupported intermediate format")
    instances = {i["id"]: i for i in data["instances"]}
    nets = {n["id"]: n for n in data["nets"]}
    if len(instances) != len(data["instances"]) or len(nets) != len(data["nets"]):
        raise ValueError("Duplicate IDs")
    expected = {(t["netId"], i["id"], t["name"]) for i in instances.values()
                for t in i["terminals"] if t["netId"] is not None}
    actual = {(n["id"], t["instanceId"], t["pinName"]) for n in nets.values() for t in n["terminals"]}
    if expected != actual:
        raise ValueError("Asymmetric connectivity")
    for obj in data["shapes"] + data["terminals"]:
        if obj["netId"] is not None and obj["netId"] not in nets:
            raise ValueError("Dangling net reference")
    shapes = {shape["id"]: shape for shape in data["shapes"]}
    for label in data["shapes"]:
        wire_id = label.get("attachedWireId")
        if wire_id is None:
            continue
        wire = shapes.get(wire_id)
        if (label["type"] != "label" or not wire or wire.get("type") not in ("line", "path")
                or wire.get("layer") != "wire" or wire.get("netId") != label["netId"]
                or len(wire.get("points") or []) < 2):
            raise ValueError("Invalid attached wire reference: " + label["id"])
