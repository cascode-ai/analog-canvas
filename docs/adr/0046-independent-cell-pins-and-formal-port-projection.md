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
declaration; that independent-authoring contract remains active.
Each declaration owns exactly one Port Instance, one stable terminal identity,
one name, one direction, and one physical Base Net. Duplicate names are valid.
Placement, rename, copy, direction editing, deletion, and Wire cutting never
couple Cell Pins because their names match. Only an explicitly authored Wire
or exact electrical contact creates a physical connection.

Clipboard duplication creates a fresh terminal and Instance identity for each
copied Cell Pin. It preserves the authored name and direction; duplicate names
remain legal and are grouped only by the read-only Formal Port projection. A
fully selected physical Net may be cloned with the copied circuit, while a
boundary Pin that remains attached to unselected topology keeps that explicit
physical connection. Copy never turns equal text into shared persisted
identity.

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

The persisted `interfaceInstanceIds` field remains a length-one compatibility
shape; it does not authorize several visible markers to share one terminal.
