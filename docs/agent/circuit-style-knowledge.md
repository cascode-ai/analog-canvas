# Schematic expression

Use for placement, labels, routing or a requested Razavi/textbook-style review.
These are visual preferences, not electrical constraints or physical-layout
rules. Short schematic wires do not establish low parasitics or device matching.

## Compose the circuit

Prefer left-to-right signal flow, positive supply above and ground/negative
supply below when that clarifies the circuit. Keep bias and control secondary
but locally discoverable. Group related devices and leave useful route/label
corridors. Preserve genuine local symmetry without concealing unequal loads,
body domains, feedback or calibration branches.

Order repeated branches by weight, bit, stage or tap rather than object names.
Use hierarchy for reusable functional boundaries, not to hide unresolved wiring.
For topology-specific composition see [pattern expressions](knowledge/patterns.md);
for large or reused Cells see [hierarchy](knowledge/hierarchy-and-large-circuits.md).

## Express nodes and labels

A real branch has an explicit Junction; direction changes use dot-free bends;
unconnected crossings remain dot-free. Several nearby dots joined by tiny
segments can make one functional node look like several. Consolidate only when
the electrical relationship and resulting drawing support it.

Choose a clear [route shape](knowledge/route-tree-shapes.md). Attached Net labels
can replace a long cross-page wire, but prose captions and unlabeled stubs cannot.
Every visible child-block pin needs a discernible connection or local identity;
do not repeat labels at every pin when a compact rail communicates the relation.

Use [native authoring](shared/authoring.md) for Reference/Value displays and Net
names. Move attached text locally before disrupting a clear device layout. Keep
labels outside terminal escapes and dense corridors. Use canonical RichText or
the chosen tool's supported text shorthand; never assume underscore parsing
creates subscripts. Inspect actual glyphs/formulas in the render, without an
ASCII-only restriction.

## Review the changed view

At page scale, check signal flow, functional grouping, boundaries and whitespace.
At local scale, check shared nodes, labels and terminal exits. Investigate hooks,
tiny boxes and reversals: they may come from duplicated branches, an incorrectly
placed bend/Junction, or route stretch after movement. Confirm the endpoints,
repair the visible relation, then refine coordinates. Do not erase connectivity
to make the picture cleaner. Diagnostic policy is defined separately in
[diagnostics](shared/diagnostics.md), not by aesthetic counters.
