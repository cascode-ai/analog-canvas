#!/usr/bin/env python3
"""Exercise the real Canvas exporter and Python preparation, without a GUI."""
import argparse
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canvas-source", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "linux":
        parser.error("Run validation on Linux")
    tools = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(tools))
    node = args.runtime / "node_modules/node/bin/node"

    def run(command, success=True):
        result = subprocess.run([str(item) for item in command], capture_output=True, text=True)
        if (result.returncode == 0) != success:
            raise AssertionError(result.stdout + result.stderr)
        return result

    with tempfile.TemporaryDirectory(prefix="canvas-aether-test-") as temp:
        root = Path(temp)
        examples = args.canvas_source / "apps/editor/src/examples"
        ota = json.loads((examples / "current-mirror-loaded-differential-pair.icproj.json").read_text())
        # The teaching drawing has no model/sizing; supply explicit test parameters.
        for item in ota["documents"][0]["instances"]:
            if item["symbolId"] in ("nmos", "pmos"):
                item["netlist"] = {"binding": {"kind": "model", "deviceClass": "mos", "name": item["symbolId"].upper()},
                                   "parameters": {"w": "1u", "l": "150n"}}
        # An explicit supply interface uses a Port, not the Ground marker.
        ground = next(item for item in ota["documents"][0]["instances"] if item["id"] == "GND1")
        ground["symbolId"] = "port"
        for net in ota["documents"][0]["nets"]:
            for terminal in net["terminals"]:
                if terminal["instanceId"] == "GND1":
                    terminal["pinName"] = "P"
        ota["documents"][0]["netlist"]["terminals"].append({
            "id": "test-input-supply", "netId": "net-contact-gnd1", "name": "VSS",
            "direction": "input", "interfaceInstanceIds": ["GND1"]})
        rlc = json.loads((examples / "simulation-rlc.icproj.json").read_text())
        # This fixture intentionally uses DC; the original pulse variant is a rejection case.
        pulse_text = json.dumps(rlc)
        rlc["documents"][0]["instances"][0]["netlist"]["parameters"] = {"dc": "0", "waveform": "dc", "acMagnitude": "1"}
        public = root / "public.json"
        public.write_text(json.dumps({"format": "analog-canvas-public-gallery-snapshot-v1",
            "consistentCapture": True, "offlineRestoreVerified": True, "origin": "https://example.test",
            "entries": [{"id": name, "name": name, "project_text": text, "svg_text": '<svg xmlns="http://www.w3.org/2000/svg"/>'}
                        for name, text in [("ota", json.dumps(ota)), ("rlc", json.dumps(rlc)), ("pulse", pulse_text)]]}))
        snapshot = root / "snapshot"
        gallery = root / "gallery.mjs"
        binding_tests = root / "bindings.test.mjs"
        run([node, tools / "build.mjs", args.canvas_source, args.runtime,
             tools / "tests/bindings.test.mjs", binding_tests])
        run([node, "--test", binding_tests])
        run([node, tools / "build.mjs", args.canvas_source, args.runtime,
             tools / "snapshot.mjs", gallery])
        run([node, gallery, public, snapshot])
        summary = json.loads((snapshot / "manifest.json").read_text())
        assert all(item["formats"]["spice"]["qualified"] for item in summary["entries"]), summary
        selection = root / "selection.json"
        selection.write_text(json.dumps([["ota", "ota"], ["rlc", "rlc"]]))
        output = root / "bundle"
        command = [sys.executable, tools / "export.py", "--canvas-source", args.canvas_source,
                   "--runtime", args.runtime, "--snapshot", snapshot, "--selection", selection,
                   "--output", output, "--library", "integration_library"]
        run(command)
        spec = json.loads((output / "aether_hes_import_spec.json").read_text())
        assert len(spec["circuits"]) == 2
        by_cell = {c["cellName"]: c for c in spec["circuits"]}
        assert len(by_cell["ota"]["instances"]) == 5
        assert {i["deviceClass"] for i in by_cell["rlc"]["instances"]} == {"resistor", "inductor", "capacitor", "voltage-source"}
        assert by_cell["ota"]["geometryPolicy"]["spacingFactor"] == 1.5
        bulk_labels = by_cell["ota"]["sourceGeometry"]["localBulkLabels"]
        assert bulk_labels and all(label["direction"] == "inout" for label in bulk_labels)
        assert spec["targetSizingAdjustments"] == []
        preflight = json.loads((output / "preflight.json").read_text())
        assert preflight["passed"] and not preflight["pyaetherImportPerformed"]
        expectations = next(row for row in preflight["circuits"] if row["cellName"] == "rlc")["parameters"]
        assert expectations["R1"]["expected"]["R"] == "2E+2"
        assert expectations["L1"]["expected"]["L"] == "0.01"
        assert expectations["C1"]["expected"]["C"] == "1E-7"
        assert (output / "rlc.icproj.json").read_text() == json.dumps(rlc)
        original = (output / "aether_hes_import_spec.json").read_bytes()
        for entry in ("import_one.py", "import_batch.py", "capture.py", "report.py"):
            run([sys.executable, output / entry, "--help"])
        run([sys.executable, tools / "select_circuits.py", "--help"])
        # Exercise the actual Bridge schema/geometry planner, not a stand-in.
        mapping = {"schema": "virtuoso-bridge-process-map-v1", "gridUnit": 0.0625,
            "processes": {"demo": {"outputLibrary": "new_demo", "devices": {
                kind: {"library": "demoPdk", "cell": kind + "4",
                    "pinOffsets": {"D": [4, 3], "G": [0, 0], "S": [4, -3], "B": [4, -1]},
                    "parameterMap": {"w": "w", "l": "l", "nf": "nf", "m": "m"}}
                for kind in ("nmos", "pmos")
            }}}}
        map_file = root / "process-map.json"
        map_file.write_text(json.dumps(mapping))
        virt = root / "virtuoso"
        run([sys.executable, tools / "export.py", "--canvas-source", args.canvas_source,
             "--runtime", args.runtime, "--snapshot", snapshot, "--circuit", "ota:ota",
             "--backend", "virtuoso", "--process-map", map_file, "--process", "demo",
             "--output", virt])
        raw = json.loads((virt / "source.json").read_text())
        adapted = json.loads((virt / "schematic.json").read_text())
        assert adapted["schema"] == "virtuoso-bridge-exact-schematic-v1"
        assert len(adapted["circuits"][0]["instances"]) == 5
        assert all("targetLibrary" not in item for item in raw["circuits"][0]["instances"])
        assert "geometryPolicy" not in raw["circuits"][0]
        assert any(label["direction"] == "input"
                   for label in raw["circuits"][0]["sourceGeometry"]["localBulkLabels"])
        assert all(label["direction"] == "inout"
                   for label in adapted["circuits"][0]["sourceGeometry"]["localBulkLabels"])
        assert not (virt / "aether_hes_import_spec.json").exists()
        assert not json.loads((virt / "preflight.json").read_text())["nativeImportPerformed"]
        from virtuoso import prepare_manifest
        marked = copy.deepcopy(raw)
        marked["circuits"][0]["sourceGeometry"]["internalNetMarkers"] = [{"netName": "VDD"}]
        try:
            prepare_manifest(marked)
        except ValueError as error:
            assert "supply-marker" in str(error)
        else:
            raise AssertionError("unsupported markers silently discarded")
        assert "empty output" in run(command, success=False).stderr
        assert (output / "aether_hes_import_spec.json").read_bytes() == original
        selection.write_text(json.dumps([["pulse", "pulse"]]))
        bad = [root / "pulse-bundle" if item == output else item for item in command]
        assert "waveform pulse" in run(bad, success=False).stderr
        assert not (root / "pulse-bundle/preflight.json").exists()
        print("Integration passed: real Canvas 5-MOS + RLC export, Aether preparation, real Bridge planning, standalone CLI help, source preservation and rejection boundaries; no native import")


if __name__ == "__main__":
    main()
