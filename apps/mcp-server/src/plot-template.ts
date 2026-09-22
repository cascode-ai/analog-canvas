/** Embedded in the single-file MCP distribution; only workspace copies are edited. */
export const plotTemplate = String.raw`#!/usr/bin/env python3
"""Editable local simulation plot. Run: python plot.py plot.json
Requires Python 3.10+ and matplotlib. No network or automatic installation.
CSV paths resolve relative to the config. Edit this COPY for computations.
"""
import argparse
import csv
import json
import math
import re
import sys
from pathlib import Path


def unit_info(unit):
    # Case-sensitive SI prefixes; compound noise units keep their dimension.
    if unit in (None, "", "1"):
        return ("dimensionless", 1.0)
    if unit == "deg":
        return ("angle", math.pi / 180)
    if unit == "rad":
        return ("angle", 1.0)
    for base in ("V/sqrt(Hz)", "A/sqrt(Hz)", "Hz", "Ohm", "Ω", "V", "A", "s", "F", "H"):
        if unit.endswith(base):
            prefix = unit[:-len(base)]
            scales = {"": 1, "f": 1e-15, "p": 1e-12, "n": 1e-9,
                      "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3,
                      "k": 1e3, "M": 1e6, "G": 1e9, "T": 1e12}
            if prefix in scales:
                return ("Ohm" if base == "Ω" else base, scales[prefix])
    raise ValueError("Unknown unit: " + str(unit) + "; edit the script for a deliberate override")


def factor(source, target):
    if target is None or source == target:
        return 1.0
    a, b = unit_info(source), unit_info(target)
    if a[0] != b[0]:
        raise ValueError("Incompatible units: " + str(source) + " -> " + target)
    return a[1] / b[1]


def load_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        headers = next(reader)
        if len(set(headers)) != len(headers):
            raise ValueError("Duplicate CSV columns")
        data = {h: [] for h in headers}
        integrated = False
        for line, row in enumerate(reader, 2):
            if not row:
                continue
            if len(row) == 3 and row[0] in ("integrated quantity", "integrated quantity (sampled PSD, trapezoidal)") and row[1:] == ["value", "unit"]:
                integrated = True
                continue
            if integrated:
                if len(row) != 3:
                    raise ValueError(f"CSV row {line}: invalid integrated scalar")
                float(row[1])
                print(f"Integrated scalar (not a curve): {row[0]} = {row[1]} {row[2]}", file=sys.stderr)
                continue
            if len(row) != len(headers):
                raise ValueError(f"CSV row {line}: wrong column count")
            for h, value in zip(headers, row):
                data[h].append(float(value))
    return data


def vector(data, selection):
    name = selection["signal"]
    # Catalog identifiers and the published noise CSV's human-readable headings.
    name = {"outputNoiseDensity": "output noise density",
            "inputNoiseDensity": "input noise density"}.get(name, name)
    component = selection.get("component")
    parsed = {}
    for header in data:
        match = re.fullmatch(r"(.*) \[(.*)\]", header)
        key, unit = match.groups() if match else (header, None)
        parsed[key] = (data[header], unit)
    if component is None:
        if name not in parsed:
            raise ValueError(f"Signal {name!r} not found; complex signals require component")
        values, native = parsed[name]
    else:
        real, native = parsed[f"re({name})"]
        imag, imaginary_unit = parsed[f"im({name})"]
        if imaginary_unit != native:
            raise ValueError("Complex component units differ")
        if component == "real":
            values = real
        elif component == "imag":
            values = imag
        elif component == "magnitude":
            values = [math.hypot(r, i) for r, i in zip(real, imag)]
        elif component == "phase":
            values, native = [math.atan2(i, r) for r, i in zip(real, imag)], "rad"
        else:
            raise ValueError("Unknown complex component: " + component)
    unit = selection.get("unit", native)
    scale = factor(native, unit)
    return [v * scale for v in values], unit


def vector_label(selection):
    name = selection["signal"]
    component = selection.get("component")
    return f"{component}({name})" if component else name


def render(config, directory):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError as error:
        raise RuntimeError("Missing matplotlib; use an existing Python environment with matplotlib") from error
    panels = config["panels"]
    if not panels:
        raise ValueError("At least one panel is required")
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "axes.prop_cycle": plt.cycler(color=["#2769A5", "#D27032", "#32856A", "#8959A6"]),
                         "lines.linewidth": 1.8, "savefig.dpi": 180})
    fig, axes = plt.subplots(len(panels), 1, figsize=(7.2, 3.5 * len(panels)),
                             squeeze=False, layout="constrained")
    cache = {}
    try:
        for ax, panel in zip(axes[:, 0], panels):
            dimensions = None
            labels = None
            for curve in panel["curves"]:
                path = (directory / curve["csv"]).resolve()
                if path not in cache:
                    cache[path] = load_csv(path)
                x, xu = vector(cache[path], curve["x"])
                y, yu = vector(cache[path], curve["y"])
                if dimensions is not None and dimensions != (xu, yu):
                    raise ValueError("Curves in a panel must share display units; use separate panels")
                dimensions = (xu, yu)
                labels = (vector_label(curve["x"]), vector_label(curve["y"]) if len(panel["curves"]) == 1 else "Value")
                if not x or len(x) != len(y):
                    raise ValueError("Empty or mismatched vectors")
                invalid = sum(not math.isfinite(a) or not math.isfinite(b) or
                              (panel.get("xScale") == "log" and a <= 0) or
                              (panel.get("yScale") == "log" and b <= 0) for a, b in zip(x, y))
                if invalid:
                    raise ValueError(f"{invalid} nonfinite/log-invalid points; no points silently discarded")
                ax.plot(x, y, label=curve.get("label", vector_label(curve["y"])))
            if labels is None:
                raise ValueError("Panel has no curves")
            ax.set(xscale=panel.get("xScale", "linear"), yscale=panel.get("yScale", "linear"),
                   title=panel.get("title", ""))
            for key, label, unit in zip(("x", "y"), labels, dimensions):
                getattr(ax, "set_" + key + "label")(panel.get(key + "Label", label) + (f" [{unit}]" if unit else ""))
                if key + "Range" in panel:
                    getattr(ax, "set_" + key + "lim")(panel[key + "Range"])
            ax.grid(True, alpha=0.18)
            if panel.get("legend", True):
                ax.legend(frameon=False)
        fig.suptitle(config.get("title", ""), fontsize=13)
        outputs = []
        for fmt in config.get("formats", ["png"]):
            if fmt not in ("png", "svg", "pdf"):
                raise ValueError("Unsupported output format")
            path = directory / ("figure." + fmt)
            fig.savefig(path)
            outputs.append(str(path))
        return outputs
    finally:
        plt.close(fig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    args = parser.parse_args()
    try:
        config_path = args.config.resolve()
        config = json.loads(config_path.read_text(encoding="utf-8"))
        print(json.dumps({"status": "plotted", "outputs": render(config, config_path.parent)}))
    except (ValueError, KeyError, OSError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
`;
