"""Editable reports for the twelve Library OTA experiments.

Native source owns the analyses. This file owns explicit numerical calculations,
not a second JSON experiment protocol. Mean/RMS use time-weighted trapezoids;
sampling/window endpoints use linear interpolation, as in the original lab.
"""
from math import log10, sqrt
from pathlib import Path
import sys

from native_report import read_ascii, sample
from icm_reports import report_measurement, report_plot


def window(data, start, stop):
    time, values = data["time"], data["vout"]
    pairs = [(start, sample(time, values, start))]
    pairs += [(t, v) for t, v in zip(time, values) if start < t < stop]
    pairs += [(stop, sample(time, values, stop))]
    return pairs


def statistic(data, kind, start, stop):
    pairs = window(data, start, stop)
    values = [v for _, v in pairs]
    if kind == "pp":
        return max(values) - min(values)
    power = 2 if kind == "rms" else 1
    integral = sum((t1 - t0) * (v0**power + v1**power) / 2
                   for (t0, v0), (t1, v1) in zip(pairs, pairs[1:]))
    mean = integral / (stop - start)
    return sqrt(mean) if power == 2 else mean


def write_plot(path, analysis, axis, values, probes, complex_data=False):
    # The axis is a column, not a probe. A dict preserves the authored order.
    names = list(values)
    count = len(next(iter(values.values())))
    lines = ["Title: Library OTA derived result", "Date: Current run",
             f"Plotname: {analysis} derived", "Flags: complex" if complex_data else "Flags: real",
             f"No. Variables: {len(names)}", f"No. Points: {count}", "Variables:"]
    lines += [f"{i} {name} notype" for i, name in enumerate(names)]
    lines += ["Values:"]
    for row in range(count):
        for col, name in enumerate(names):
            value = values[name][row]
            token = f"{value.real:.17e},{value.imag:.17e}" if complex_data else f"{value:.17e}"
            lines.append((f"{row} " if col == 0 else " ") + token)
    Path(path).write_text("\n".join(lines) + "\n")
    axis_spec = {"name": axis, "quantity": "voltage", "unit": "V"} if analysis == "dc" else axis
    report_plot(path, analysis, axis=axis_spec, probes=probes)


mode = sys.argv[1].removeprefix("simulation-setup-ota-")
full = mode == "full-tt"
if mode == "op-ac":
    # Historical four-analysis acceptance has no scalar/derived requests.
    sys.exit(0)

if full or mode == "bias-tt":
    data = read_ascii("bias.raw")
    report_measurement("measure-vout-op", lambda: data["vout"][0], "V")
    if not full:
        report_measurement("measure-supply-current-op", lambda: -data["VDD:flow(br)"][0], "A")

if full or mode == "dc-transfer-tt":
    data = read_ascii("transfer.raw")
    output = data["vout"]
    report_measurement("measure-dc-min" if full else "measure-vout-min", lambda: min(output), "V")
    if not full:
        report_measurement("measure-vout-max", lambda: max(output), "V")
        report_measurement("measure-vout-pp", lambda: max(output) - min(output), "V")
        report_measurement("measure-vout-at-balance", lambda: sample(data["vinp"], output, 0.9), "V")

if full or mode.startswith("ac-"):
    data = read_ascii("frequency.raw")
    frequency = [v.real for v in data["frequency"]]
    gain = [out / inp for inp, out in zip(data["vinp"], data["vout"])]
    db = [20 * log10(abs(v)) for v in gain]
    write_plot("gain.raw", "ac", "frequency", {"frequency": frequency, "Gain": gain},
               [{"name": "Gain", "quantity": "transfer", "unit": "1"}], True)
    report_measurement("measure-ac-gain-1k" if full else f"measure-gain-1k-{mode[-2:]}",
                       lambda: sample(frequency, db, 1e3), "dB")
    if not full:
        report_measurement(f"measure-gain-max-{mode[-2:]}", lambda: max(db), "dB")

if full or mode in ("tran-tt", "tran-sin-tt"):
    data = read_ascii("signal.raw")
    stop = 4e-6 if full else 5e-6 if mode == "tran-sin-tt" else 6e-6
    prefix = "measure-tran-" if full else "measure-vout-"
    for kind in (["pp", "rms"] if mode == "tran-sin-tt" else ["pp", "mean", "rms"]):
        report_measurement(prefix + kind, lambda kind=kind: statistic(data, kind, 1e-6, stop), "V")

if full or mode == "noise-tt":
    data = read_ascii("spectrum.raw")
    frequency = data["frequency"]
    output = [sqrt(v) for v in data["onoise"]]
    report_measurement("measure-noise-1k" if full else "measure-output-noise-1k",
                       lambda: sample(frequency, output, 1e3), "V/sqrt(Hz)")
    if not full:
        input_density = [sqrt(v / gain) for v, gain in zip(data["onoise"], data["gain"])]
        report_measurement("measure-input-noise-1k", lambda: sample(frequency, input_density, 1e3), "V/sqrt(Hz)")

# Sign-converted supply current is an explicit derived trace, never a renamed
# negative native current. Native raw records remain available as evidence.
if full or mode == "bias-tt":
    for path, analysis, axis in [("bias.raw", "op", "op"), ("transfer.raw", "dc", "VINP"),
                                 ("frequency.raw", "ac", "frequency"), ("signal.raw", "tran", "time")]:
        if not Path(path).exists():
            continue
        data = read_ascii(path)
        # Native OP/DC independent-variable names come from the raw record.
        if analysis == "dc":
            axis = next(iter(data))
        elif analysis == "op":
            axis = None
        values = {axis: data[axis]} if axis else {}
        values["I_supply"] = [-v for v in data["VDD:flow(br)"]]
        write_plot(f"supply-{analysis}.raw", analysis, axis,
                   values,
                   [{"name": "I_supply", "quantity": "current", "unit": "A"}], analysis == "ac")
