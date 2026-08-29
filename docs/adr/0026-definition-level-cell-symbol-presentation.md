# 0026 - Definition-level Cell symbol presentation

Status: `accepted`

Date: `2026-08-18`

Owners: `packages/model`, `packages/project-protocol`, `packages/symbols`,
`packages/edit-engine`, `packages/agent-adapter`, `apps/editor`

## Context

ADR 0025 established a complete electrical hierarchy contract in Project schema
12: a Document is a reusable Cell, its formal terminals are stable ordinary
Port-Instance-backed objects, and a caller is an ordinary subcircuit Instance.
The initial derived hierarchy block, however, has fixed geometry and no
definition-level way to state where a formal terminal should appear. Persisting
parent-local coordinates or arbitrary block artwork would duplicate the Symbol,
Instance, Route, and renderer authorities already retained by ADR 0025.

## Decision

A Cell Document may persist optional
`presentation.cellSymbol` intent containing a minimum body size and unique
stable-terminal `side`/grid-offset placements. Electrical terminal direction
remains separate from visual side. The child canvas Port marker position does not
determine the parent-block pin position.

`@icm/symbols` deterministically derives the rectangular block, pin anchors,
and leads from formal terminals and this intent. Unspecified inputs default
west, outputs east, and passive/inout terminals balance across those sides;
north/south positions are explicit. Generated primitives and parent-local pin
coordinates are never persisted. No name-based supply inference or implicit
hidden-pin policy is introduced.

`set_cell_symbol_presentation` is the one typed SchematicEdit for the intent.
It is submitted through the existing Project structural transaction so GUI and
Agent use the same mutation contract. A definition geometry change compares
the old and new Symbol resolvers and reuses ordinary `set_route_points` route
following for affected caller Instances; it adds no endpoint kind and changes
no logical Net membership.

## Alternatives considered

### Persist pin coordinates on each caller Instance

- Benefits: independent caller drawings.
- Costs: breaks definition reuse and makes a terminal rename/move a projectwide
  geometry migration.
- Reason not selected: a formal Cell has one symbol definition in this product.

### Add a free-form symbol editor or a generic Cell/View model

- Benefits: arbitrary artwork and future layout views.
- Costs: duplicates the existing Symbol DSL and exceeds the schematic-only
  boundary.
- Reason not selected: side/offset plus adaptive geometry covers the current
  hierarchy authoring need.

## Consequences

### Positive

- External pins are adjustable without weakening stable electrical identity.
- Render, hit, export, and routing continue to use one resolver and one Route
  endpoint model.
- Style profiles retain ownership of line and typography treatment.

### Negative or limiting

- A Cell has one definition-level block presentation and no per-instance pin
  override.
- Generated hierarchy artwork is Razavi-compatible only where the reference
  manifest has no hierarchy-block witness.

## Validation

- strict intent, unknown-terminal, duplicate-terminal, and duplicate-slot
  schema tests;
- current/previous parse, save, and reopen tests;
- deterministic geometry tests for direction, explicit placement, long names,
  and grid alignment;
- Project transaction and Agent parity tests, including caller Route follow.

## Related documents

- [`0025-schematic-hierarchy-and-formal-ports.md`](0025-schematic-hierarchy-and-formal-ports.md)
- [`0023-rolling-previous-project-compatibility.md`](0023-rolling-previous-project-compatibility.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/edit-engine.md`](../specs/edit-engine.md)
