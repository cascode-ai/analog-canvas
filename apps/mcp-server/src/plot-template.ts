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
    for base in ("V/sqrt(Hz)", "A/sqrt(Hz)", "Hz", "Ohm", "Ω", "V", "A", "s", "F", "H", "W", "S"):
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
    db = selection.get("decibels")
    if db is not None:
        if selection.get("unit") not in (None, "dB"):
            raise ValueError("A decibel projection has unit dB; referenceUnit specifies the physical reference")
        multiplier = db["factor"]
        reference = db["reference"] * factor(db["referenceUnit"], native)
        if multiplier not in (10, 20) or not math.isfinite(reference) or reference <= 0:
            raise ValueError("Decibels require factor 10/20 and a finite positive reference")
        amplitudes = [abs(v) if multiplier == 20 else v for v in values]
        if any(not math.isfinite(v) or v <= 0 for v in amplitudes):
            raise ValueError("Decibels require finite nonzero amplitude or positive power; no silent clipping")
        return [multiplier * math.log10(v / reference) for v in amplitudes], "dB"
    unit = selection.get("unit", native)
    scale = factor(native, unit)
    return [v * scale for v in values], unit


def vector_label(selection):
    name = selection["signal"]
    component = selection.get("component")
    label = f"{component}({name})" if component else name
    if selection.get("decibels"):
        db = selection["decibels"]
        label += f" / {db['reference']:g} {db['referenceUnit']}"
    return label


def cursor_sample(x, y, target, logarithmic=False):
    """Old GUI semantics: a real nearest sample, never an interpolated crossing."""
    if not math.isfinite(target) or target < min(x) or target > max(x):
        raise ValueError("Cursor is outside the sampled domain; no endpoint clamping")
    if logarithmic and target <= 0:
        raise ValueError("Logarithmic cursor must be positive")
    index = min(range(len(x)), key=lambda i: abs(math.log(x[i] / target)) if logarithmic else abs(x[i] - target))
    return {"requestedX": target, "x": x[index], "y": y[index], "sampleIndex": index}


def cursor_readings(x, y, config, x_unit, y_unit, logarithmic=False):
    scale = factor(config.get("unit", x_unit), x_unit)
    points = {name: cursor_sample(x, y, config[name] * scale, logarithmic)
              for name in ("A", "B") if name in config}
    report = {"method": "nearest-sample-log-x" if logarithmic else "nearest-sample",
              "xUnit": x_unit, "yUnit": y_unit, "points": points}
    if "A" in points and "B" in points:
        report["delta"] = {"x": points["B"]["x"] - points["A"]["x"],
                           "y": points["B"]["y"] - points["A"]["y"]}
    return report


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
    cursor_reports = []
    try:
        for panel_index, (ax, panel) in enumerate(zip(axes[:, 0], panels)):
            dimensions = None
            labels = None
            marker_lines = set()
            marker_headers = set()
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
                label = curve.get("label", vector_label(curve["y"]))
                line, = ax.plot(x, y, label=label)
                if panel.get("cursors"):
                    readings = cursor_readings(x, y, panel["cursors"], xu, yu, panel.get("xScale") == "log")
                    cursor_reports.append({"panel": panel_index, "label": label,
                                           "csv": str(path), "x": curve["x"], "y": curve["y"], **readings})
                    for name, point in readings["points"].items():
                        ax.scatter([point["x"]], [point["y"]], color=line.get_color(), s=22, zorder=4)
                        ax.annotate(f"{name}: {point['y']:.4g}", (point["x"], point["y"]),
                                    xytext=(5, -14 if name == "A" else -26), textcoords="offset points",
                                    fontsize=8, color=line.get_color(), bbox={"facecolor":"white", "edgecolor":"none", "alpha":0.7, "pad":1})
                        if (name, point["x"]) not in marker_lines:
                            marker_lines.add((name, point["x"]))
                            ax.axvline(point["x"], color="#64748b", linewidth=0.8, linestyle="--", alpha=0.65)
                        if name not in marker_headers:
                            marker_headers.add(name)
                            ax.text(0.02 if name == "A" else 0.55, 1.02,
                                    f"{name} target: {point['requestedX']:.4g} {xu or ''} (nearest sample)",
                                    transform=ax.transAxes, fontsize=8, va="bottom", color="#475569")
            if labels is None:
                raise ValueError("Panel has no curves")
            ax.set(xscale=panel.get("xScale", "linear"), yscale=panel.get("yScale", "linear"))
            ax.set_title(panel.get("title", ""), pad=28 if panel.get("cursors") else 6)
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
        report_path = directory / "cursors.json"
        report_path.write_text(json.dumps({"cursors": cursor_reports}, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        outputs.append(str(report_path))
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
