import unittest
from types import SimpleNamespace
from analog_canvas_hes_ports import graphical_port_readback


def terminal(position=(20, 30), orientation="R0", name="IN", net="input", count=1):
    figure = SimpleNamespace(dbuTransform=SimpleNamespace(xOffset=lambda: position[0], yOffset=lambda: position[1]),
                             getOrient=lambda: orientation)
    pin = SimpleNamespace(getFigs=lambda: [figure])
    return SimpleNamespace(name=name, net=net, _emyTerm__getPins=lambda: [pin] * count)


class PortReadbackTest(unittest.TestCase):
    def check(self, terms):
        layout = {"ports": [{"name": "IN", "netName": "input", "xy": [20, 30], "targetOrient": "R0"}]}
        return graphical_port_readback(terms, layout, lambda term: term.name, lambda term: term.net,
                                       lambda port: port["targetOrient"])

    def test_native_boundary_fields_match(self):
        self.assertTrue(self.check([terminal()])["passed"])

    def test_displaced_rotated_wrong_net_and_duplicate_pins_fail(self):
        for item in [terminal(position=(21, 30)), terminal(orientation="R90"), terminal(net="other"),
                     terminal(name="OUT"), terminal(count=2)]:
            self.assertFalse(self.check([item])["passed"])
        self.assertFalse(self.check([])["passed"])

    def test_unrecognized_native_representation_requires_calibration(self):
        pin = SimpleNamespace(getFigs=lambda: [object()])
        term = SimpleNamespace(_emyTerm__getPins=lambda: [pin])
        self.assertRaisesRegex(ValueError, "calibration", self.check, [term])


if __name__ == "__main__":
    unittest.main()
