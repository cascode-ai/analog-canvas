# ADR 0037: Repeated Formal Port Markers

Status: accepted

Date: 2026-08-21

Owners: `packages/model`, `packages/project-protocol`,
`packages/edit-engine`, `packages/netlist`, `apps/editor`

## Context

ADRs 0031 through 0034 model a formal Cell interface token as one
`CellTerminal` associated with one ordinary Port Instance through
`interfaceInstanceId`. This makes the electrical interface deterministic, but
prevents a schematic from showing the same formal pin at several convenient
locations. Copying its visible marker would otherwise duplicate the formal
interface token or create a marker whose label and lifecycle no longer have a
formal owner.

Named power and MOS bulk semantics are already decided by ADR 0036. This ADR
does not reopen those decisions.

## Decision

Port symbols remain ordinary single-pin Instances. One formal `CellTerminal`
owns one or more `interfaceInstanceIds`; every listed Instance must be a
`port` or `port-filled` marker whose `P` terminal belongs to the
`CellTerminal.netId`. A marker cannot belong to two formal terminals.

All markers owned by one terminal are visual projections of the same ordered
interface token:

- they share the terminal name, direction, Net, and caller pin;
- each marker owns its own object-anchored annotation;
- each annotation binds to the shared `cell-terminal-name` semantic text;
- netlist export emits the `CellTerminal` exactly once;
- copying a marker appends the copied Instance ID to the existing terminal;
- returning a marker to the Placement Tray retains the terminal and marker
  association.

Deleting one repeated marker removes that Instance, its Net membership, and
its owned annotation, then removes only its ID from the terminal. Deleting the
final marker removes the formal terminal through the existing Project
structural transaction and retains the existing caller-safety checks.

Project schema 20 replaces singular `interfaceInstanceId` with non-empty
`interfaceInstanceIds`. The bounded schema-19 reader upgrades every singular
ID to a one-element array without changing topology. No new Port collection,
endpoint kind, or mutation protocol is introduced.

## Consequences

- A Cell can show the same formal pin in several schematic regions without
  duplicating its interface or netlist pin.
- Existing schema-19 projects migrate losslessly.
- Consumers treat formal marker ownership as membership rather than equality
  against one privileged Instance ID.
- Agent Snapshot receives the array mechanically; no new Agent capability is
  added.

## Validation

- schema-19-to-20 migration and strict schema tests;
- repeated-marker creation, copy, deletion, and caller-safety tests;
- annotation, hierarchy, import, export, and round-trip tests;
- browser coverage for repeated formal marker copy/delete behavior.

## Related documents

- [ADR 0033](0033-port-semantic-name-and-richtext-presentation.md)
- [ADR 0034](0034-top-cell-formal-port-and-free-port-export.md)
- [ADR 0036](0036-named-power-and-mos-bulk-semantics.md)
- [Schematic model](../specs/schematic-model.md)
- [Edit engine](../specs/edit-engine.md)
