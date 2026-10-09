import os
import runpy
import unittest
import json
import tempfile
from unittest.mock import Mock, patch

helpers = runpy.run_path(os.path.join(os.path.dirname(os.path.dirname(__file__)), "analog-canvas-hes-pyaether-import.py"))


class GeometryTest(unittest.TestCase):
    def test_partial_import_progress_is_not_marked_complete(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "result.json")
            save = helpers["save_import_progress"]
            with patch.dict(save.__globals__, {"RESULT_PATH": path}):
                save([{"cellName": "saved"}], [{"cellName": "failed"}], 200)
            with open(path) as handle:
                result = json.load(handle)
            self.assertFalse(result["importComplete"])
            self.assertFalse(result["readbackVerified"])
            self.assertEqual(result["savedCircuitCount"], 1)

    def test_missing_native_net_is_rejected_before_cpp_binding(self):
        ae, instance, term = Mock(), Mock(), Mock()
        instance.getInstTerms.return_value = [term]
        ae.dbFindNetByName.return_value = None
        bind = helpers["bind_instance_terms"]
        with patch.dict(bind.__globals__, {"ae": ae, "master_term_name": lambda _: "S"}):
            self.assertRaisesRegex(ValueError, "native net is missing", bind, instance,
                {"reference": "M43", "nodes": [{"pinName": "S", "netName": "VDD/2"}]},
                {"VDD/2": Mock()}, Mock())
        term.addToNet.assert_not_called()

    def test_import_journal_keeps_completed_and_pending_operations(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "journal.jsonl")
            event = helpers["record_import_event"]
            with patch.dict(event.__globals__, {"JOURNAL_PATH": path}):
                event("cell-saved", "first", result={"instances": 11})
                event("parameter", "next", reference="C1", parameter="C", value="1e-12")
            with open(path) as handle:
                rows = [json.loads(line) for line in handle]
            self.assertEqual([row["phase"] for row in rows], ["cell-saved", "parameter"])
            self.assertEqual(rows[-1]["reference"], "C1")

    def test_failed_library_creation_stops_before_cell_creation(self):
        ae = Mock()
        ae.dbCreateLib.return_value = None
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "spec.json")
            with open(path, "w") as handle:
                json.dump({"schema": "analog-canvas-hes-pyaether-import-v8",
                           "targetTechnology": "hes", "targetLibrary": "unregistered_test_library",
                           "circuits": [{"cellName": "test", "galleryId": "test", "instances": [],
                               "sourceGeometry": {"bounds": {"minX": 0, "minY": 0, "maxX": 20, "maxY": 20},
                                   "portOccurrences": [], "contacts": [], "annotationStubs": [],
                                   "junctions": [], "routes": []}}]}, handle)
            with patch.dict(helpers["main"].__globals__, {"ae": ae, "SPEC_PATH": path,
                    "WORK_ROOT": root, "LIBRARY_PARENT": root,
                    "LIBRARY": "unregistered_test_library", "validate_target_pin_offsets": lambda: None}):
                self.assertRaisesRegex(RuntimeError, "could not create", helpers["main"])
        ae.dbNewCV.assert_not_called()

    def test_diagonal_bounds_keep_valid_spacing(self):
        solve = helpers["enforce_minimum_separation"]
        self.assertEqual(solve({"a": 0, "b": 10}, [("a", "b", 1)]), {"a": 0, "b": 10})
        self.assertEqual(solve({"a": 10, "b": 0, "c": 0}, [("a", "b", 1), ("b", "c", 2)]),
                         {"a": 10, "b": 11, "c": 13})

    def test_diagonal_bounds_reject_impossible_alignment(self):
        solve = helpers["enforce_minimum_separation"]
        self.assertRaises(ValueError, solve, {"a": 0}, [("a", "a", 1)])
        self.assertRaises(ValueError, solve, {"a": 0, "b": 0}, [("a", "b", 1), ("b", "a", 1)])

    def test_resistor_basis_all_transforms(self):
        for rotation in (0, 90, 180, 270):
            for mirror in ("none", "horizontal", "vertical", "both"):
                with self.subTest(rotation=rotation, mirror=mirror):
                    item = {"targetLibrary": "analog", "targetCell": "res",
                            "sourceTransform": {"rotation": rotation, "mirror": mirror}}
                    orient = helpers["instance_orientation"](item)
                    actual = helpers["orient_offset"]((60, 0), orient)
                    expected = helpers["orient_offset"]((0, -60), helpers["source_orientation"](item["sourceTransform"]))
                    self.assertEqual(actual, expected)

    def test_diagonal_source_is_not_orthogonalized(self):
        layout = {key: [] for key in ("routes", "contacts", "expandedLinks", "bulkStubs", "bulkShorts", "annotationStubs")}
        layout["routes"] = [{"netName": "V", "points": [(0, 0), (30, 40)]}]
        self.assertEqual(helpers["planned_wire_segments"](layout), [("V", (0, 0), (30, 40))])
        layout["bulkStubs"] = [{"netName": "B", "points": [(0, 0), (30, 40)]}]
        self.assertEqual(helpers["planned_wire_segments"](layout)[1:], [("B", (0, 0), (30, 0)), ("B", (30, 0), (30, 40))])

    def test_inductor_basis_matches_resistor(self):
        for rotation in (0, 90, 180, 270):
            for mirror in ("none", "horizontal", "vertical", "both"):
                item = {"targetLibrary": "analog", "targetCell": "ind",
                        "sourceTransform": {"rotation": rotation, "mirror": mirror}}
                orientation = helpers["instance_orientation"](item)
                item["targetCell"] = "res"
                self.assertEqual(orientation, helpers["instance_orientation"](item))
                item["targetCell"] = "cap"
                self.assertEqual(orientation, helpers["instance_orientation"](item))

    def test_internal_supply_marker_does_not_add_port(self):
        source = {"cellName": "internal_supply", "instances": [], "sourceGeometry": {
            "bounds": {"minX": 0, "minY": 0, "maxX": 20, "maxY": 20},
            "portOccurrences": [], "contacts": [], "annotationStubs": [],
            "internalNetMarkers": [{"occurrenceId": "VDD-copy", "netName": "VDD",
                                    "sourcePosition": {"x": 0, "y": 0}}],
            "junctions": [{"id": "j1", "netName": "VDD", "role": "branch",
                           "sourcePosition": {"x": 20, "y": 0}}],
            "routes": [{"id": "r1", "netName": "VDD",
                "start": {"kind": "terminal", "instanceId": "VDD-copy", "pinName": "P",
                          "sourcePoint": {"x": 0, "y": 0}},
                "steps": [{"kind": "junction", "junctionId": "j1", "sourcePoint": {"x": 20, "y": 0}}]}]}}
        layout = helpers["build_layout"](source)
        self.assertEqual(layout["ports"], [])
        self.assertEqual(len(layout["internalNetMarkers"]), 1)
        self.assertEqual(layout["geometryAudit"]["afterViolationCount"], 0)
        self.assertEqual(layout["routes"][0]["points"][0], layout["internalNetMarkers"][0]["xy"])


if __name__ == "__main__":
    unittest.main()
