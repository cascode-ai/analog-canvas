#!/usr/bin/env python3
"""Export Canvas circuits offline. No EDA session or server is contacted.

python eda/export.py --canvas-source /repo/Canvas --runtime /runtime \
  --snapshot /snapshot --circuit gallery-id:ota --backend aether \
  --library demo --output /new-bundle

Use --selection FILE for a list of [id, cell] pairs instead of --circuit.
Virtuoso requires --process-map FILE --process NAME instead of --library.
"""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from aether_parameters import parameter_plan, apply_minimum_dimensions
from aether_geometry import build_layout
from common import read_json, write_json, validate_aether_manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("canvas-source", "runtime", "snapshot", "output"):
        parser.add_argument("--" + name, required=True)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--selection", help="JSON list of [Gallery ID, cell] pairs")
    choice.add_argument("--circuit", action="append", help="Gallery ID:target cell; repeat for multiple circuits")
    parser.add_argument("--backend", choices=["aether", "virtuoso"], default="aether")
    parser.add_argument("--library", help="New Aether library name")
    parser.add_argument("--process-map", help="Virtuoso Bridge process map")
    parser.add_argument("--process", help="Explicit target process in the map")
    parser.add_argument("--spacing-factor", type=float, help="Aether spacing, default 1.5")
    parser.add_argument("--expand-inverters", action="store_true")
    parser.add_argument("--minimum-dimensions", action="store_true")
    args = parser.parse_args()
    if args.backend == "aether":
        if not args.library or args.process_map or args.process:
            parser.error("Aether requires --library, not Virtuoso process options")
        if args.spacing_factor is None:
            args.spacing_factor = 1.5
    elif not args.process_map or not args.process or args.library or args.minimum_dimensions or args.spacing_factor is not None:
        parser.error("Virtuoso requires --process-map and --process; HES library/size/spacing options do not apply")
    tools = Path(__file__).resolve().parent
    output = Path(args.output).resolve()
    if output.name == args.library:
        parser.error("Use different names for the import bundle and native Aether library")
    if output.exists() and any(output.iterdir()):
        parser.error("Choose a new, empty output directory")
    output.mkdir(parents=True, exist_ok=True)
    node = Path(args.runtime) / "node_modules/node/bin/node"
    command = ["--snapshot-export", args.snapshot, "--output", str(output),
               "--library", args.library or "Source",
               "--backend", "aether" if args.backend == "aether" else "source",
               "--spacing-factor", str(args.spacing_factor if args.spacing_factor is not None else 1.5)]
    if args.expand_inverters:
        command.append("--expand-inverters")
    selection = read_json(args.selection) if args.selection else [item.split(":") for item in args.circuit]
    if not isinstance(selection, list) or not selection or any(
        not isinstance(pair, list) or len(pair) != 2 or
        not all(isinstance(value, str) for value in pair) for pair in selection
    ):
        parser.error("Selection must be a nonempty list of [galleryId, cellName] pairs")
    for gallery_id, cell in selection:
        command.extend(["--circuit", gallery_id + ":" + cell])
    with tempfile.TemporaryDirectory(prefix="aether-export-") as temp:
        bundle = Path(temp) / "export.mjs"
        subprocess.run([str(node), str(tools / "build.mjs"), args.canvas_source,
                        args.runtime, str(tools / "export.mjs"), str(bundle)], check=True)
        with (Path(temp) / "summary.json").open("w") as log:
            subprocess.run([str(node), str(bundle), *command], stdout=log, check=True)
        shutil.copy2(Path(temp) / "summary.json", output / "export-summary.json")
    if args.backend == "virtuoso":
        from virtuoso import prepare_manifest, bridge_api, plan_circuit
        api = bridge_api()
        spec = prepare_manifest(read_json(output / "source.json"))
        mapping = api.load_process_map(args.process_map)
        rows = []
        for source in spec["circuits"]:
            prepared, layout = plan_circuit(source, mapping, args.process)
            rows.append({"cellName": source["cellName"], "devices": len(prepared["instances"]),
                         "geometryAudit": layout["geometryAudit"]})
        write_json(output / "schematic.json", spec)
    else:
        rows = prepare_aether(output, args.minimum_dimensions)
    bundle_runtime(tools, output, args.backend)
    write_json(output / "preflight.json", {"passed": True, "backend": args.backend,
        "circuits": rows, "pyaetherImportPerformed": False, "nativeImportPerformed": False})
    print("Preflight passed: %d circuits; no native import" % len(rows))


def prepare_aether(output, minimum_dimensions):
    spec = read_json(output / "aether_hes_import_spec.json")
    validate_aether_manifest(spec)
    if minimum_dimensions:
        apply_minimum_dimensions(spec)
    else:
        spec["targetSizingAdjustments"] = []
    (output / "aether_hes_import_spec.json").write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "sizing-adjustments.json").write_text(json.dumps(spec["targetSizingAdjustments"], indent=2) + "\n", encoding="utf-8")
    rows = []
    for source in spec["circuits"]:
        layout = build_layout(source)
        if layout["geometryAudit"]["afterViolationCount"]:
            raise ValueError("Geometry constraints failed: " + source["cellName"])
        rows.append({"cellName": source["cellName"], "devices": len(source["instances"]),
                     "parameters": {item["reference"]: parameter_plan(item) for item in source["instances"]},
                     "geometryAudit": layout["geometryAudit"],
                     "logicalOnlyPorts": source["sourceGeometry"]["logicalOnlyPorts"]})
    return rows


def bundle_runtime(tools, output, backend):
    for filename in ("common.py", "workflow.py", "import_one.py", "import_batch.py",
                     "aether.py", "aether_geometry.py", "aether_readback.py",
                     "aether_parameters.py", "aether_ports.py", "virtuoso.py",
                     "aether_screenshot.sh", "report.py", "capture.py"):
        shutil.copy2(tools / filename, output / filename)
    if backend == "aether":
        # Preserve the previously documented console launcher in generated bundles.
        (output / "analog-canvas-hes-pyaether-run.py").write_text(
            'import runpy\nfrom pathlib import Path\n'
            'runpy.run_path(str(Path(__file__).resolve().with_name("import_batch.py")), run_name="__main__", '
            'init_globals={"EDA_ARGS": ["--backend", "aether", "--input", str(Path(AETHER_IMPORT_ROOT) / "aether_hes_import_spec.json"), '
            '"--output", AETHER_IMPORT_ROOT, "--library-parent", AETHER_LIBRARY_PARENT]})\n',
            encoding="utf-8")


if __name__ == "__main__":
    if sys.platform != "linux":
        raise SystemExit("Run the preparation and tests on the Linux EDA development machine")
    main()
