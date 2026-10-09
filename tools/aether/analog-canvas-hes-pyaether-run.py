"""Run once from the existing Aether Python console; never start a second GUI.

import runpy
runpy.run_path('/path/to/analog-canvas-hes-pyaether-run.py', init_globals={
    'AETHER_IMPORT_ROOT': '/path/to/my_import_bundle',
    'AETHER_LIBRARY_PARENT': '/path/to/native_libraries',
})

The library is read from the manifest. Re-running cannot overwrite an old cell.
"""

import datetime
import json
import os
import runpy
import traceback
import sys
import importlib

ROOT = globals()["AETHER_IMPORT_ROOT"]
PARENT = globals()["AETHER_LIBRARY_PARENT"]
TOOLS = os.path.dirname(__file__)
sys.path.insert(0, TOOLS)
import analog_canvas_hes_parameters
importlib.reload(analog_canvas_hes_parameters)
from analog_canvas_hes_contract import validate_manifest
with open(os.path.join(ROOT, "aether_hes_import_spec.json"), encoding="utf-8") as handle:
    spec = json.load(handle)
validate_manifest(spec)
context = {"AETHER_IMPORT_ROOT": ROOT, "AETHER_IMPORT_LIBRARY": spec["targetLibrary"],
           "AETHER_TOOLS_ROOT": TOOLS, "AETHER_LIBRARY_PARENT": PARENT}
status = {"library": spec["targetLibrary"], "startedAt": datetime.datetime.now().isoformat(),
          "phase": "starting", "passed": False}


def save_status():
    path = os.path.join(ROOT, "execution-status.json")
    with open(path + ".tmp", "w") as handle:
        json.dump(status, handle, indent=2)
    os.replace(path + ".tmp", path)


try:
    for phase, filename in [("import", "analog-canvas-hes-pyaether-import.py"),
                            ("readback", "analog-canvas-hes-pyaether-verify.py")]:
        status["phase"] = phase
        save_status()
        runpy.run_path(os.path.join(TOOLS, filename), init_globals=context, run_name="__main__")
    status.update(phase="complete", passed=True)
except Exception:
    status.update(phase="failed", error=traceback.format_exc())
    raise
finally:
    status["finishedAt"] = datetime.datetime.now().isoformat()
    save_status()
