import os
import runpy
import unittest
import tempfile
from pathlib import Path
from html.parser import HTMLParser

helpers = runpy.run_path(os.path.join(os.path.dirname(os.path.dirname(__file__)), "analog-canvas-hes-comparison.py"))


class ImageParser(HTMLParser):
    def handle_starttag(self, tag, attrs):
        self.tag, self.attrs = tag, dict(attrs)


class ComparisonTest(unittest.TestCase):
    def test_progress_includes_only_captured_members(self):
        sources = [{"cellName": "a"}, {"cellName": "b"}]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "shots").mkdir()
            (root / "shots/a.png").touch()
            (root / "shots/unrelated.png").touch()
            self.assertEqual(helpers["captured_circuits"](sources, root, Path("shots"), True), sources[:1])
            self.assertEqual(helpers["captured_circuits"](sources, root, Path("shots"), False), sources)

    def test_full_application_image_has_no_crop(self):
        markup = helpers["screenshot_markup"]("screenshots-full-ui/test.png", "Test", (1920, 1080))
        parser = ImageParser()
        parser.feed(markup)
        self.assertEqual(parser.tag, "img")
        self.assertEqual(parser.attrs["src"], "screenshots-full-ui/test.png")
        self.assertEqual((parser.attrs["width"], parser.attrs["height"]), ("1920", "1080"))
        self.assertNotIn("viewBox", markup)
        self.assertNotIn("clip-path", markup)
        self.assertNotIn("style", parser.attrs)

    def test_title_is_escaped_once(self):
        markup = helpers["screenshot_markup"]("screenshots/test.png", 'A & B "quoted"', (1920, 1080))
        parser = ImageParser()
        parser.feed(markup)
        self.assertEqual(parser.attrs["alt"], 'Aether A & B "quoted"')

    def test_brand_labels_are_above_picture_frame(self):
        for brand in ("Analog Canvas", "Aether"):
            markup = helpers["panel_markup"](brand, "picture.png", '<img src="picture.png">')
            self.assertIn(f'<figcaption>{brand}</figcaption><a class="frame"', markup)
            self.assertNotIn("panel-label", markup)
            self.assertLess(markup.index("</figcaption>"), markup.index("<img"))


if __name__ == "__main__":
    unittest.main()
