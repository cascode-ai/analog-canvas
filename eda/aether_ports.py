"""Compare saved graphical port figures, not just logical terminal names."""
from collections import Counter


def graphical_port_readback(terms, layout, object_name, term_net_name, pin_orientation):
    expected = Counter((port["name"], port["netName"], tuple(port["xy"]), pin_orientation(port))
                       for port in layout["ports"])
    actual = Counter()
    for term in terms:
        for pin in term._emyTerm__getPins():
            for figure in pin.getFigs():
                # dbCrtSchPin creates native PIN instances. A different representation
                # needs calibration, never an implicit successful verification.
                if not hasattr(figure, "dbuTransform") or not hasattr(figure, "getOrient"):
                    raise ValueError("Unsupported saved schematic-pin figure; native calibration required")
                transform = figure.dbuTransform
                key = (object_name(term), term_net_name(term),
                       (transform.xOffset(), transform.yOffset()), str(figure.getOrient()))
                actual[key] += 1
    return {"passed": expected == actual,
            "missing": [[key, count] for key, count in (expected - actual).items()],
            "unexpected": [[key, count] for key, count in (actual - expected).items()]}
