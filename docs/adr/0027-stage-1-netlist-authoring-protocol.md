# ADR 0027: Typed netlist authoring authority

Status: `accepted`

Date: `2026-08-19`

Owners: `packages/model`, `packages/devices`, `packages/edit-engine`,
`packages/derived`, `packages/netlist`, `apps/editor`

## Context

Reference, binding, parameter, interface, and imported-source facts once lived
in overlapping property bags, UI registries, and annotations. That made it
unclear which value export, validation, or a semantic edit should trust.

## Decision

For an emitting Instance, `Instance.reference`, `netlist.binding`, and
`netlist.parameters` are the only persisted Reference, target, and raw
parameter authorities. Bindings distinguish primitive/model, internal child
Document, Project-local external subcircuit definition, and unresolved imported
target. Imported terminal mapping, source master name, and source identity are
typed provenance, not editable electrical authority.

Built-in device descriptors own the ordered parameter definitions consumed by
Insert, Properties, validation, canonical Value projection, and export.
Placeholders and annotation text never become implicit parameter values.
Non-emitting markers do not acquire fake References or netlist records.

Internal subcircuit interfaces are derived from the child Document. External
definitions own stable ordered terminals and formal parameters. An unresolved
binding preserves insufficient source evidence but blocks successful analysis;
it is never silently promoted to a resolved external definition.

Semantic field changes use typed Edit Engine operations. Whole-record setters
are limited to initialization and import. An `instance-reference` annotation is
a live RichText projection of `Instance.reference`; ordinary attached literal
text and Value annotations do not create alternate identity or parameter
authority. `analyzeDesignNetlist(Project)` is the single dialect-neutral
extraction boundary used by Preflight and printers; it consumes typed facts,
not geometry or annotation appearance.

## Consequences

- Every exported circuit fact has one persisted source and one semantic edit
  path.
- Property UI and analysis share descriptor-owned parameter definitions.
- Imported uncertainty remains visible instead of masquerading as an authored
  interface.
- Simulation setup, PDK/CDF, layout, and source-text round-trip remain outside
  this schematic-authoring decision.

## Related documents

- [`0024-built-in-device-and-project-boundaries.md`](0024-built-in-device-and-project-boundaries.md)
- [`0025-schematic-hierarchy-and-formal-ports.md`](0025-schematic-hierarchy-and-formal-ports.md)
- [`0029-external-subcircuit-definition-protocol.md`](0029-external-subcircuit-definition-protocol.md)
- [`0054-single-instance-reference-authority.md`](0054-single-instance-reference-authority.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/netlist-export.md`](../specs/netlist-export.md)
