import copy
import json
import runpy
import shutil
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from aether import Aether
from common import select_cells
from import_one import import_one
from workflow import run_batch


def source(name="one"):
    return {"cellName": name, "galleryId": name, "instances": [],
            "sourceGeometry": {"bounds": {"minX": 0, "minY": 0, "maxX": 20, "maxY": 20},
                               "portOccurrences": [], "contacts": [], "annotationStubs": [],
                               "junctions": [], "routes": []}}


class RecordingBackend:
    name = "test"

    def __init__(self, fail=None, bad_preflight=None):
        self.events = []
        self.fail = fail
        self.bad_preflight = bad_preflight

    def preflight(self, item):
        self.events.append(("preflight", item["cellName"]))
        if item["cellName"] == self.bad_preflight:
            raise ValueError("invalid source")

    def open(self):
        self.events.append(("open", None))

    def import_one(self, item):
        name = item["cellName"]
        self.events.append(("import", name))
        self.emit("parameter", name, reference="C1", parameter="C", value="1e-12")
        if name == self.fail:
            raise RuntimeError("native failure")
        return {"cellName": name, "geometryAudit": {"afterViolationCount": 0}}

    def verify_one(self, item, result):
        self.events.append(("verify", item["cellName"]))
        return {"passed": True}


class WorkflowTest(unittest.TestCase):
    def test_batch_calls_the_single_operation_serially(self):
        backend = RecordingBackend()
        with tempfile.TemporaryDirectory() as root:
            with patch("workflow.import_one", wraps=import_one) as one:
                result = run_batch([source(), source("two")], backend, root)
            self.assertEqual(one.call_count, 2)
        self.assertTrue(result["passed"])
        self.assertEqual(backend.events, [("preflight", "one"), ("preflight", "two"),
            ("open", None), ("import", "one"), ("verify", "one"),
            ("import", "two"), ("verify", "two")])

    def test_preflight_failure_never_opens_target(self):
        backend = RecordingBackend(bad_preflight="two")
        with tempfile.TemporaryDirectory() as root:
            self.assertRaises(ValueError, run_batch, [source(), source("two")], backend, root)
            result = json.loads((Path(root) / "execution-status.json").read_text())
        self.assertFalse(result["passed"])
        self.assertNotIn(("open", None), backend.events)

    def test_legacy_execution_evidence_is_never_overwritten(self):
        for name in ("execution-status.json", "import-result.json", "import-journal.jsonl",
                     "aether_hes_import_result.json", "aether_hes_readback.json",
                     "aether_hes_geometry_audit.json"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as root:
                evidence = Path(root) / name
                evidence.write_text("existing evidence")
                backend = RecordingBackend()
                self.assertRaises(FileExistsError, run_batch, [source()], backend, root)
                self.assertEqual(evidence.read_text(), "existing evidence")
                self.assertFalse((Path(root) / "import-attempt.json").exists())
                self.assertEqual(backend.events, [])

    def test_reused_console_loads_each_bundles_own_modules(self):
        tools = Path(__file__).resolve().parents[1]
        original_path = list(sys.path)
        previous_common = sys.modules["common"]
        for version in ("first", "second"):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in ("import_one.py", "import_batch.py", "workflow.py"):
                    shutil.copy2(tools / name, root / name)
                # An external bundle's module marker tests loading, not EDA behavior.
                (root / "common.py").write_text('raise RuntimeError("bundle-' + version + '")')
                with self.assertRaisesRegex(RuntimeError, "bundle-" + version):
                    runpy.run_path(str(root / "import_batch.py"), run_name="__main__",
                                   init_globals={"EDA_ARGS": ["--help"]})
                self.assertIs(sys.modules["common"], previous_common)
                self.assertEqual(sys.path, original_path)

    def test_partial_failure_and_journal_are_retained_without_retry(self):
        backend = RecordingBackend(fail="two")
        backend.name, backend.library = "aether", "demo"
        with tempfile.TemporaryDirectory() as root:
            self.assertRaises(RuntimeError, run_batch, [source(), source("two"), source("three")], backend, root)
            result = json.loads((Path(root) / "aether_hes_import_result.json").read_text())
            self.assertFalse(result["importComplete"])
            self.assertFalse(result["readbackVerified"])
            self.assertEqual(result["savedCircuitCount"], 1)
            journal = (Path(root) / "import-journal.jsonl").read_bytes()
            rows = [json.loads(line) for line in journal.splitlines()]
            self.assertIn("cell-complete", [row["phase"] for row in rows])
            self.assertEqual(rows[-1]["cellName"], "two")
            self.assertEqual(rows[-1]["phase"], "parameter")
            before = list(backend.events)
            self.assertRaises(FileExistsError, run_batch, [source()], backend, root)
            self.assertEqual(backend.events, before)
            self.assertEqual((Path(root) / "import-journal.jsonl").read_bytes(), journal)
        self.assertNotIn(("import", "three"), backend.events)

    def test_failed_readback_is_not_success(self):
        backend = RecordingBackend()
        backend.verify_one = lambda item, result: {"passed": False}
        with tempfile.TemporaryDirectory() as root:
            self.assertRaisesRegex(ValueError, "verification failed", run_batch, [source()], backend, root)
            result = json.loads((Path(root) / "import-result.json").read_text())
        self.assertFalse(result["passed"])
        self.assertEqual(len(result["saved"]), 1)

    def test_single_selection_is_exact_and_nonmutating(self):
        spec = {"circuits": [source(), source("two")]}
        before = copy.deepcopy(spec)
        self.assertRaises(ValueError, select_cells, spec, single=True)
        self.assertEqual(select_cells(spec, ["two"], single=True), [spec["circuits"][1]])
        for names in (["absent"], ["one", "one"]):
            self.assertRaises(ValueError, select_cells, spec, names)
        self.assertEqual(spec, before)

    def test_missing_net_rejected_before_native_binding(self):
        api, instance, term = Mock(), Mock(), Mock()
        instance.getInstTerms.return_value = [term]
        api.dbFindNetByName.return_value = None
        adapter = Aether(api, "demo", "/tmp")
        with patch("aether.master_term_name", return_value="S"):
            self.assertRaisesRegex(ValueError, "native net is missing", adapter.bind_instance_terms,
                instance, {"reference": "M43", "nodes": [{"pinName": "S", "netName": "VDD/2"}]},
                {"VDD/2": Mock()}, Mock())
        term.addToNet.assert_not_called()

    def test_library_failure_prevents_cell_creation(self):
        api = Mock()
        api.dbCreateLib.return_value = None
        with tempfile.TemporaryDirectory() as root:
            adapter = Aether(api, "demo", root)
            adapter.preflight(source())
            with patch.object(adapter, "validate_target_pin_offsets"):
                self.assertRaisesRegex(RuntimeError, "could not create", adapter.open)
        api.dbNewCV.assert_not_called()

    def test_existing_library_and_missing_preflight_are_rejected(self):
        api = Mock()
        with tempfile.TemporaryDirectory() as root:
            adapter = Aether(api, "demo", root)
            self.assertRaisesRegex(RuntimeError, "Preflight", adapter.open)
            (Path(root) / "demo").mkdir()
            self.assertRaises(FileExistsError, adapter.preflight, source())
        api.dbCreateLib.assert_not_called()

    def test_open_cell_is_closed_on_native_failure(self):
        api = Mock()
        adapter = Aether(api, "demo", "/tmp")
        adapter._ready = True
        with patch.object(adapter, "populate_cell", side_effect=RuntimeError("native failure")):
            self.assertRaises(RuntimeError, adapter.import_one, source())
        api.dbOpenCV.return_value.close.assert_called_once()

    def test_symbol_is_closed_on_failed_instance_creation(self):
        api = Mock()
        api.dbCrtInst.return_value = None
        adapter = Aether(api, "demo", "/tmp")
        item = {"reference": "M1", "targetLibrary": "hes", "targetCell": "n_mos_a"}
        circuit = {**source(), "nets": [], "ports": [], "instances": [item]}
        with patch.object(adapter, "db_point"):
            self.assertRaisesRegex(RuntimeError, "Cannot create", adapter.populate_cell,
                circuit, {"placements": {"M1": [0, 0]}, "orientations": {"M1": "R0"}}, Mock())
        api.dbOpenCV.return_value.close.assert_called_once()
