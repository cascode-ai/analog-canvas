# 0035 - Imported-Net routing guidance

Status: `accepted`

Date: `2026-08-21`

Owners: `packages/model`, `packages/project-protocol`, `packages/spice`,
`packages/derived`, `packages/edit-engine`, `apps/editor`

## Context

SPICE import establishes electrical Net membership before the author has
placed or routed its symbols. Earlier versions overloaded a document-wide
`flightlineGuidance` flag to control whether dashed connection hints rendered.
Any geometry, label, or deletion edit could dismiss every hint, while a manual
Net inside an imported document could accidentally acquire one. The low-level
`make_flightline` edit also deleted Route geometry while retaining Net
membership, so its name incorrectly described a presentation consequence as a
mutation.

## Decision

Schema 19 records guidance eligibility on each Net:

- `origin: { kind: "spice-import", sourceNetIds }` is written by SPICE import;
- `origin: { kind: "authored" }` is written when schema-18 material is
  migrated; missing origin is treated as authored only for transient legacy
  construction;
- merging a Net retains the union of imported source identities; splitting an
  imported Net retains its import origin.

`RoutingGuide` is a non-persisted, device-neutral result of a pure minimum
spanning-tree bridge calculation over visible connectivity components. The
connectivity adapter supplies endpoint points and visibility policy; the
algorithm does not read symbols, MOS/Bulk semantics, SPICE records, labels, or
editor state. Only Nets with `spice-import` origin enter that adapter. Global
named-Nets and implicit pins keep their existing upstream exemptions.

`remove_route_geometry` replaces `make_flightline`. It deletes only a Route's
visible geometry and retains electrical membership. The normal cut/delete
planner may partition an authored local Net; it must retain an imported Net so
guidance is automatically re-derived. There is no persisted “dismiss all
guidance” state.

Guidance presentation is editor-local: `focused`, `all`, or `hidden`. A Net
highlight suppresses only that Net's guidance because the complete highlighted
conductor is stronger feedback. Unplaced endpoints have no fabricated canvas
coordinates; retained imported Instances stay in the Placement Tray until the
author places them.

## Consequences

- Scratch authoring never receives import hints.
- Import placement, route creation, Route deletion, labels, and movement all
  recompute from one connectivity graph instead of changing presentation state.
- Agent and GUI share the same named geometry mutation and typed edit union.
- Schema 18 source-bound documents migrate deterministically. Schema 19 is the
  only canonical saved form.

## Validation

Focused model, protocol, SPICE importer, derived MST, edit-engine, and editor
E2E tests cover imported versus authored Nets, migration, deletion/re-derivation,
per-Net highlight suppression, and the clickable guide-to-Wire flow.

## Related documents

- [Connectivity and routing](../specs/connectivity-and-routing.md)
- [Edit engine](../specs/edit-engine.md)
- [Project file format](../specs/project-file-format.md)
