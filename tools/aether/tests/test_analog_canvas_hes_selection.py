import os
import runpy
import sys
import unittest

TOOLS = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, TOOLS)
helpers = runpy.run_path(os.path.join(TOOLS, "analog-canvas-hes-select.py"))


class SelectionTest(unittest.TestCase):
    def test_uuid_gallery_ids_use_safe_cell_names(self):
        self.assertEqual(helpers["target_cell_name"]("2edb8358-a4a1-45c8-a246-29d593d4e317"),
                         "c_2edb8358_a4a1_45c8_a246_29d593d4e317")
        for invalid in ("../a", "/a", "a:b", ""):
            with self.assertRaises(ValueError):
                helpers["target_cell_name"](invalid)

    def test_count_original_mos_only(self):
        circuit = {"instances": [
            {"deviceClass": "mos", "sourceParameters": {"nf": "8", "m": "4"}},
            {"deviceClass": "mos", "sourceExpandedFrom": "X1"},
            {"deviceClass": "capacitor"},
        ]}
        self.assertEqual(helpers["source_transistor_count"](circuit), 1)

    def test_round_robin_and_limit(self):
        rows = [{"galleryId": str(i), "sourceInstances": n}
                for i, n in enumerate([11, 12, 21, 22, 41, 42, 81, 82])]
        selected = helpers["choose_diverse"](rows, 5)
        self.assertEqual([row["sourceInstances"] for row in selected], [11, 21, 41, 81, 12])
        self.assertEqual(len({row["galleryId"] for row in selected}), 5)

    def test_does_not_duplicate_to_fill_shortfall(self):
        row = {"galleryId": "a", "sourceInstances": 11}
        self.assertEqual(helpers["choose_diverse"]([row], 200), [row])

    def test_passives_and_sources_count_and_expansions_do_not_inflate(self):
        circuit = {"instances": [
            {"deviceClass": "mos"}, {"deviceClass": "resistor"},
            {"deviceClass": "capacitor"}, {"deviceClass": "inductor"},
            {"deviceClass": "current-source"},
            {"deviceClass": "mos", "sourceExpandedFrom": "X1"},
            {"deviceClass": "mos", "sourceExpandedFrom": "X1"},
        ]}
        self.assertEqual(helpers["source_instance_count"](circuit), 6)


if __name__ == "__main__":
    unittest.main()
