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
| Symbol/label overlap | Compare visible strokes/text in the render; compact placement can be intentional |
| Wire through symbol | Check actual strokes and endpoints; bounding-box overlap alone is not proof of a bad wire |
| Route overlap | Same-Net collinear spans may be an intentional shared trunk; remove only redundant/confusing geometry |
| Terminal departure | Inspect for hooks or reversal; deliberate bends are not automatically wrong |
| Short segment / outside page | Review readability and intended bounds, not just a threshold |
| Flightline | Route/label the intended relation or disclose a deliberately incomplete view |

Repair the smallest area responsible for a real defect. Preserve clear
crossings; adding a Junction solely to silence a warning changes topology.
Zero findings does not prove readability. Review relevant visual changes in
formal render and report unresolved issues that affect the requested result.
