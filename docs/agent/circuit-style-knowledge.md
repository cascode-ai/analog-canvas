# Schematic layout lookup

Use these tables for Razavi/textbook-style drawing. The Agent selects matching
structures from actual pins/Nets; the user need not supply YAML or coordinates.
These are visual defaults, not electrical evidence, API enums or edit gates.
Choose device orientation before routing; prefer a clear common line over a
detour. Leave space for structure and labels, not uniform gaps everywhere.

## Structure

| Structure | Layout | Wiring |
| --- | --- | --- |
| Differential pair | Left/right symmetry; corresponding pins aligned | Shared tail: T-join |
| Current mirror | Adjacent branches; reference gate faces inward toward output gates | Common-gate line where clear; reference branch local closure |
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
| Symmetry | Named pair about a named axis; center shared taps where practical, not the whole circuit |
| Alignment | Corresponding pin landings; use body centers only when intended |
| Above / below | Relative to the named group, with pin/label clearance |
| Left-to-right | Main signal stages in order |
| Adjacency | Compact functional groups; series elements close together with label/exit clearance |
| Equal spacing | Named repeated sequence only; preserve electrical/tap order |
| Supply layout | Positive rail above, ground/negative below when appropriate; retain a visible supply name |

## Wiring

| Shape | Use |
| --- | --- |
| Direct | Short port leads near their pins; matching inputs use equal leads; no detour through another group |
| T-join | Local shared node; e.g. short tail crossbar with centered drop |
| Trunk + taps | Reuse a clear aligned pin row for common control; a separate spine only when needed; same-node exits join nearby branches |
| Local closure | Short reference/diode connection beside its owner |
| Separate return | Feedback/compensation corridor distinct from forward signal |

Plan branched Nets as a whole: spine, taps, exits. Branches use Junctions;
bends and unconnected crossings stay dot-free. Prefer orthogonal paths; other
angles remain valid. Bound Net labels may replace distant wires, not free text.
Common lines must not pass through Symbol bodies or unrelated pins; alignment
does not justify backtracking through a pin's owner. Use local taps if needed.

## Example: two-stage amplifier

Typical NMOS-input, mirror-loaded, single-ended topology; not a fixed template:

| Layer | Composition |
| --- | --- |
| Structure | Differential pair + mirror load + tail source -> common-source second stage; cross-stage compensation |
| Layout | Pair symmetric; load above; tail below on the same axis; second stage adjacent right; bias reference faces inward |
| Wiring | Top supply trunk; centered mirror tap and tail T-join; short equal input leads; local reference closure; separate compensation return with nearby output exit |

## Apply and review

Reuse pin anchoring, alignment/mirror, direct wires and `route-net` with a trunk;
no new layout language. Tool details live in [authoring](shared/authoring.md).
Use default attached device labels; free text is for notes. Preserve existing
manual positions and formatting unless explicitly asked to change them.
For a topology-focused view, parameter displays may be hidden when requested;
do not erase device values or custom displays merely to make a drawing sparse.
Do not add duplicate supply Ports/Pins for appearance. Check the render for
alignment, legible labels and unnecessary bends without changing connectivity.
