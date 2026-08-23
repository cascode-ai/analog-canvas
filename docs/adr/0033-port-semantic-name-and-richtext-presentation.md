# 0033 - Port semantic names and RichText presentation

Status: `accepted`

Date: `2026-08-21`

Owners: `packages/model`, `packages/derived`, `packages/edit-engine`,
`apps/editor`

Supersedes the formal-Port text-editing clause of
[ADR 0032](0032-formal-port-display-and-retained-annotations.md) and the
non-formal Port reference-display clause of
[ADR 0031](0031-schematic-reference-and-port-lifecycle.md).

## Context

A Port symbol can represent either a free schematic Net Port or a formal Cell
Pin. The former names a Net; the latter also declares an ordered Cell
interface terminal. Treating the Port text as an independent alias lets its
visible name diverge from the electrical object. Treating it as immutable
plain text prevents the RichText formatting already supported by schematic
annotations. Inferring the role solely from whether the active Document is a
child also prevents a free Net Port from being placed inside a Cell.

## Decision

Project schema 18 keeps Port meaning and presentation in separate existing
owners:

- a free Net Port's semantic text is `Net.name`;
- a formal Cell Pin's semantic interface text is `CellTerminal.name`;
- the Port `Instance.id` owns geometry and lifecycle and is never visible;
- a bound `net-name` or `cell-terminal-name` Annotation may persist
  `formatOverride`, but its flattened text must equal the semantic source.

The formatting override is not an alias. A character edit on the canvas
renames the bound Net or CellTerminal. A formatting-only edit changes the
Annotation. Renaming a semantic source clears stale overrides unless the same
atomic edit supplies a new same-text override. Formal terminal renames continue
to reconcile caller pins through the hierarchy planner.

Port insertion carries an explicit `Free Net Port` or `Formal Cell Pin` intent.
Both roles may be used in a child Document; only the free role is available in
the top Document. An explicit inserted name wins. Otherwise a connected named
Net supplies the initial name. Creating onto an unnamed or new Net gives that
Net the entered Port name. A formal terminal and an already named connected
Net may intentionally have different names; there is no permanent equality
constraint between them.

No Port receives a visible schematic `P#` reference or netlist designator.
Legacy internal object IDs may remain lifecycle facts but never become canvas
text.

## Alternatives considered

### Persist a RichText label on CellTerminal

- Benefits: direct ownership appears simple for formal Ports.
- Costs: creates a second semantic-looking name and does not cover free Ports.
- Reason not selected: presentation belongs to the movable Annotation, and an
  independent label can silently diverge from the Net or terminal name.

### Keep child-Document role inference

- Benefits: one-click placement.
- Costs: makes free Ports unavailable inside Cells and hides interface changes
  behind placement context.
- Reason not selected: interface creation is a meaningful explicit action.

## Consequences

### Positive

- Free and formal Ports share one naming/presentation protocol.
- RichText formatting cannot change electrical meaning or export names.
- Canvas character edits, Properties, hierarchy reconciliation, and netlist
  export observe the same semantic owner.
- Port lifecycle remains tied only to `Instance.id` and its bound annotation.

### Negative or limiting

- Bound Port formatting is valid only while its flattened text matches the
  semantic name.
- A semantic rename may discard prior character-level formatting when it
  cannot be carried to the new text safely.
- Port insertion requires a role/name decision when no named Net supplies a
  deterministic default.

## Compatibility and migration

This is part of the unreleased schema-18 contract. `Annotation.formatOverride`
is optional. Existing bound annotations without it continue to render their
semantic source. No `CellTerminal.schematicLabel` field is introduced.

## Validation

Model tests reject mismatched overrides. Derived tests prove semantic fallback
and formatted projection. Edit-engine tests prove rename invalidation and
atomic formal-terminal edits. Browser tests cover explicit free/formal
insertion, formatting-only edits, semantic rename, hierarchy pin
reconciliation, and Placement Tray lifecycle.

## Related documents

- [Schematic model](../specs/schematic-model.md)
- [Edit engine](../specs/edit-engine.md)
- [Editor interaction](../specs/editor-interaction.md)
- [Netlist export](../specs/netlist-export.md)
