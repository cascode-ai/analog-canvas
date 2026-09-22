# Net Identity and Connectivity Evidence

Status: `accepted`

Owners: `packages/model`, `packages/derived`, `packages/edit-engine`, `packages/netlist`

## Decision

Persist connection facts and authored owners; derive physical membership,
logical equivalence, readiness and occurrence-aware lookup.
[Project file format](../specs/project-file-format.md#one-connection-source),
[Schematic model](../specs/schematic-model.md#electrical-authority)
and [connectivity](../specs/connectivity-and-routing.md) own these rules.
[Editor interaction](../specs/editor-interaction.md) owns check/navigation
lifecycle; [netlist export](../specs/netlist-export.md#net-rules) owns spelling.

## Context

Physical connection, named equivalence, hierarchy occurrence and source
provenance answer different questions. Conflating them can reconnect a cut,
short two reused Cells or declare an isolated pin connected.

## Rationale

Owner-addressed claims explain why separated conductors share a Logical Net.
Removing an owner removes its authority; imported provenance alone cannot
resurrect a connection. Ground, supply markers and labels therefore need no
parallel Net system. Supply role classifies intent, not identity, and a hidden
MOS bulk cannot acquire a connection merely from device polarity.

Physical split precedes logical resolution for every cut. Repairing only ERC
would leave export describing a connection the user removed. Endpoint readiness
is derived because membership alone does not prove an external peer, and a
persisted readiness object would become another stale electrical protocol.

A shared connectivity index, locator and diagnostic envelope prevent consumers
from inventing separate meanings or repeatedly scanning whole Documents.
Occurrence paths distinguish callers of one child definition. Derived Net
representatives are revision-scoped, so consumers refresh rather than pretending
a split or merge preserved a permanent Logical-Net identity.

Electrical failures and visual observations remain distinct evidence. Check
results belong to a revision; stale navigation must not target a different
object, and findings must not block saving unfinished work.
