#!/usr/bin/env python3
"""Serial batch import using import_one; no separate device creation logic.

python import_batch.py --help
Aether console: runpy.run_path("/path/import_batch.py", run_name="__main__",
    init_globals={"EDA_ARGS": ["--backend", "aether", "--input", "/path/spec.json",
        "--library-parent", "/path/libs", "--output", "/path/results"]})
"""

if __name__ == "__main__":
    import runpy
    from pathlib import Path
    runpy.run_path(str(Path(__file__).resolve().with_name("import_one.py")),
        run_name="__main__", init_globals={"EDA_ARGS": globals().get("EDA_ARGS"), "EDA_SINGLE": False})
