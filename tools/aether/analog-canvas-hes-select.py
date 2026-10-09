#!/usr/bin/env python3
"""Select component-rich Canvas circuits using the existing strict HES converter."""
import argparse
from collections import Counter, deque
import csv
import json
from pathlib import Path
import re
import runpy
import shutil
import subprocess
import sys
import tempfile

from analog_canvas_hes_parameters import parameter_plan, apply_minimum_dimensions


def source_transistor_count(circuit):
    # Count drawn transistor instances, not fingers, multiplicity or expanded logic.
    return sum(item["deviceClass"] == "mos" and not item.get("sourceExpandedFrom")
               for item in circuit["instances"])


def target_cell_name(gallery_id):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", gallery_id):
        raise ValueError("Invalid Gallery ID")
    return "c_" + gallery_id.replace("-", "_")


def source_instance_count(circuit):
    expanded = {item["sourceExpandedFrom"] for item in circuit["instances"]
                if item.get("sourceExpandedFrom")}
    return sum(not item.get("sourceExpandedFrom") for item in circuit["instances"]) + len(expanded)


def choose_diverse(rows, limit):
    buckets = [[], [], [], []]
    for row in sorted(rows, key=lambda row: (row["sourceInstances"], row["galleryId"])):
        count = row["sourceInstances"]
        buckets[0 if count <= 20 else 1 if count <= 40 else 2 if count <= 80 else 3].append(row)
    queues = [deque(bucket) for bucket in buckets]
    selected = []
    while len(selected) < limit and any(queues):
        for queue in queues:
            if queue and len(selected) < limit:
                selected.append(queue.popleft())
    return selected


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("canvas-source", "runtime", "snapshot", "output", "library"):
        parser.add_argument("--" + name, type=Path if name != "library" else str, required=True)
    parser.add_argument("--target", type=int, default=200)
    parser.add_argument("--more-than", type=int, default=10)
    parser.add_argument("--expand-inverters", action="store_true")
    parser.add_argument("--minimum-dimensions", action="store_true")
    args = parser.parse_args()
    if args.target < 1 or args.more_than < 0:
        parser.error("Require a positive target and nonnegative component-instance threshold")
    if args.output.exists() and any(args.output.iterdir()):
        parser.error("Choose a new output directory; existing selections are not overwritten")
    args.output.mkdir(parents=True, exist_ok=True)
    tools = Path(__file__).resolve().parent
    entries = json.loads((args.snapshot / "manifest.json").read_text())["entries"]
    qualified = [entry for entry in entries if entry.get("formats", {}).get("spice", {}).get("qualified")]
    node = args.runtime / "node_modules/node/bin/node"
    importer = runpy.run_path(str(tools / "analog-canvas-hes-pyaether-import.py"))
    rows = []
    with tempfile.TemporaryDirectory(prefix="candidate-scan-", dir=args.output) as temp:
        temp = Path(temp)
        bundle = temp / "export.mjs"
        subprocess.run([str(node), str(tools / "analog-canvas-hes-export-build.mjs"),
                        str(args.canvas_source), str(args.runtime), str(tools / "analog-canvas-hes-export.mjs"),
                        str(bundle)], check=True)
        converted = temp / "converted"
        command = [str(node), str(bundle), "--snapshot-export", str(args.snapshot), "--output", str(converted),
                   "--library", args.library, "--spacing-factor", "1.5", "--skip-unsupported"]
        if args.expand_inverters:
            command.append("--expand-inverters")
        for entry in qualified:
            command.extend(["--circuit", entry["id"] + ":" + target_cell_name(entry["id"])])
        print("Checking %d qualified SPICE entries with the strict converter" % len(qualified), flush=True)
        with (args.output / "conversion-scan.json").open("w") as log:
            result = subprocess.run(command, stdout=log, check=False)
            if result.returncode:
                raise RuntimeError("Strict converter failed with exit code %d" % result.returncode)
        spec = json.loads((converted / "aether_hes_import_spec.json").read_text())
        by_id = {item["galleryId"]: item for item in spec["circuits"]}
        print("Converted %d; checking source instance counts, geometry and parameters" % len(by_id), flush=True)
        for index, circuit in enumerate(spec["circuits"], 1):
            row = {"galleryId": circuit["galleryId"], "name": circuit["galleryName"],
                   "cellName": circuit["cellName"], "url": circuit["galleryUrl"],
                   "sourceInstances": source_instance_count(circuit),
                   "sourceTransistors": source_transistor_count(circuit),
                   "targetDevices": len(circuit["instances"]),
                   "expandedMos": sum(bool(item.get("sourceExpandedFrom")) for item in circuit["instances"])}
            if row["sourceInstances"] <= args.more_than:
                row.update(status="excluded", reason="source_instance_threshold")
            else:
                try:
                    if args.minimum_dimensions:
                        apply_minimum_dimensions({"circuits": [circuit]})
                    for item in circuit["instances"]:
                        parameter_plan(item)
                    layout = importer["build_layout"](circuit)
                    if layout["geometryAudit"]["afterViolationCount"]:
                        raise ValueError("Geometry constraints failed")
                    row.update(status="preflight_passed", geometryAudit=layout["geometryAudit"])
                except Exception as error:
                    row.update(status="preflight_failed", reason=str(error))
            rows.append(row)
            if index % 50 == 0:
                print("Checked %d/%d converted entries" % (index, len(by_id)), flush=True)
        eligible = [row for row in rows if row["status"] == "preflight_passed"]
        selected = choose_diverse(eligible, args.target)
        spec["circuits"] = [by_id[row["galleryId"]] for row in selected]
        if args.minimum_dimensions:
            apply_minimum_dimensions(spec)
        spec["rejected"] = []
        write_json(args.output / "aether_hes_import_spec.json", spec)
        for row in selected:
            for suffix in ("spi", "icproj.json", "gallery.json"):
                filename = row["cellName"] + "." + suffix
                shutil.copy2(converted / filename, args.output / filename)
        write_json(args.output / "selection.json", [[row["galleryId"], row["cellName"]] for row in selected])
        write_json(args.output / "selected-circuits.json", selected)
        write_json(args.output / "candidate-audit.json", {"converted": rows, "conversionRejected": json.loads(
            (args.output / "conversion-scan.json").read_text())["rejected"]})
        summary = {"sourceSnapshotDirectory": str(args.snapshot), "publicEntries": len(entries),
                   "qualifiedSpice": len(qualified), "converted": len(by_id),
                   "convertedAboveThreshold": sum(row["sourceInstances"] > args.more_than for row in rows),
                   "eligible": len(eligible), "selected": len(selected), "target": args.target,
                   "targetMet": len(selected) == args.target, "strictlyMoreThan": args.more_than,
                   "expandedInverters": args.expand_inverters, "minimumDimensions": args.minimum_dimensions,
                   "minimumSelectedInstances": min((row["sourceInstances"] for row in selected), default=None),
                   "maximumSelectedInstances": max((row["sourceInstances"] for row in selected), default=None),
                   "statusCounts": dict(Counter(row["status"] for row in rows)),
                   "amplifierPrimitives": "Rejected by the converter allowlist; transistor-built amplifiers allowed",
                   "countRule": "Original electrical component instances, including passives and sources; ports, wires, labels, nf, m and expansion-added MOS do not increase count",
                   "selectionRule": "Round robin by 11-20, 21-40, 41-80, 81+ component-instance bands; stable source-ID tie break",
                   "pyaetherImportPerformed": False, "nativeAetherNetlistExportVerified": False,
                   "simulationPerformed": False}
        write_json(args.output / "selection-summary.json", summary)
        with (args.output / "selected-circuits.csv").open("w", encoding="utf-8-sig", newline="") as handle:
            fields = ["galleryId", "name", "sourceInstances", "sourceTransistors", "targetDevices", "expandedMos", "cellName", "url"]
            writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(selected)
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    if sys.platform != "linux":
        raise SystemExit("Run selection and preflight on the Linux EDA development machine")
    main()
