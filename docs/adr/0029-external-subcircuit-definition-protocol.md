# 0029 - External Subcircuit Definition Protocol

Status: `accepted`

Date: `2026-08-20`

Owners: `packages/model`, `packages/edit-engine`, `packages/spice`,
`packages/netlist`, `packages/symbols`, `apps/editor`

## Context

An imported or manually entered call such as `X1 d g s b
sky130_fd_pr__nfet_01v8` is an invocation of an external interface, not a
primitive MOS merely because a convenient MOS drawing exists. Previous Project
data stored only a display-oriented external terminal name list, and generated
a symbol only after an instance already referenced it. That made a clean
project unable to author its first external call.

## Decision

`externalSubcircuitDefinitions` is the project-local authority for a
non-emitting external master. A definition has a stable ID, master name,
ordered stable terminals, raw formal parameter defaults, interface status and
optional block presentation. Its array order is the SPICE node order. An
Instance binds it with `{ kind: "external-subcircuit", definitionId }`, must
receive an `X` reference, and owns raw parameter overrides and connectivity.

The external symbol is derived from the immutable definition ID and exists for
every definition, including an unreferenced manually-created one. Renaming a
master therefore changes emitted target text but not symbol identity. Terminal
renames use the edit-engine pin reconciliation projection so connected Nets,
Routes, NoConnects and import mappings stay aligned. Deleting a referenced
definition remains blocked; reordering explicitly changes exported node order.

Unknown imported `X` masters create a generic, `inferred-positional` external
definition. PDK or library mappings may later change presentation, but cannot
change this binding into a model or primitive. This decision deliberately does
not add simulator model resolution, PDK installation, process corners or
external `.subckt` body generation.

## Validation

Focused schema/migration, resolver, edit-engine, SPICE import and DesignNetlist
tests cover placement-ready symbols, terminal reconciliation, `X` preservation
and ordered external nodes.

## Related documents

- [Project file format](../specs/project-file-format.md)
- [Deterministic netlist export](../specs/netlist-export.md)
- [ADR 0027](0027-stage-1-netlist-authoring-protocol.md)
