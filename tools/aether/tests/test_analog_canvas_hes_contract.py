import copy
import os
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analog_canvas_hes_contract import validate_manifest


class ContractTest(unittest.TestCase):
    def setUp(self):
        self.spec = {"schema": "analog-canvas-hes-pyaether-import-v8", "targetTechnology": "hes",
                     "targetLibrary": "new_library", "circuits": [{"cellName": "test", "galleryId": "test-id"}]}

    def test_valid(self):
        validate_manifest(self.spec)

    def test_rejects_empty_and_duplicate_cells(self):
        for circuits in [[], self.spec["circuits"] * 2]:
            with self.subTest(circuits=circuits):
                self.assertRaises(ValueError, validate_manifest, {**self.spec, "circuits": circuits})

    def test_rejects_paths_and_console_code(self):
        for value in ["../escape", "/abs", "a/b", "a';exit()", "", None]:
            with self.subTest(value=value):
                self.assertRaises(ValueError, validate_manifest, {**self.spec, "targetLibrary": value})
                for field in ["cellName", "galleryId"]:
                    spec = copy.deepcopy(self.spec)
                    spec["circuits"][0][field] = value
                    self.assertRaises(ValueError, validate_manifest, spec)

    def test_capture_rejects_missing_explicit_configuration_before_gui(self):
        script = Path(__file__).resolve().parents[1] / "analog-canvas-aether-screenshot.sh"
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith("AETHER_") and key != "DISPLAY"}
        result = subprocess.run(["bash", str(script), "test"], env=environment, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Set the existing Aether X11 DISPLAY", result.stderr)


if __name__ == "__main__":
    unittest.main()
