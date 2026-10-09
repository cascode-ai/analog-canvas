#!/usr/bin/env python3
"""Import and verify one circuit. CLI: python import_one.py --help.

Aether console: runpy.run_path("/path/import_one.py", run_name="__main__",
    init_globals={"EDA_ARGS": ["--backend", "aether", "--input", "/path/spec.json",
        "--library-parent", "/path/libs", "--output", "/path/results",
        "--cell", "ota"]})
"""


def import_one(backend, source, emit):
    """Same single-circuit operation for CLI and batch; never selects or retries."""
    cell = source["cellName"]
    emit("cell-start", cell)
    result = backend.import_one(source)
    emit("cell-saved", cell, result=result)
    verification = backend.verify_one(source, result)
    emit("cell-readback", cell, verification=verification)
    if verification.get("passed") is not True:
        raise ValueError("Saved circuit verification failed: " + cell)
    emit("cell-complete", cell)
    return result, verification


if __name__ == "__main__":
    import runpy
    import sys
    from pathlib import Path
    root = Path(__file__).resolve().parent
    # The long-lived EDA console may have imported an older bundle already.
    # Temporarily isolate only our modules; never reload the native PyAether API.
    names = {"common", "workflow", "import_one", "aether", "aether_geometry",
             "aether_parameters", "aether_ports", "aether_readback", "virtuoso"}
    previous = {name: sys.modules[name] for name in names if name in sys.modules}
    original_path = list(sys.path)
    try:
        for name in names:
            sys.modules.pop(name, None)
        sys.path.insert(0, str(root))
        workflow = runpy.run_path(str(root / "workflow.py"))
        workflow["main"](globals().get("EDA_ARGS"), single=globals().get("EDA_SINGLE", True))
    finally:
        for name in names:
            sys.modules.pop(name, None)
        sys.modules.update(previous)
        sys.path[:] = original_path
