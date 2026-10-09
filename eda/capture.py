#!/usr/bin/env python3
"""Serial native GUI captures with atomic HTML publication every ten circuits."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
from common import validate_aether_manifest as validate_manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--publish-archive", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, default=10)
    args = parser.parse_args()
    if sys.platform != "linux" or not 1 <= args.batch_size <= 50:
        parser.error("Run on the Linux EDA host with batch size 1..50")
    root = args.root.resolve()
    tools = Path(__file__).resolve().parent
    spec = json.loads((root / "aether_hes_import_spec.json").read_text())
    validate_manifest(spec)
    screenshots = root / "screenshots-full-ui"
    screenshots.mkdir(exist_ok=True)
    command = [sys.executable, str(tools / "report.py"), "--root", str(root),
               "--snapshot", str(args.snapshot), "--screenshots-dir", "screenshots-full-ui", "--progress"]

    def publish():
        # The report requires matching native readback before publishing any images.
        subprocess.run(command, check=True)
        args.publish_archive.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.publish_archive.with_suffix(".tmp")
        with tarfile.open(temporary, "w:gz") as archive:
            for name in ["screenshots-full-ui", "canvas", "comparison.html", "capture-progress.json",
                         "report-layout.json", "sizing-adjustments.json", "execution-status.json"]:
                archive.add(root / name, arcname=name)
        temporary.replace(args.publish_archive)
        progress = json.loads((root / "capture-progress.json").read_text())
        target = args.publish_archive.with_suffix(".json")
        temporary = target.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(progress, indent=2) + "\n")
        temporary.replace(target)
        print("PUBLISHED %d/%d" % (progress["screenshots"], progress["total"]), flush=True)

    publish()
    remaining = [c["cellName"] for c in spec["circuits"] if not (screenshots / (c["cellName"] + ".png")).exists()]
    environment = {**os.environ, "AETHER_LIBRARY": spec["targetLibrary"], "AETHER_CAPTURE_DIR": str(screenshots)}
    for index in range(0, len(remaining), args.batch_size):
        subprocess.run(["bash", str(tools / "aether_screenshot.sh"),
                        *remaining[index:index + args.batch_size]], env=environment, check=True)
        publish()


if __name__ == "__main__":
    main()
