# Schematic expression

Owner: Agent reasoning. Strength: guidance. Trigger: placement, hierarchy,
labels, or whole-page composition.

Turn confirmed circuit relationships into a readable textbook/Razavi-style
schematic. These are soft goals unless a validator or user instruction makes
them hard.

## Composition

- Put the main signal path left-to-right and the dominant output toward the
  right. Bend the composition only when feedback or hierarchy reads better.
- Put positive supply above and ground/negative supply below. Use rails or labels
  when full wires would obscure signal structure.
- Place bias and control close to the devices they govern but visually secondary
  to the signal path.
- Reflect true differential or matched relationships locally. Do not make the
  entire page symmetric at the cost of clear flow.
- Keep high-impedance and sensitive nodes short, visually distinct, and free of
  unnecessary label/route clutter.
- Preserve useful whitespace between functional neighborhoods. Density should
  reveal grouping rather than merely minimize area.

## Repetition and hierarchy

Align repeated branches and order them by physical meaning: bit significance,
weight, stage, tap, or signal direction. Keep exceptions near the branch they
modify rather than forcing them into a false regular template.

Use a child Document when it represents a reusable or cognitively independent
block and its formal terminals tell a clearer story than flattened wiring. Do
not create hierarchy only to hide an unresolved layout problem.

## Labels and interface markers

- Keep Instance References, values, and Net labels readable and attached to the
  intended object.
- Move label text within a small local area before moving the electrical object.
- Prefer a label or an ordinary `port` / `port-filled` Instance over a long
  cross-page wire when connectivity remains unambiguous and the signal is
  meaningfully named.
- Make inputs, outputs, clocks, references, and supplies visually discoverable.
- Do not use identical nearby labels as a substitute for an actual Net relation.
- A label-based connection is readable only when the label is attached to the
  relevant local branch/Net. Repeat it only where a reader would otherwise lose
  the relation; prefer one compact rail/trunk or a clear repeated-block boundary
  over labels at every device pin. A page heading or prose caption is not a Net
  label.
- At hierarchy boundaries, show or locally label every visible child-block pin
  role; do not leave common supply, bias, clock, or input pins as unexplained
  stubs.
- Use plain ASCII punctuation for generated explanatory captions unless the
  final render confirms every non-ASCII glyph. Remove any corrupted/missing
  glyph before completion.

## Visual review

Check the formal render at both whole-page and local scale. Confirm that device
symbols, orientation, labels, Junction dots, crossings, hierarchy blocks, and
wire endpoints remain legible. A perfectly aligned drawing that hides feedback,
weights, or device asymmetry is not a successful expression.

Perform a final boundary inventory: map every `Document.netlist.terminals`
entry to its Net and parent block pin, and verify every placed `port` or
`port-filled` Instance through its ordinary pin `P`. Perform the same check for
each shared Net represented by disconnected labeled branches. Then remove
redundant text and check that no label overlaps a symbol, Instance Reference, wire,
or neighboring label. Boundary completeness and low label density are joint
goals.
