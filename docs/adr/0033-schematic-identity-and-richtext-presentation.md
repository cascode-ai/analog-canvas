# 0033 - Schematic identity and RichText presentation

Status: `accepted`

Date: `2026-08-21`

Owners: `packages/model`, `packages/derived`, `packages/render-svg`,
`packages/edit-engine`, `apps/editor`

## Context

Internal object identity, emitted netlist identity, canvas Reference text, Cell
interface names, and rich visual presentation serve different consumers.
Collapsing them into one string made a visual rename change export, exposed
opaque IDs, and gave non-emitting Cell Pins fabricated device references.

## Decision

The authorities remain distinct:

- `Instance.id` is opaque persisted object identity and is never drawn;
- `Instance.netlist.reference` is an emitted SPICE/Spectre designator for an
  emitting device or subcircuit call;
- `Instance.schematicReference` is the editable canvas Reference for an
  ordinary Instance;
- `Instance.schematicName` is optional RichText-capable presentation intent;
- `CellTerminal.name` is the authored Cell Pin and projected Formal Port name.

The generic instance label resolves from schematic presentation facts and may
fall back to an emitted reference, never to `Instance.id`. A Cell Pin instead
shows its terminal name, has no fabricated schematic/netlist reference, and
edits only its own independent declaration. Equal Cell Pin names affect the
read-only Formal Port projection, not persisted identity or connectivity.

All editable labels use the canonical RichText system. Formatting-only edits
change presentation without changing the semantic source string. A character
edit of a Cell Pin label renames that one terminal through the structural
planner. A character edit of a Net Label changes its owner-addressed Net claim.

Object-anchored annotations survive placement-tray retention but are hidden and
not hit-testable while their Instance is unplaced. Permanent deletion removes
owned presentation together with the object through the common lifecycle plan.

## Consequences

- Canvas naming cannot accidentally rename emitted netlist designators.
- Cell Pins have one visible semantic name and no `P#` identity artifact.
- RichText formatting and electrical naming remain explicit operations over
  one annotation system.
- Retained annotations cannot appear as orphaned canvas text.

## Validation

- Model and derived tests cover label binding and fallback order.
- Edit Engine tests cover ordinary reference, Cell Pin, and Net Label edits.
- Browser and export tests cover retained visibility and RichText fidelity.

## Related documents

- [`0010-text-annotation-drafting-schema.md`](0010-text-annotation-drafting-schema.md)
- [`0030-instance-identity-and-placement-lifecycle.md`](0030-instance-identity-and-placement-lifecycle.md)
- [`0046-independent-cell-pins-and-formal-port-projection.md`](0046-independent-cell-pins-and-formal-port-projection.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/editor-interaction.md`](../specs/editor-interaction.md)
