"""HES-specific CDF writes, bounds and readback expectations."""

from decimal import Decimal
from common import number, literal, same_number

HES_MIN_CHANNEL_LENGTH = Decimal("130e-9")
HES_MAX_CHANNEL_LENGTH = Decimal("20e-6")
HES_MIN_FINGER_WIDTH = Decimal("150e-9")
HES_MAX_FINGER_WIDTH = Decimal("50e-6")
SIZING_POLICY = "hes-out-of-range-to-minimum-v2"


def parameter_plan(item):
    """Return ordered callback writes and independent numeric expectations."""
    ref = item["reference"]
    source = item["sourceParameters"]
    kind = item["deviceClass"]
    if item.get("sourceExpandedFrom") and item.get("expansionProfile") != "cmos-inverter-w1u-l150n-v1":
        raise ValueError("%s: implicit subcircuit expansion is not supported" % ref)

    def positive(name, default=None, unit="m", integer=False, quantity=None):
        raw = source.get(name, default)
        if raw is None:
            raise ValueError("%s: missing source parameter %s" % (ref, name))
        value = number(raw, unit, quantity)
        if value <= 0 or (integer and value != value.to_integral_value()):
            raise ValueError("%s: invalid %s=%s" % (ref, name, raw))
        return literal(value)

    if kind == "mos":
        allowed = {"w", "l", "nf", "m"}
        unit = item.get("sourceLengthUnit")
        if unit not in ("m", "um"):
            raise ValueError("%s: explicit sourceLengthUnit required" % ref)
        w, length = positive("w", unit=unit, quantity="length"), positive("l", unit=unit, quantity="length")
        nf, mult = positive("nf", "1", integer=True), positive("m", "1", integer=True)
        adjustment = item.get("targetSizingAdjustment")
        if minimum_dimension_adjustment(item) and not adjustment:
            raise ValueError("%s: HES dimensions out of range; explicitly enable --minimum-dimensions" % ref)
        if adjustment:
            if adjustment != minimum_dimension_adjustment(item):
                raise ValueError("%s: inconsistent minimum-dimension adjustment" % ref)
            length = adjustment.get("targetL", length)
            w = adjustment.get("targetW", w)
        # Source w is total width; HES simW is fw and simM is m*fingers.
        expected = {"w": w, "l": length, "fingers": nf, "m": mult,
                    "fw": literal(number(w) / number(nf))}
        writes = [("calcParam", "FingerWidth"), ("fingers", nf), ("w", w), ("l", length), ("m", mult)]
    elif kind == "capacitor":
        allowed = {"value"}
        if (item.get("targetLibrary", "analog"), item.get("targetCell", "cap")) != ("analog", "cap"):
            raise ValueError("%s: an ideal capacitance requires analog/cap; physical cap_mim sizing is not verified" % ref)
        expected = {"C": positive("value", quantity="capacitance"), "M": "1"}
        writes = list(expected.items())
    elif kind == "resistor":
        allowed = {"value"}
        expected = {"R": positive("value", quantity="resistance"), "M": "1"}
        writes = list(expected.items())
    elif kind == "inductor":
        allowed = {"value"}
        expected = {"L": positive("value", quantity="inductance"), "M": "1"}
        writes = list(expected.items())
    elif kind in ("current-source", "voltage-source"):
        allowed = {"dc", "waveform", "amplitude", "damping", "delay", "fall", "frequency",
                   "high", "low", "offset", "period", "phase", "rise", "width",
                   "acMagnitude", "acPhase"}
        if source.get("waveform", "dc") != "dc":
            raise ValueError("%s: native DC source only supports DC" % ref)
        quantity = "current" if kind == "current-source" else "voltage"
        expected = {"DC": literal(number(source["dc"], quantity=quantity))}
        if "acMagnitude" in source:
            ac = number(source["acMagnitude"], quantity=quantity)
            if ac < 0:
                raise ValueError("%s: negative AC magnitude" % ref)
            expected["ACMAG"] = literal(ac)
        if "acPhase" in source:
            expected["ACPHASE"] = literal(number(source["acPhase"]))
        writes = list(expected.items())
    else:
        raise ValueError("%s: unsupported device class %s" % (ref, kind))
    unknown = set(source) - allowed
    if unknown:
        raise ValueError("%s: unmapped source parameters %s" % (ref, sorted(unknown)))
    return {"writes": writes, "expected": expected}


def check_parameters(actual, expected):
    return {name: {"expected": value, "actual": actual.get(name)}
            for name, value in expected.items() if not same_number(actual.get(name), value)}


def minimum_dimension_adjustment(item):
    """HES n/p MOS bounds measured through native callbacks, including nf > 1."""
    if (item["deviceClass"] != "mos" or item.get("targetLibrary") != "hes"
            or item.get("targetCell") not in ("n_mos_a", "p_mos_a")):
        return None
    source, unit = item["sourceParameters"], item["sourceLengthUnit"]
    width = number(source["w"], unit, "length")
    length = number(source["l"], unit, "length")
    nf = number(source.get("nf", "1"))
    if min(width, length, nf) <= 0 or nf != nf.to_integral_value():
        raise ValueError("%s: invalid source dimensions or finger count" % item["reference"])
    changes = {}
    if not HES_MIN_CHANNEL_LENGTH <= length <= HES_MAX_CHANNEL_LENGTH:
        changes.update(sourceL=literal(length), targetL=literal(HES_MIN_CHANNEL_LENGTH))
    if not HES_MIN_FINGER_WIDTH <= width / nf <= HES_MAX_FINGER_WIDTH:
        changes.update(sourceW=literal(width), targetW=literal(HES_MIN_FINGER_WIDTH * nf),
                       sourceFW=literal(width / nf), targetFW=literal(HES_MIN_FINGER_WIDTH), nf=literal(nf))
    if changes:
        return {"policy": SIZING_POLICY, **changes,
                "reason": "User-approved adjustment to the target PDK minimum dimension"}
    return None


def apply_minimum_dimensions(spec):
    """Adjust only out-of-range target dimensions; preserve source parameters."""
    adjusted = []
    for circuit in spec["circuits"]:
        for item in circuit["instances"]:
            if item["deviceClass"] != "mos":
                continue
            change = minimum_dimension_adjustment(item)
            if change:
                item["targetSizingAdjustment"] = change
                adjusted.append({"cellName": circuit["cellName"], "reference": item["reference"],
                                 **item["targetSizingAdjustment"]})
            else:
                item.pop("targetSizingAdjustment", None)
    spec["targetSizingAdjustments"] = adjusted
    return adjusted


def read_parameters(ae, instance, expected):
    return {name: str(ae.dbGetInstParam(instance, name).value) for name in expected}
