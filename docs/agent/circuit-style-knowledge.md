# Schematic layout lookup

Use these tables for Razavi/textbook-style drawing. The Agent selects matching
structures from actual pins/Nets; the user need not supply YAML or coordinates.
These are visual defaults, not electrical evidence, API enums or edit gates.

## Structure

| Structure | Layout | Wiring |
| --- | --- | --- |
| Differential pair | Left/right symmetry; corresponding pins aligned | Shared tail: T-join |
| Current mirror | Reference/output branches adjacent; corresponding pins aligned | Common-gate trunk; reference branch local closure |
| Common-source stage | Gate toward input; drain toward output | Direct signal path |
| Common-gate stage | Stack along its current branch | Branch connection; bias enters from the side |
| Tail current source | Below an NMOS input pair | Centered connection to the shared tail |
| Compensation network | Adjacent to the stages it spans | Separate return corridor |

Apply only the matching topology. PMOS inputs, degeneration, cascodes, unequal
loads and separate body/supply domains may change these defaults; never rewire
the circuit to fit a row.

## Layout

| Term | Relation |
| --- | --- |
| Symmetry | Named pair about a named axis, not the whole circuit |
| Alignment | Corresponding pin landings; use body centers only when intended |
| Above / below | Relative to the named group, with pin/label clearance |
| Left-to-right | Main signal stages in order |
| Adjacency | Nearby groups with room for exits, labels and branches |
| Equal spacing | Named repeated sequence; preserve electrical/tap order |
| Supply layout | Positive rail above, ground/negative below when appropriate |

## Wiring

| Shape | Use |
| --- | --- |
| Direct | Two endpoints; no detour through another group |
| T-join | Local shared node; e.g. short tail crossbar with centered drop |
| Trunk + taps | Supply, bias or common control; ordered branches off one spine |
| Local closure | Short reference/diode connection beside its owner |
| Separate return | Feedback/compensation corridor distinct from forward signal |

Plan branched Nets as a whole: spine, taps, exits. Branches use Junctions;
bends and unconnected crossings stay dot-free. Prefer orthogonal paths; other
angles remain valid. Bound Net labels may replace distant wires, not free text.

## Example: two-stage amplifier

Typical NMOS-input, mirror-loaded, single-ended topology; not a fixed template:

| Layer | Composition |
| --- | --- |
| Structure | Differential pair + mirror load + tail source -> common-source second stage; cross-stage compensation |
| Layout | Pair symmetric; load above; tail below; second stage right; bias aside |
| Wiring | Top supply trunk; short tail T-join; local mirror reference closure; separate compensation return |

## Apply and review

Reuse pin anchoring, alignment/mirror, direct wires and `route-net` with a trunk;
no new layout language. Tool details live in [authoring](shared/authoring.md).
Use default attached device labels; free text is for notes. Preserve existing
manual positions and formatting unless explicitly asked to change them.
Do not add duplicate supply Ports/Pins for appearance. Check the render for
alignment, legible labels and unnecessary bends without changing connectivity.
