#!/usr/bin/env python3
"""Build and preflight an import bundle on the Linux EDA development machine."""

import argparse
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile

from analog_canvas_hes_parameters import parameter_plan, apply_minimum_dimensions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("canvas-source", "runtime", "snapshot", "selection", "output", "library"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--spacing-factor", type=float, default=1.5)
    parser.add_argument("--expand-inverters", action="store_true")
    parser.add_argument("--minimum-dimensions", action="store_true")
    args = parser.parse_args()
    tools = Path(__file__).resolve().parent
    output = Path(args.output).resolve()
    if output.name == args.library:
        parser.error("Use different names for the import bundle and native Aether library")
    if output.exists() and any(output.iterdir()):
        parser.error("Choose a new, empty output directory")
    output.mkdir(parents=True, exist_ok=True)
    node = Path(args.runtime) / "node_modules/node/bin/node"
    command = ["--snapshot-export", args.snapshot, "--output", str(output),
               "--library", args.library, "--spacing-factor", str(args.spacing_factor)]
    if args.expand_inverters:
        command.append("--expand-inverters")
    with open(args.selection, encoding="utf-8") as handle:
        selection = json.load(handle)
    if not isinstance(selection, list) or not selection:
        parser.error("Selection must be a nonempty list of [galleryId, cellName] pairs")
    for gallery_id, cell in selection:
        command.extend(["--circuit", gallery_id + ":" + cell])
    with tempfile.TemporaryDirectory(prefix="aether-export-") as temp:
        bundle = Path(temp) / "export.mjs"
        subprocess.run([str(node), str(tools / "analog-canvas-hes-export-build.mjs"), args.canvas_source,
                        args.runtime, str(tools / "analog-canvas-hes-export.mjs"), str(bundle)], check=True)
        with (Path(temp) / "summary.json").open("w") as log:
            subprocess.run([str(node), str(bundle), *command], stdout=log, check=True)
        shutil.copy2(Path(temp) / "summary.json", output / "export-summary.json")
    spec = json.loads((output / "aether_hes_import_spec.json").read_text(encoding="utf-8"))
    if args.minimum_dimensions:
        apply_minimum_dimensions(spec)
    else:
        spec["targetSizingAdjustments"] = []
    (output / "aether_hes_import_spec.json").write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "sizing-adjustments.json").write_text(json.dumps(spec["targetSizingAdjustments"], indent=2) + "\n", encoding="utf-8")
    importer = runpy.run_path(str(tools / "analog-canvas-hes-pyaether-import.py"))
    rows = []
    for source in spec["circuits"]:
        layout = importer["build_layout"](source)
        if layout["geometryAudit"]["afterViolationCount"]:
            raise ValueError("Geometry constraints failed: " + source["cellName"])
        rows.append({"cellName": source["cellName"], "devices": len(source["instances"]),
                     "parameters": {item["reference"]: parameter_plan(item) for item in source["instances"]},
                     "geometryAudit": layout["geometryAudit"],
                     "logicalOnlyPorts": source["sourceGeometry"]["logicalOnlyPorts"]})
    for filename in ("analog_canvas_hes_parameters.py", "analog-canvas-hes-pyaether-import.py",
                     "analog_canvas_hes_contract.py",
                     "analog_canvas_hes_ports.py",
                     "analog-canvas-hes-pyaether-verify.py", "analog-canvas-hes-pyaether-run.py",
                     "analog-canvas-aether-screenshot.sh", "analog-canvas-hes-comparison.py",
                     "analog-canvas-aether-capture-batch.py", "README.md"):
        shutil.copy2(tools / filename, output / filename)
    (output / "preflight.json").write_text(json.dumps({"passed": True, "library": args.library,
        "spacingFactor": args.spacing_factor, "expandedInverters": args.expand_inverters,
        "minimumDimensions": args.minimum_dimensions,
        "circuits": rows, "pyaetherImportPerformed": False}, indent=2) + "\n")
    print("Preflight passed: %d circuits, %d devices" % (len(rows), sum(row["devices"] for row in rows)))


if __name__ == "__main__":
    if sys.platform != "linux":
        raise SystemExit("Run the preparation and tests on the Linux EDA development machine")
    main()
