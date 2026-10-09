"""Virtuoso adapter: reuse virtuoso-bridge-lite, never duplicate SKILL or SSH.

The bridge must expose schematic.manifest (exact-coordinate import API).
Connection settings are explicit and separate from source and process-map data.
"""
import copy
from pathlib import Path

from common import number, same_number


def bridge_api():
    try:
        from virtuoso_bridge.virtuoso.schematic import manifest
    except ImportError as error:
        raise RuntimeError("Install virtuoso-bridge-lite with schematic.manifest support in this environment") from error
    return manifest


def prepare_manifest(source):
    """Adapt the Canvas source projection, without applying HES size policies."""
    if source.get("schema") != "analog-canvas-eda-source-v1":
        raise ValueError("Expected a Canvas source projection, not an HES target manifest")
    result = copy.deepcopy(source)
    result["schema"] = "virtuoso-bridge-exact-schematic-v1"
    for circuit in result["circuits"]:
        geometry = circuit["sourceGeometry"]
        # Bridge's current native interface/check contract uses bidirectional pins.
        # Keep the original direction as metadata, separate from that target policy.
        for port in circuit["ports"] + geometry["portOccurrences"] + geometry.get("localBulkLabels", []):
            port.setdefault("sourceDirection", port["direction"])
            port["direction"] = "inout"
        if geometry.get("internalNetMarkers"):
            raise ValueError(circuit["cellName"] + ": Bridge does not yet preserve internal supply-marker geometry")
        ports = {port["occurrenceId"] for port in geometry["portOccurrences"]}

        def endpoint(point):
            if point.get("kind") == "terminal":
                point["kind"] = "port" if point["instanceId"] in ports else "instance"

        for route in geometry["routes"]:
            endpoint(route["start"])
            for step in route["steps"]:
                endpoint(step)
        for contact in geometry["contacts"]:
            for point in contact["endpoints"]:
                endpoint(point)
        for item in circuit["instances"]:
            if item.get("sourceExpandedFrom"):
                raise ValueError(circuit["cellName"] +
                    ": Bridge cannot yet resolve shared endpoints of expanded inverters")
            if item["deviceClass"] == "mos":
                unit = item.get("sourceLengthUnit")
                if unit not in ("m", "um"):
                    raise ValueError("MOS needs an explicit sourceLengthUnit")
                item["originalSourceParameters"] = dict(item["sourceParameters"])
                for name in ("w", "l"):
                    value = number(item["sourceParameters"][name], unit, "length")
                    if not value.is_finite() or value <= 0:
                        raise ValueError("MOS dimensions must be positive finite literals")
                    # Explicit scientific SI prevents Bridge's bare-number micrometre rule.
                    item["sourceParameters"][name] = format(value, "E")
                item["sourceLengthUnit"] = "m"
    return bridge_api().load_schematic_manifest(result)


def plan_circuit(source, process_map, process):
    """Reject dropped parameters and implicit resizing before any native work."""
    config = process_map["processes"][process]
    devices = dict(process_map.get("sharedDevices") or {})
    devices.update(config.get("devices") if isinstance(config.get("devices"), dict) else {
        key: value for key, value in config.items()
        if isinstance(value, dict) and "library" in value and "cell" in value})
    for item in source["instances"]:
        key = item["kind"] if item["deviceClass"] == "mos" else item["deviceClass"]
        if key not in devices:
            raise ValueError(item["reference"] + ": missing process-map device " + key)
        device = devices[key]
        params = {key: value for key, value in item.get("sourceParameters", {}).items()
                  if value not in (None, "")}
        mapping = device.get("parameterMap", {})
        missing = set(params) - set(mapping)
        if missing:
            raise ValueError(item["reference"] + ": unmapped source parameters " + ", ".join(sorted(missing)))
        overrides = device.get("parameterOverrides", {})
        for key in params.keys() & overrides.keys():
            # Bridge interprets bare w/l overrides as micrometres, not SI.
            if key in ("w", "l") and str(params[key]) != str(overrides[key]):
                raise ValueError(item["reference"] + ": dimension override must exactly match source " + key)
            if str(params[key]) != str(overrides[key]) and not same_number(params[key], overrides[key]):
                raise ValueError(item["reference"] + ": process map changes source parameter " + key)
        targets = [mapping[key] for key in set(params) | set(overrides) if key in mapping]
        if len(targets) != len(set(targets)):
            raise ValueError(item["reference"] + ": colliding target parameter names")
    return bridge_api().plan_manifest_circuit(source, process_map, process)


class Virtuoso:
    name = "virtuoso"

    def __init__(self, manifest, process_map, process, *, client=None, env_file=None, profile=None):
        self.api = bridge_api()
        self.manifest = self.api.load_schematic_manifest(manifest)
        self.process_map = self.api.load_process_map(process_map)
        if process not in self.process_map["processes"]:
            raise ValueError("Unknown process: " + process)
        self.process = process
        self.library = self.process_map["processes"][process]["outputLibrary"]
        self.client = client
        self.env_file = Path(env_file).resolve() if env_file is not None else None
        self.profile = profile
        self.emit = lambda phase, cell, **details: None
        self._ready = False
        if client is None and (self.env_file is None or not self.env_file.is_file()):
            raise ValueError("Provide an explicit Bridge environment file or an existing client")

    def preflight(self, source):
        if source not in self.manifest["circuits"]:
            raise ValueError("Circuit is not part of the validated manifest")
        plan_circuit(source, self.process_map, self.process)

    def open(self):
        if self.client is None:
            from virtuoso_bridge import VirtuosoClient
            from virtuoso_bridge.env import set_runtime_env_file
            set_runtime_env_file(str(self.env_file))
            self.client = VirtuosoClient.from_env(profile=self.profile)
        self.api.validate_process_master_offsets(self.client, self.process_map, [self.process])
        self._ready = True

    def import_one(self, source):
        if not self._ready:
            raise RuntimeError("Open and audit the target session before importing")
        # Keep the bridge's staged check/readback/rollback transaction intact.
        _, result = self.api.import_manifest_circuit(
            self.client, source, self.process_map, self.process,
            verify=True, overwrite=False)
        return result

    def verify_one(self, source, result):
        # import_manifest_circuit already verifies the installed cell. Do not
        # replace its adjusted layout with a fresh, unadjusted geometry plan.
        if result.get("cellName") != source["cellName"] or result.get("library") != self.library:
            raise ValueError("Bridge returned a different import target")
        verification = result.get("verification")
        if not isinstance(verification, dict) or verification.get("passed") is not True:
            raise ValueError("Bridge did not verify the installed cell")
        return verification
