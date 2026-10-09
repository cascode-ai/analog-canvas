"""Validate filesystem/native identifiers before opening any target library."""

import re


def validate_manifest(spec):
    if spec.get("schema") != "analog-canvas-hes-pyaether-import-v8" or spec.get("targetTechnology") != "hes":
        raise ValueError("Expected an HES v8 import manifest")
    names = [spec.get("targetLibrary")]
    circuits = spec.get("circuits")
    if not isinstance(circuits, list) or not circuits:
        raise ValueError("Expected a nonempty circuit list")
    cells = [item.get("cellName") for item in circuits]
    names.extend(cells)
    if any(not isinstance(name, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) for name in names):
        raise ValueError("Invalid native library or cell identifier")
    if len(set(cells)) != len(cells):
        raise ValueError("Duplicate target cell names")
    for item in circuits:
        gallery_id = item.get("galleryId")
        if not isinstance(gallery_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", gallery_id):
            raise ValueError("Invalid Gallery ID")
