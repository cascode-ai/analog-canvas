"""Backend-independent serial orchestration and CLI wiring.

Target sessions belong to adapters. There are no SSH commands, PDK rules or
schematic edits here. Unknown native outcomes are recorded, never auto-retried.
"""
import argparse
import datetime
import json
from pathlib import Path

from common import read_json, write_json, select_cells, validate_aether_manifest
from import_one import import_one


def run_batch(sources, backend, output):
    sources = list(sources)
    select_cells({"circuits": sources})
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    previous = [name for name in (
        "execution-status.json", "import-journal.jsonl", "import-result.json",
        "aether_hes_import_result.json", "aether_hes_readback.json",
        "aether_hes_geometry_audit.json",
    ) if (root / name).exists()]
    if previous:
        raise FileExistsError("Existing execution evidence must be preserved: " + ", ".join(previous))
    # A failed or interrupted attempt must be inspected, not silently overwritten.
    with (root / "import-attempt.json").open("x", encoding="utf-8") as handle:
        json.dump({"backend": backend.name, "cells": [s["cellName"] for s in sources]}, handle)
    state = {"backend": backend.name, "phase": "preflight", "passed": False,
             "expectedCircuitCount": len(sources), "saved": [], "verified": [],
             "failures": [], "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    write_json(root / "execution-status.json", state)

    def emit(phase, cell=None, **details):
        state.update(phase=phase, cellName=cell)
        if phase == "cell-saved":
            state["saved"].append(details["result"])
        if phase == "cell-readback":
            state["verified"].append({"cellName": cell, **details["verification"]})
        with (root / "import-journal.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"phase": phase, "cellName": cell, **details}) + "\n")
            handle.flush()
        write_json(root / "execution-status.json", state)

    backend.emit = emit
    try:
        for source in sources:
            backend.preflight(source)
        emit("opening-target")
        backend.open()
        for source in sources:
            import_one(backend, source, emit)
        state.update(phase="complete", passed=True, cellName=None)
    except BaseException as error:
        state["failures"].append({"cellName": state.get("cellName"),
                                  "phase": state["phase"], "error": str(error)})
        state.update(phase="failed", passed=False)
        raise
    finally:
        state["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        write_json(root / "execution-status.json", state)
        write_json(root / "import-result.json", state)
        if backend.name == "aether":
            _write_aether_reports(root, backend.library, state)
    return state


def _write_aether_reports(root, library, state):
    """Keep the existing screenshot/report artifact contract, including failures."""
    complete = not state["failures"] and len(state["saved"]) == state["expectedCircuitCount"]
    write_json(root / "aether_hes_import_result.json", {
        "schema": "analog-canvas-hes-pyaether-result-v8", "library": library,
        "technology": "hes", "expectedCircuitCount": state["expectedCircuitCount"],
        "savedCircuitCount": len(state["saved"]), "importComplete": complete,
        "readbackVerified": state["passed"], "circuits": state["saved"],
        "failures": state["failures"]})
    write_json(root / "aether_hes_readback.json", {
        "schema": "analog-canvas-hes-pyaether-readback-v4", "library": library,
        "passed": state["passed"], "circuits": state["verified"]})
    write_json(root / "aether_hes_geometry_audit.json", {
        "schema": "analog-canvas-hes-geometry-audit-v1", "library": library,
        "passed": complete and all(not r["geometryAudit"]["afterViolationCount"] for r in state["saved"]),
        "circuits": [{"cellName": r["cellName"], **r["geometryAudit"]} for r in state["saved"]]})


def main(argv=None, *, single=False):
    parser = argparse.ArgumentParser(description="Import one circuit" if single else "Import circuits serially")
    parser.add_argument("--backend", choices=["aether", "virtuoso"], required=True)
    parser.add_argument("--input", type=Path, required=True, help="Prepared target manifest JSON")
    parser.add_argument("--output", type=Path, required=True, help="Bundle or result directory with no previous import attempt")
    parser.add_argument("--cell", action="append", help="Exact cell name; repeat only for batch")
    parser.add_argument("--library-parent", type=Path, help="Aether native-library parent, not bundle directory")
    parser.add_argument("--process-map", type=Path, help="Virtuoso Bridge process map")
    parser.add_argument("--process", help="One explicit process from the process map")
    parser.add_argument("--env", type=Path, help="Explicit Virtuoso Bridge connection environment")
    parser.add_argument("--profile", help="Virtuoso Bridge server/session profile")
    args = parser.parse_args(argv)
    spec = read_json(args.input)
    sources = select_cells(spec, args.cell, single=single)
    if args.backend == "aether":
        if args.library_parent is None or any([args.process_map, args.process, args.env, args.profile]):
            parser.error("Aether requires --library-parent; Virtuoso connection/process options do not apply")
        validate_aether_manifest(spec)
        try:
            import pyAether
        except ImportError:
            parser.error("Run this command in the existing Aether Python Console with EDA_ARGS")
        from aether import Aether
        backend = Aether(pyAether, spec["targetLibrary"], args.library_parent)
    else:
        if not args.process_map or not args.process or not args.env or args.library_parent:
            parser.error("Virtuoso requires --process-map, --process and --env; no --library-parent")
        from virtuoso import Virtuoso
        backend = Virtuoso(spec, read_json(args.process_map), args.process,
                           env_file=args.env, profile=args.profile)
    result = run_batch(sources, backend, args.output)
    print(json.dumps({"passed": result["passed"], "circuits": len(result["verified"]),
                      "output": str(args.output)}, indent=2))
