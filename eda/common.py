"""Small shared contracts and JSON I/O; no EDA imports or connection state."""

import json
from decimal import Decimal
from pathlib import Path

import re

_NUMBER = re.compile(r"^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z\u03a9\u03c9]*)$")
_SCALE = {"": "1", "a": "1e-18", "f": "1e-15", "p": "1e-12", "n": "1e-9", "u": "1e-6",
          "m": "1e-3", "k": "1e3", "meg": "1e6", "g": "1e9", "t": "1e12"}
_UNITS = {"capacitance": {"f"}, "resistance": {"ohm", "ohms", "\u03c9"},
          "inductance": {"h"}, "current": {"a"}, "voltage": {"v"}, "length": {"m"}}
def number(value, bare_unit="m", quantity=None):
    """Parse SPICE scales and optional dimension-checked trailing unit labels."""
    match = _NUMBER.fullmatch(str(value).strip())
    if not match or bare_unit not in ("m", "um") or (quantity and quantity not in _UNITS):
        raise ValueError("Unsupported numeric literal or unit: %r (%s)" % (value, bare_unit))
    suffix = match[2].lower()
    if suffix in _SCALE:
        prefix = suffix
    else:
        prefix = next((p for p in ("meg", "t", "g", "k", "m", "u", "n", "p", "f", "a")
                       if suffix.startswith(p)), "")
        unit = suffix[len(prefix):]
        if unit not in _UNITS.get(quantity, set()):
            raise ValueError("Unsupported %s unit: %r" % (quantity or "numeric", value))
        if match[2].startswith("M") and prefix == "m":
            raise ValueError("Ambiguous M before unit in %r; use m for milli or Meg for mega" % value)
    scale = Decimal("1e-6") if not suffix and bare_unit == "um" else Decimal(_SCALE[prefix])
    return Decimal(match[1]) * scale


def literal(value):
    return str(value.normalize())


def same_number(left, right):
    try:
        a, b = number(left), number(right)
        return abs(a - b) <= max(abs(a), abs(b)) * Decimal("1e-6")
    except ValueError:
        return False


def validate_aether_manifest(spec):
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


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, data):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def select_cells(spec, cell_names=None, *, single=False):
    sources = spec.get("circuits")
    if not isinstance(sources, list) or not sources:
        raise ValueError("Manifest needs a nonempty circuit list")
    names = [source.get("cellName") for source in sources]
    if any(not isinstance(name, str) or not name for name in names) or len(names) != len(set(names)):
        raise ValueError("Manifest needs unique, nonempty cell names")
    requested = list(cell_names or [])
    if len(requested) != len(set(requested)) or set(requested) - set(names):
        raise ValueError("Duplicate or unknown requested cells")
    selected = [source for source in sources if not requested or source["cellName"] in requested]
    if single and len(selected) != 1:
        raise ValueError("Single import requires exactly one circuit; pass --cell")
    return selected
