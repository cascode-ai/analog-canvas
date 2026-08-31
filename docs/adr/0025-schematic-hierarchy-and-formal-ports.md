# ADR 0025: Schematic hierarchy and independent Cell Pins

Status: `accepted`

Date: `2026-08-18`

Owners: `packages/model`, `packages/project-protocol`, `packages/edit-engine`,
`packages/derived`, `packages/netlist`, `apps/editor`

## Context

A reusable schematic Cell needs stable interface declarations, visible markers,
safe rename/delete behavior, and occurrence-aware hierarchy traversal. Treating
equal port text as one persisted terminal, or introducing separate drawing and
interface object systems, makes editing and connectivity ambiguous.

## Decision

Each Project Document is one reusable schematic Cell definition. Hierarchy is
an Instance graph: a parent Instance binds to a child Document, and each caller
is a distinct occurrence. The model adds no generic Page, View, Layout, or
library container.

Each authored Cell Pin is an independent persisted terminal with stable ID,
name, direction, Base-Net binding, and exactly one ordinary Port Instance as its
visible marker. Equal folded Cell-Pin names do not merge their Base Nets. They
are grouped only by the derived formal-interface projection, where incompatible
directions or bindings produce an explicit conflict.

Definition-level Cell-symbol presentation is optional and keyed by stable
terminal ID. It controls the appearance of hierarchy Instances without becoming
a second electrical interface. When absent, presentation is derived
deterministically from the Cell terminals.

Structural changes use the Edit Engine's atomic Project transaction boundary.
Rename reconciles callers; deleting a marker and deleting a terminal are
distinct planned operations; deleting a hierarchy Instance never implicitly
deletes its reusable child. Validation rejects missing targets and hierarchy
cycles. Navigation and Net tracing carry concrete occurrence paths and never
guess a parent for a multiply-instantiated definition.

## Consequences

- Cell Pins are independently placeable and wireable while repeated names can
  intentionally describe one formal interface.
- Electrical interface, visible marker, and hierarchy-symbol presentation have
  one-way, explicit relationships instead of duplicated authority.
- Shared child definitions remain reusable and occurrence-aware.
- Future non-schematic views require a separate product decision.

## Related documents

- [`0024-built-in-device-and-project-boundaries.md`](0024-built-in-device-and-project-boundaries.md)
- [`0027-stage-1-netlist-authoring-protocol.md`](0027-stage-1-netlist-authoring-protocol.md)
- [`0029-external-subcircuit-definition-protocol.md`](0029-external-subcircuit-definition-protocol.md)
- [`0054-single-instance-reference-authority.md`](0054-single-instance-reference-authority.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/netlist-export.md`](../specs/netlist-export.md)
