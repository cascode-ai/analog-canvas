"""Editable starter calculations, using this run's native ASCII outputs only.

No numpy dependency, hidden frontend evaluator, or ngspice subprocess. The
shared icm_reports.py helper reports results; it does not perform the math.
"""
from bisect import bisect_left
from math import isfinite, log10
from pathlib import Path
import sys

from icm_reports import report_measurement, report_plot


def read_ascii(path):
    lines = Path(path).read_text().splitlines()
    begin = lines.index("Variables:") + 1
    end = lines.index("Values:")
    names = [line.split()[1] for line in lines[begin:end]]
    fields = dict(line.split(":", 1) for line in lines[:begin-1] if ":" in line)
    width = int(fields["No. Variables"])
    count = int(fields["No. Points"])
    tokens = " ".join(lines[end+1:]).split()
    if len(names) != width or len(tokens) != count * (width + 1):
        raise ValueError("Incomplete native ASCII record")
    is_complex = "complex" in fields["Flags"]
    vectors = {name: [] for name in names}
    for row in range(count):
        offset = row * (width + 1)
        if int(tokens[offset]) != row:
            raise ValueError("Native point indices are not sequential")
        for name, token in zip(names, tokens[offset+1:offset+1+width]):
            value = complex(*map(float, token.split(","))) if is_complex else float(token)
            if not (isfinite(value.real) and isfinite(value.imag)):
                raise ValueError("Nonfinite native sample")
            vectors[name].append(value)
    return vectors


def sample(axis, values, target):
    """Linear interpolation between returned samples; no endpoint clamping."""
    if not axis or any(b <= a for a, b in zip(axis, axis[1:])):
        raise ValueError("Sample axis must be strictly increasing")
    if target < axis[0] or target > axis[-1]:
        raise ValueError("Measurement target is outside the returned samples")
    right = bisect_left(axis, target)
    if axis[right] == target:
        return values[right]
    left = right - 1
    return values[left] + (values[right] - values[left]) * (
        (target - axis[left]) / (axis[right] - axis[left])
    )


def window_values(axis, values, start, stop):
    window = [v for t, v in zip(axis, values) if start < t < stop]
    return window + [sample(axis, values, start), sample(axis, values, stop)]


def falling_crossing(axis, values, target):
    for i in range(1, len(values)):
        if values[i-1] > target >= values[i]:
            return axis[i-1] + (axis[i] - axis[i-1]) * (
                (target - values[i-1]) / (values[i] - values[i-1]))
    raise ValueError("No falling crossing in the returned samples")


mode = sys.argv[1]
if mode not in ("ac", "step", "rlc", "cs-ac", "cs-tran", "ota-op", "ota-ac", "ota-tran", "ota-closed"):
    raise ValueError("Unknown starter report mode")

if mode in ("ac", "rlc", "cs-ac", "ota-ac", "ota-closed"):
    data = read_ascii("frequency.raw")
    frequency = [v.real for v in data["frequency"]]
    input_name, output_name = ("vinp", "vout") if mode.startswith("ota-") else ("in", "out")
    gain = [out / inp for inp, out in zip(data[input_name], data[output_name])]
    # Preserve the complex transfer. The common Plot UI supplies dB and phase
    # rather than representing already-logarithmic values as complex voltages.
    lines = ["Title: Voltage transfer", "Date: Current run", "Plotname: Gain",
             "Flags: complex", "No. Variables: 2", f"No. Points: {len(gain)}",
             "Variables:", "0 frequency notype", "1 Gain notype", "Values:"]
    for index, (freq, value) in enumerate(zip(frequency, gain)):
        lines.extend([f"{index} {freq:.17e},0", f" {value.real:.17e},{value.imag:.17e}"])
    Path("gain.raw").write_text("\n".join(lines) + "\n")
    report_plot("gain.raw", "ac", axis="frequency",
                probes=[{"name": "Gain", "quantity": "transfer", "unit": "1"}])
    if mode == "ac":
        report_measurement("gain_at_fc", lambda: sample(
            frequency, [20 * log10(abs(v)) for v in gain], 1591.549431), "dB")
    elif mode == "cs-ac":
        report_measurement("gain_db_1khz", lambda: sample(
            frequency, [20 * log10(abs(v)) for v in gain], 1e3), "dB")
    elif mode in ("ota-ac", "ota-closed"):
        db = [20 * log10(abs(v)) for v in gain]
        report_measurement("dc_gain_db" if mode == "ota-ac" else "closed_gain_db",
                           lambda: sample(frequency, db, 1), "dB")
        if mode == "ota-ac":
            report_measurement("unity_gain_hz", lambda: falling_crossing(frequency, db, 0), "Hz")
    else:
        report_measurement("peak_gain_db", lambda: max(20 * log10(abs(v)) for v in gain), "dB")

if mode in ("step", "rlc"):
    data = read_ascii("step.raw")
    if mode == "step":
        report_measurement("at_one_tau", lambda: sample(data["time"], data["out"], 200.05e-6), "V")
    else:
        report_measurement("peak_output", lambda: max(data["out"]), "V")
    report_measurement("final_value", lambda: sample(data["time"], data["out"], 1e-3), "V")

if mode == "cs-tran":
    data = read_ascii("signal.raw")
    # Native outer sweeps concatenate sample groups. Preserve every returned
    # case as an explicit record, with its amplitude in the plot title. The
    # original multi-axis raw file remains available for independent inspection.
    start = 0
    for end in range(1, len(data["amplitude"]) + 1):
        if end < len(data["amplitude"]) and data["amplitude"][end] == data["amplitude"][start]:
            continue
        amplitude = data["amplitude"][start]
        time = data["time"][start:end]
        values = data["out"][start:end]
        index = start
        path = f"signal-{index}.raw"
        lines = [f"Title: Input amplitude {amplitude:g} V", "Date: Current run",
                 f"Plotname: Signal ({amplitude:g} V input)", "Flags: real",
                 "No. Variables: 3", f"No. Points: {len(time)}", "Variables:",
                 "0 time notype", "1 in notype", "2 out notype", "Values:"]
        for i, (t, inp, out) in enumerate(zip(time, data["in"][start:end], values)):
            lines.extend([f"{i} {t:.17e}", f" {inp:.17e}", f" {out:.17e}"])
        Path(path).write_text("\n".join(lines) + "\n")
        report_plot(path, "tran", axis="time", probes=[
            {"name": name, "quantity": "voltage", "unit": "V"} for name in ("in", "out")])
        def peak_to_peak():
            window = [v for t, v in zip(time, values) if 200e-6 < t < 400e-6]
            window.extend(sample(time, values, t) for t in (200e-6, 400e-6))
            return max(window) - min(window)
        report_measurement("output_pp", peak_to_peak, "V")
        start = end

if mode == "ota-op":
    data = read_ascii("bias.raw")
    report_measurement("supply_current", lambda: -data["VDD:flow(br)"][0], "A")

if mode in ("ota-tran", "ota-closed"):
    data = read_ascii("step.raw")
    if mode == "ota-tran":
        report_measurement("output_max", lambda: max(data["vout"]), "V")
        report_measurement("output_min", lambda: min(data["vout"]), "V")
    else:
        report_measurement("output_at_2us", lambda: sample(data["time"], data["vout"], 2e-6), "V")
        report_measurement("output_peak", lambda: max(window_values(data["time"], data["vout"], 1e-6, 3e-6)), "V")
