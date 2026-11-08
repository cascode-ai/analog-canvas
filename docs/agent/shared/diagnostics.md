# Diagnostic decisions

Use current-revision diagnostics and read `category`, `confidence` and
`gateEligible` beside severity: structural findings can block under the quality
policy; observations with `gateEligible:false` never block.

| Finding                               | Inspect or repair                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unresolved symbol / unplaced instance | Resolve mapping or placement before routing it; never guess pins                                                                                                                                                                                                                                                                                                             |
| Ambiguous Junction                    | Compare exact Nets and geometry; remove misleading branch placement without changing intended connectivity                                                                                                                                                                                                                                                                   |
| Constraint violation                  | Keep locks; adjust the responsible unlocked area                                                                                                                                                                                                                                                                                                                             |
| Symbol/label overlap                  | Compare strokes and text in the render. Parts meeting pin to pin (a supply T, a coil on a source) are not overlap. Free text over a label or struck by a wire is reported (`VISUAL_LABEL_CLEARANCE`, text first): move the text. Text over an outline is not reported. Text is measured in the served Metropolis face (DejaVu for Greek/math), as the editor and PNG draw it |
| `VISUAL_LABEL_RUN_ON`                 | Two parts' labels on one row less than a figure apart read as one string; move one. Information only; one part's own labels are exempt                                                                                                                                                                                                                                       |
| Wire through symbol                   | Check strokes and endpoints; box overlap is not proof. A wire running back across its own part is information: route it out of the pin first                                                                                                                                                                                                                                 |
| Route overlap                         | Same-Net collinear spans may be a shared trunk; remove only redundant geometry                                                                                                                                                                                                                                                                                               |
| `ERC_OVERLAPPING_NETS`                | Two Nets along one line read as shorted; reroute one off the span, never add a Junction or merge Nets                                                                                                                                                                                                                                                                        |
| `ERC_UNDRIVEN_GATE_NET`               | Every pin only senses voltage (gates, bulks, block inputs). Wire it to the bias, source or Cell Pin meant to drive it; a label is not a driver; never add a part just to silence it                                                                                                                                                                                          |
| Terminal departure                    | A wire leaves a pin backward, or a port/supply/ground from the side with no other wire there; turn the symbol or approach along the pin. A bend at a lead's end, or a trunk past a tapped pin, is not reported                                                                                                                                                               |
| Short segment / outside page          | Review readability and intended bounds                                                                                                                                                                                                                                                                                                                                       |
| Flightline                            | Route or label the relation, or disclose a deliberately incomplete view                                                                                                                                                                                                                                                                                                      |

Repair the smallest responsible area. Keep clear crossings; a Junction added
to silence a warning changes topology. Zero findings does not prove
readability: review visual changes in a formal render and report issues that
affect the result.

## Response contract

Every operation answers so the next call needs no guessing, blind retry or
source reading; new actions keep these rules:

- **A refusal** names the cause, the object in the way and a concrete next
  step (the field or action to change, e.g. ambiguous names' candidate
  IDs).
- **A success** returns what the next call needs: created IDs, resolved
  references, label annotation IDs and pin landings.
- **A success that changed nothing** answers `applied:false` with an
  information finding, `NOTHING_CHANGED` unless the command gives its own
  reason (`LABELS_LEFT_IN_PLACE`); never a bare `ok`.
