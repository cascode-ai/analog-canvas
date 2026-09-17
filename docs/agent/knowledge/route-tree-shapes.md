# Visible Net shapes

Choose the expression that makes a Net's actual endpoint relationship clear.
These are drawing choices, not API enums or a required RouteGraph workflow.

| Shape | Useful when | Avoid |
| --- | --- | --- |
| Direct wire | Two nearby endpoints share an obvious relation | Long detours through unrelated stages |
| Local branch | Gates, drains or a tail form one local node | Several tiny dots/boxes that falsely suggest extra stages |
| Trunk or rail | Ordered consumers share a bias, supply or control | A dominating bus cutting through device bodies |
| Labeled local islands | A distant connection is clearer without a cross-page wire | Unattached captions, ambiguous stubs or excessive labels |
| Ordered taps | Bit weight, ladder order or stage sequence matters | Ordering inferred only from names or current coordinates |
| Feedback return | A return path is central to understanding function | Indistinguishable bundles hiding which node drives which |

Combine shapes where appropriate. Pick corridors after checking symbol exits,
labels and locks. Prefer orthogonal wiring for readability when suitable; free
angles are supported by the wire planner, not an electrical error. Review the
formal render rather than treating a shape or a low crossing count as acceptance.
