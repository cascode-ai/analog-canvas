import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from analog_canvas_hes_parameters import number, parameter_plan, check_parameters, apply_minimum_dimensions


def mos(**parameters):
    return {"reference": "M1", "deviceClass": "mos", "sourceLengthUnit": "m",
            "sourceParameters": {"w": "1u", "l": "150n", **parameters}}


class ParametersTest(unittest.TestCase):
    def test_spice_atto_is_not_reinterpreted_as_amperes(self):
        item = {"reference": "I1", "deviceClass": "current-source", "sourceParameters": {"dc": "1a"}}
        self.assertEqual(parameter_plan(item)["expected"]["DC"], "1E-18")
        self.assertEqual(number("1A"), number("1e-18"))

    def test_out_of_range_requires_explicit_adjustment(self):
        item = mos(l="80n")
        item.update(targetLibrary="hes", targetCell="n_mos_a")
        self.assertRaisesRegex(ValueError, "explicitly enable", parameter_plan, item)
        self.assertEqual(item["sourceParameters"]["l"], "80n")

    def test_out_of_range_width_becomes_minimum_per_finger(self):
        for nf, width, target in [("1", "400u", "150n"), ("4", "1m", "600n"), ("4", "100n", "600n")]:
            item = mos(w=width, nf=nf)
            item.update(targetLibrary="hes", targetCell="p_mos_a")
            spec = {"circuits": [{"cellName": "test", "instances": [item]}]}
            self.assertEqual(len(apply_minimum_dimensions(spec)), 1)
            expected = parameter_plan(item)["expected"]
            self.assertEqual(number(expected["w"]), number(target))
            self.assertEqual(number(expected["fw"]), number("150n"))
            self.assertEqual(item["sourceParameters"]["w"], width)

    def test_above_maximum_length_becomes_minimum(self):
        item = mos(l="21u")
        item.update(targetLibrary="hes", targetCell="n_mos_a")
        spec = {"circuits": [{"cellName": "test", "instances": [item]}]}
        apply_minimum_dimensions(spec)
        self.assertEqual(number(parameter_plan(item)["expected"]["l"]), number("130n"))

    def test_inclusive_bounds_and_idempotence(self):
        for width, length in [("150n", "130n"), ("50u", "20u")]:
            item = mos(w=width, l=length)
            item.update(targetLibrary="hes", targetCell="n_mos_a")
            spec = {"circuits": [{"cellName": "test", "instances": [item]}]}
            self.assertEqual(apply_minimum_dimensions(spec), [])
        item["sourceParameters"]["w"] = "400u"
        first = apply_minimum_dimensions(spec)
        self.assertEqual(apply_minimum_dimensions(spec), first)

    def test_authorized_minimum_length_keeps_original_value(self):
        for raw, unit in [("40nm", "m"), ("80n", "m"), ("0.08", "um")]:
            item = mos(l=raw)
            item.update(sourceLengthUnit=unit, targetLibrary="hes", targetCell="n_mos_a")
            spec = {"circuits": [{"cellName": "test", "instances": [item]}]}
            changes = apply_minimum_dimensions(spec)
            self.assertEqual(len(changes), 1)
            self.assertEqual(number(parameter_plan(item)["expected"]["l"]), number("130n"))
            self.assertEqual(item["sourceParameters"]["l"], raw)

    def test_valid_length_is_not_changed(self):
        item = mos(l="150n")
        changes = apply_minimum_dimensions({"circuits": [{"cellName": "test", "instances": [item]}]})
        self.assertEqual(changes, [])
        self.assertNotIn("targetSizingAdjustment", item)

    def test_unauthorized_dimension_override_is_rejected(self):
        item = mos(l="80n")
        item.update(targetLibrary="hes", targetCell="n_mos_a")
        apply_minimum_dimensions({"circuits": [{"cellName": "test", "instances": [item]}]})
        item["targetSizingAdjustment"]["targetL"] = "150n"
        self.assertRaisesRegex(ValueError, "inconsistent", parameter_plan, item)

    def test_si_literals(self):
        for left, right in [("1u", "1e-6"), ("150 n", "0.00000015"), ("1MEG", "1e6"), ("1M", "0.001")]:
            with self.subTest(left=left):
                self.assertEqual(number(left), number(right))

    def test_no_expression_or_nonfinite(self):
        for value in ["nan", "inf", "1foo", "iPar('w')", "{w}", "1u+2u", ""]:
            with self.subTest(value=value):
                self.assertRaises(ValueError, number, value)

    def test_dimensional_unit_labels(self):
        for raw, quantity, expected in [("2pF", "capacitance", "2e-12"),
                ("1uA", "current", "1e-6"), ("10k\u03a9", "resistance", "1e4"),
                ("48ohm", "resistance", "48"), ("1MegOhm", "resistance", "1e6"),
                ("2mH", "inductance", "2e-3"), ("1.8V", "voltage", "1.8"),
                ("150nm", "length", "150e-9")]:
            with self.subTest(raw=raw):
                self.assertEqual(number(raw, quantity=quantity), number(expected))

    def test_wrong_and_ambiguous_units_rejected(self):
        for raw, quantity in [("2pF", "current"), ("1uA", "capacitance"),
                ("1MOhm", "resistance"), ("1MF", "capacitance"),
                ("1foo", "capacitance"), ("1uFjunk", "capacitance"),
                ("1\u00b5A", "current")]:
            with self.subTest(raw=raw):
                self.assertRaises(ValueError, number, raw, quantity=quantity)

    def test_units_not_scaled_twice(self):
        self.assertEqual(number("150nm", "um", "length"), number("150n"))

    def test_inductor_and_voltage_parameters(self):
        for kind, source, expected in [("inductor", {"value": "2mH"}, {"L": "0.002", "M": "1"}),
                ("voltage-source", {"dc": "-1.8V"}, {"DC": "-1.8"}),
                ("voltage-source", {"dc": "0"}, {"DC": "0"})]:
            item = {"reference": "Z1", "deviceClass": kind, "sourceParameters": source}
            self.assertFalse(check_parameters(parameter_plan(item)["expected"], expected))

    def test_ac_source_metadata_is_not_dropped(self):
        item = {"reference": "V1", "deviceClass": "voltage-source",
                "sourceParameters": {"dc": "0", "waveform": "dc", "acMagnitude": "1V", "acPhase": "-90"}}
        self.assertEqual(parameter_plan(item)["expected"], {"DC": "0", "ACMAG": "1", "ACPHASE": "-9E+1"})
        item["sourceParameters"]["acMagnitude"] = "-1"
        self.assertRaises(ValueError, parameter_plan, item)

    def test_explicit_micrometres(self):
        item = mos(w="1", l="0.15")
        item["sourceLengthUnit"] = "um"
        self.assertEqual(parameter_plan(item)["expected"], parameter_plan(mos())["expected"])

    def test_suffix_not_scaled_twice(self):
        self.assertEqual(number("1u", "um"), number("1u"))

    def test_requires_unit(self):
        item = mos()
        del item["sourceLengthUnit"]
        self.assertRaises(ValueError, parameter_plan, item)

    def test_finger_width(self):
        plan = parameter_plan(mos(w="4u", nf="4", m="2"))
        self.assertEqual(number(plan["expected"]["fw"]), number("1u"))
        self.assertEqual(plan["writes"][0], ("calcParam", "FingerWidth"))

    def test_no_unknown_or_invalid_mos(self):
        for args in [{"w": "0"}, {"l": "-1n"}, {"nf": "1.5"}, {"m": "0"}, {"ad": "1p"}]:
            with self.subTest(args=args):
                self.assertRaises(ValueError, parameter_plan, mos(**args))

    def test_missing_dimension(self):
        item = mos()
        del item["sourceParameters"]["w"]
        self.assertRaises(ValueError, parameter_plan, item)

    def test_inverter_requires_explicit_profile(self):
        item = mos()
        item["sourceExpandedFrom"] = "X1"
        self.assertRaises(ValueError, parameter_plan, item)
        item["expansionProfile"] = "cmos-inverter-w1u-l150n-v1"
        self.assertIn("fw", parameter_plan(item)["expected"])

    def test_passives(self):
        for kind, value, field in [("capacitor", "1p", "C"), ("resistor", "1k", "R")]:
            item = {"reference": "Z1", "deviceClass": kind, "sourceParameters": {"value": value}}
            self.assertEqual(number(parameter_plan(item)["expected"][field]), number(value))

    def test_physical_cap_c_field_is_not_simulation_capacitance(self):
        item = {"reference": "C1", "deviceClass": "capacitor", "targetLibrary": "hes",
                "targetCell": "cap_mim", "sourceParameters": {"value": "38.1pF"}}
        self.assertRaisesRegex(ValueError, "physical cap_mim", parameter_plan, item)
        item.update(targetLibrary="analog", targetCell="cap")
        plan = parameter_plan(item)
        self.assertEqual(plan["expected"], {"C": "3.81E-11", "M": "1"})

    def test_dc_only(self):
        item = {"reference": "I1", "deviceClass": "current-source", "sourceParameters": {"waveform": "dc", "dc": "-1m", "rise": "1ps"}}
        self.assertEqual(number(parameter_plan(item)["expected"]["DC"]), number("-1m"))
        item["sourceParameters"]["waveform"] = "pulse"
        self.assertRaises(ValueError, parameter_plan, item)

    def test_readback_detects_clamping_and_missing(self):
        self.assertFalse(check_parameters({"w": "1000n"}, {"w": "1u"}))
        self.assertIn("w", check_parameters({"w": "150n"}, {"w": "1u"}))
        self.assertIn("w", check_parameters({}, {"w": "1u"}))


if __name__ == "__main__":
    unittest.main()
