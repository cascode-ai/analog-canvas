"""Editable RC example calculations, using this run's native ASCII outputs only.

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


if sys.argv[1] == "ac":
    data = read_ascii("frequency.raw")
    frequency = [v.real for v in data["frequency"]]
    gain = [out / inp for inp, out in zip(data["in"], data["out"])]
    # Preserve the complex transfer. The common Plot UI supplies dB and phase
    # rather than representing already-logarithmic values as complex voltages.
    lines = ["Title: RC transfer", "Date: Current run", "Plotname: RC Gain",
             "Flags: complex", "No. Variables: 2", f"No. Points: {len(gain)}",
             "Variables:", "0 frequency notype", "1 Gain notype", "Values:"]
    for index, (freq, value) in enumerate(zip(frequency, gain)):
        lines.extend([f"{index} {freq:.17e},0", f" {value.real:.17e},{value.imag:.17e}"])
    Path("gain.raw").write_text("\n".join(lines) + "\n")
    report_plot("gain.raw", "ac", axis="frequency",
                probes=[{"name": "Gain", "quantity": "transfer", "unit": "1"}])
    report_measurement("gain_at_fc", lambda: sample(
        frequency, [20 * log10(abs(v)) for v in gain], 1591.549431), "dB")
elif sys.argv[1] == "step":
    data = read_ascii("step.raw")
    report_measurement("at_one_tau", lambda: sample(data["time"], data["out"], 200.05e-6), "V")
    report_measurement("final_value", lambda: sample(data["time"], data["out"], 1e-3), "V")
else:
    raise ValueError("Expected the ac or step example analysis")
