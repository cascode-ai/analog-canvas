import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "packages/virtuoso-import/engine"))
from convert_canvas import on_segment, segment_distance_squared, simplify, split_source_segments, terminal_first, terminal_is_anchor, orthogonal_points


class WireGeometryTests(unittest.TestCase):
    def test_branch_on_target_pin_uses_terminal_without_zero_length_route(self):
        pin = ("M8", "G")
        refs = [pin]
        positions = {pin: (-110, 110)}
        self.assertTrue(terminal_is_anchor(refs, 2, (-110, 110), positions))
        self.assertFalse(terminal_is_anchor(refs, 2, (-120, 110), positions))
        self.assertFalse(terminal_is_anchor(refs, 3, (-110, 110), positions))
        self.assertTrue(terminal_is_anchor(refs, 1, (-120, 110), positions))

    def test_terminal_first_moves_escape_to_device_not_junction(self):
        junction = {"kind": "junction", "junctionId": "J"}
        terminal = {"kind": "terminal", "instanceId": "M1", "pinName": "S"}
        start, end, points = terminal_first(junction, terminal, [(780, 750), (880, 740)])
        self.assertEqual((start, end), (terminal, junction))
        self.assertEqual(orthogonal_points(points), [(880, 740), (880, 750), (780, 750)])
        self.assertEqual(terminal_first(start, end, points), (start, end, points))
        self.assertEqual(terminal_first(terminal, terminal, points), (terminal, terminal, points))
        self.assertEqual(terminal_first(junction, junction, points), (junction, junction, points))

    def test_arbitrary_angle_and_bounds(self):
        self.assertTrue(on_segment((2, 1), (0, 0), (6, 3)))
        self.assertTrue(on_segment((2, 1), (6, 3), (0, 0)))
        self.assertFalse(on_segment((2, 2), (0, 0), (6, 3)))
        self.assertFalse(on_segment((8, 4), (0, 0), (6, 3)))
        self.assertEqual(simplify([(0, 0), (2, 1), (6, 3)]), [(0, 0), (6, 3)])

    def test_distance_uses_projection_not_bounding_box(self):
        self.assertEqual(segment_distance_squared((0, 2), (0, 0), (2, 2)), 2)
        self.assertEqual(segment_distance_squared((3, 3), (0, 0), (2, 2)), 2)
        self.assertEqual(segment_distance_squared((1, 1), (0, 0), (0, 0)), 2)

    def test_fractional_tap_is_split_before_rounding(self):
        a, tap, b = (0, 0), (1.5, 1), (3, 2)
        result = split_source_segments({"n": [(a, b)]}, {"n": {a, tap, b}},
                                       lambda p: tuple(round(v) for v in p))
        self.assertEqual(result["n"], [((0, 0), (2, 1)), ((2, 1), (3, 2))])

    def test_crossings_do_not_create_electrical_junctions(self):
        a, b, c, d = (0, 0), (4, 4), (0, 4), (4, 0)
        result = split_source_segments({"p": [(a, b)], "n": [(c, d)]},
                                       {"p": {a, b}, "n": {c, d}}, lambda p: p)
        self.assertEqual(result, {"p": [(a, b)], "n": [(c, d)]})
        # Even on the same net, a crossing without a declared node stays a crossing.
        result = split_source_segments({"p": [(a, b), (c, d)]}, {"p": {a, b, c, d}}, lambda p: p)
        self.assertEqual(len(result["p"]), 2)
        result = split_source_segments({"p": [(a, b), (c, d)]}, {"p": {a, b, c, d, (2, 2)}}, lambda p: p)
        self.assertEqual(len(result["p"]), 4)


if __name__ == "__main__":
    unittest.main()
