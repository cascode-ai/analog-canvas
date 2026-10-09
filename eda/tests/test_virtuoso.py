import copy
import unittest
from unittest.mock import Mock, patch

from virtuoso import Virtuoso, prepare_manifest, plan_circuit
from virtuoso_bridge.virtuoso.schematic import manifest as bridge


def source_projection():
    return {"schema": "analog-canvas-eda-source-v1", "circuits": [{
        "cellName": "one", "instances": [{
            "id": "source-M1", "reference": "M1", "deviceClass": "mos", "kind": "nmos",
            "sourceTarget": "NMOS", "sourcePosition": {"x": 50, "y": 50},
            "sourceTransform": {"rotation": 0, "mirror": "none"},
            "nodes": [{"sourcePinName": pin, "pinName": pin, "netName": pin} for pin in "DGSB"],
            "sourceLengthUnit": "m", "sourceParameters": {"w": "0.000001", "l": "150n"}
        }], "ports": [], "nets": list("DGSB"), "sourceGeometry": {
            "bounds": {"minX": 20, "minY": 20, "maxX": 80, "maxY": 80},
            "portOccurrences": [], "junctions": [], "routes": [], "contacts": [],
            "localBulkLabels": [], "localBulkShorts": [], "annotationStubs": []
        }
    }]}


def process_map():
    return {"schema": "virtuoso-bridge-process-map-v1", "gridUnit": 0.0625,
        "processes": {"demo": {"outputLibrary": "new_demo", "devices": {"nmos": {
            "library": "demoPdk", "cell": "nmos4",
            "pinOffsets": {"D": [4, 3], "G": [0, 0], "S": [4, -3], "B": [4, -1]},
            "parameterMap": {"w": "w", "l": "l"}
        }}}}}


class VirtuosoTest(unittest.TestCase):
    def test_real_bridge_plans_the_adapted_projection_without_hes_policy(self):
        original = source_projection()
        before = copy.deepcopy(original)
        spec = prepare_manifest(original)
        prepared, layout = bridge.plan_manifest_circuit(spec["circuits"][0],
            bridge.load_process_map(process_map()), "demo")
        self.assertEqual(original, before)
        self.assertEqual(prepared["instances"][0]["targetLibrary"], "demoPdk")
        self.assertEqual(layout["geometryAudit"]["afterViolationCount"], 0)
        self.assertEqual(prepared["instances"][0]["sourceParameters"]["w"], "1E-6")
        self.assertNotIn("geometryPolicy", spec["circuits"][0])

    def test_bare_micrometre_dimensions_keep_physical_value(self):
        original = source_projection()
        item = original["circuits"][0]["instances"][0]
        item["sourceLengthUnit"] = "um"
        item["sourceParameters"] = {"w": "1", "l": "0.15"}
        adapted = prepare_manifest(original)["circuits"][0]["instances"][0]
        self.assertEqual(adapted["sourceParameters"], {"w": "1E-6", "l": "1.5E-7"})
        self.assertEqual(adapted["originalSourceParameters"], {"w": "1", "l": "0.15"})

    def test_unsupported_markers_and_hes_manifests_are_rejected(self):
        original = source_projection()
        original["circuits"][0]["sourceGeometry"]["internalNetMarkers"] = [{"netName": "D"}]
        self.assertRaisesRegex(ValueError, "supply-marker", prepare_manifest, original)
        original["schema"] = "analog-canvas-hes-pyaether-import-v8"
        self.assertRaisesRegex(ValueError, "source projection", prepare_manifest, original)

    def test_adapter_retains_bridge_verified_no_overwrite_transaction(self):
        spec = prepare_manifest(source_projection())
        backend = Virtuoso(spec, process_map(), "demo", client=Mock())
        source = spec["circuits"][0]
        backend.preflight(source)
        self.assertRaises(RuntimeError, backend.import_one, source)
        result = {"cellName": "one", "library": "new_demo", "verification": {"passed": True}}
        with patch.object(bridge, "validate_process_master_offsets") as audit:
            backend.open()
            audit.assert_called_once_with(backend.client, backend.process_map, ["demo"])
        with patch.object(bridge, "import_manifest_circuit", return_value=(source, result)) as native:
            saved = backend.import_one(source)
            native.assert_called_once_with(backend.client, source, backend.process_map, "demo",
                verify=True, overwrite=False)
        self.assertTrue(backend.verify_one(source, saved)["passed"])
        self.assertRaises(ValueError, backend.verify_one, source, {**result, "library": "other"})
        self.assertRaises(ValueError, backend.verify_one, source, {**result, "verification": {"passed": False}})

    def test_missing_explicit_connection_is_rejected(self):
        spec = prepare_manifest(source_projection())
        self.assertRaisesRegex(ValueError, "explicit Bridge", Virtuoso, spec, process_map(), "demo")

    def test_dropped_parameters_and_overrides_rejected_before_native_open(self):
        source = prepare_manifest(source_projection())["circuits"][0]
        source["instances"][0]["sourceParameters"]["nf"] = "4"
        mapping = process_map()
        self.assertRaisesRegex(ValueError, "unmapped source parameters nf",
                               plan_circuit, source, mapping, "demo")
        device = mapping["processes"]["demo"]["devices"]["nmos"]
        device["parameterMap"]["nf"] = "fingers"
        plan_circuit(source, mapping, "demo")
        device["parameterOverrides"] = {"nf": "1"}
        self.assertRaisesRegex(ValueError, "changes source parameter nf",
                               plan_circuit, source, mapping, "demo")
        device["parameterOverrides"] = {}
        device["parameterMap"]["nf"] = "w"
        self.assertRaisesRegex(ValueError, "colliding", plan_circuit, source, mapping, "demo")

    def test_expanded_inverter_geometry_is_rejected_explicitly(self):
        projection = source_projection()
        projection["circuits"][0]["instances"][0]["sourceExpandedFrom"] = "X1"
        self.assertRaisesRegex(ValueError, "shared endpoints", prepare_manifest, projection)

    def test_dimension_override_cannot_trigger_bridges_bare_micrometre_rule(self):
        source = prepare_manifest(source_projection())["circuits"][0]
        mapping = process_map()
        device = mapping["processes"]["demo"]["devices"]["nmos"]
        device["parameterOverrides"] = {"w": "0.000001"}
        self.assertRaisesRegex(ValueError, "dimension override", plan_circuit, source, mapping, "demo")
        device["parameterOverrides"] = {"w": source["instances"][0]["sourceParameters"]["w"]}
        plan_circuit(source, mapping, "demo")
