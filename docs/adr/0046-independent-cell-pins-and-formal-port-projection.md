# 0046 - Independent Cell Pins and read-only Formal Port projection

Status: `accepted`

Date: `2026-08-26`

Owners: `packages/model`, `packages/project-protocol`, `packages/edit-engine`,
`packages/symbols`, `packages/derived`, `packages/netlist`, `apps/editor`

## Context

The repeated-marker model treated several visible Cell Pins as projections of
one persisted terminal. Matching names during placement or rename could then
merge terminal identity, Base Nets, annotations, caller Nets, direction, and
lifecycle. That made ordinary drawing operations create hidden relationships
which could not be seen from the schematic geometry.

## Decision

Schema 25 introduced every visible Cell Pin as an independent authored
declaration; the contract remains present in current Schema 27.
Each declaration owns exactly one Port Instance, one stable terminal identity,
one name, one direction, and one physical Base Net. Duplicate names are valid.
Placement, rename, copy, direction editing, deletion, and Wire cutting never
couple Cell Pins because their names match. Only an explicitly authored Wire
or exact electrical contact creates a physical connection.

A Formal Port is instead a pure, read-only projection used by hierarchical
symbols, caller interfaces, diagnostics, and netlist extraction. The
projection groups authored Cell Pins by case-insensitive name; the first
declaration fixes group order and displayed spelling. Grouping never mutates
the Project, merges Base Nets, rebinds annotations, or synchronizes member
directions. Same-name member Nets receive the same emitted formal node only in
the exported netlist. A direction conflict is represented in the projection's
issues and uses a passive formal-interface fallback rather than rewriting any
Cell Pin or raising an editing-time ERC warning.

Projection alone is not a live connectivity edge. Selection, highlighting,
routing, and hierarchy tracing do not traverse between same-name member Nets.
A hierarchy edge is available only when independent electrical facts already
resolve every member to the same Logical Net; the Port Name itself is never
that fact.

Rename and deletion reconcile callers against the before/after projected
interface. Changing or deleting one member while its old-name group survives
does not change callers. If the last member leaves a name, that projected pin
is renamed only for a one-to-one new name; joining an already existing name
detaches the disappearing caller pin instead of merging caller Nets.

The schema-24 migration splits every multi-marker terminal into ordered,
single-marker declarations, rebinds marker-owned annotations, and preserves
the existing physical Net, Route, and Junction topology. It does not guess how
an old shared Net should be cut.

## Supersedes

- [ADR 0037](0037-repeated-formal-port-markers.md)
- The one-terminal/many-marker, same-name attachment, and marker-lifecycle
  clauses of [ADR 0043](0043-cell-pin-contract-convergence.md)
- The copy-renaming and explicit name-based merge clauses of
  [ADR 0045](0045-independent-cell-pin-copy.md)

The unified Cell Pin artwork and explicit physical-connectivity decisions in
ADR 0043 remain accepted. The fresh identity and independent lifecycle clauses
of ADR 0045 remain accepted.
