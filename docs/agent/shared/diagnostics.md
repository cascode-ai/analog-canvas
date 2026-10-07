# Diagnostic decisions

Use diagnostics from the current revision. Read `category`, `confidence` and
`gateEligible` as well as severity. Structural findings can block under the
applicable quality policy; visual observations with `gateEligible:false` do not
become blockers merely because their severity says warning.

| Finding | Inspect or repair |
| --- | --- |
| Unresolved symbol / unplaced instance | Resolve supported mapping or placement before routing that object; never guess pins |
| Ambiguous Junction | Compare exact Nets and geometry; remove misleading branch placement without changing intended connectivity |
| Constraint violation | Preserve locks and adjust the responsible unlocked area |
| Symbol/label overlap | Compare visible strokes/text in the render; compact placement can be intentional. Free text drawn over a label, or struck through by a wire (`VISUAL_LABEL_CLEARANCE` naming the text first), is reported as a label is; move the text. Text over a part's outline is not reported. Text is measured as DejaVu Sans draws it, side bearings included; a render in Arial, where DejaVu Sans is not installed, shows it narrower |
| Wire through symbol | Check actual strokes and endpoints; bounding-box overlap alone is not proof of a bad wire. A wire running back across the part it starts from is reported as information; route it out of the pin first |
| Route overlap | Same-Net collinear spans may be an intentional shared trunk; remove only redundant/confusing geometry |
| Overlapping Nets (`ERC_OVERLAPPING_NETS`) | Two Nets drawn along one line read as shorted; reroute one wire off the named span, never add a Junction or merge the Nets |
| Terminal departure | Reported where a wire leaves a pin backward, against the pin's direction, or leaves a port, supply or ground from the side with no other wire there; turn the symbol or approach the pin along its direction. A bend at the end of a part's lead, or a trunk running past a pin it taps, is ordinary drafting and is not reported |
| Short segment / outside page | Review readability and intended bounds, not just a threshold |
| Flightline | Route/label the intended relation or disclose a deliberately incomplete view |

Repair the smallest area responsible for a real defect. Preserve clear
crossings; adding a Junction solely to silence a warning changes topology.
Zero findings does not prove readability. Review relevant visual changes in
formal render and report unresolved issues that affect the requested result.
