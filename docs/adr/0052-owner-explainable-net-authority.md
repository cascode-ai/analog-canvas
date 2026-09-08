# ADR 0052: Owner-explainable Net authority

Status: `accepted`

Date: `2026-08-31`

Owners: `packages/model`, `packages/derived`, `packages/edit-engine`,
`packages/spice`, `packages/netlist`, `packages/project-protocol`

## Context

Physical connectivity, user-authored Net names, formal interfaces, global
supplies, and imported source spelling are different facts. Earlier ownerless
equivalence and source-name claims could reconnect cut topology or short two
composed circuits without any selectable schematic object explaining why.

## Decision

A Base Net records physical membership only. Routes, direct contacts, endpoints,
and the common split/merge pipeline determine that membership.

Cross-Base-Net Logical Nets are a derived view. They may be explained only by:

1. matching owner-addressed name claims from visible Net Labels or power
   markers in the applicable scope;
2. explicit global declarations, including SPICE node `0`; or
3. the derived formal-interface grouping of equal folded Cell-Pin names.

There is no generic persisted Net-equivalence record and no ownerless editable
name property. Deleting or renaming the last owner immediately removes that
claim; cutting a Wire always partitions physical Base Nets before logical
equivalence is reconsidered.

`spice-source` and `net-name-hint` are provenance only. They may preserve source
identity and preferred export spelling, but never join, protect, conflict, or
name a Logical Net. Export first uses an authoritative current name. An unnamed
Net may reuse one unambiguous valid hint; collisions are deterministically
disambiguated or replaced with generated names and a diagnostic.

Compatibility adapters may translate older records into these current facts,
but ambiguous ownerless electrical equivalence is rejected rather than silently
retained. Runtime editing and derivation consume only the current contract.

## Consequences

### Named power and MOS bulk

VDD, Ground, free ports, Net Labels, and power-rail labels use the same
owner-addressed name-claim mechanism. Multiple disconnected markers are valid;
their Base Nets stay physical while their names and scopes determine Logical
Net equivalence. VDD, AVDD, and DVDD are distinct names. Power-domain metadata
classifies a claim; it is not Net identity and never collapses differently named
supplies. Ground's explicit reference is global node `0`.

A power rail is a drawing form of a named conductor, not a second electrical
system. Scope is authored explicitly; UI power defaults do not make arbitrary
imported text global. Deleting the last owner removes its authority and permits
ordinary orphan pruning. Scope and dialect spelling follow
[ADR 0056](0056-derived-net-scope-and-dialect-spelling.md).

MOS bulk resolves from explicit B membership or an explicitly configured Cell
bulk default. Without either it remains unresolved. Device polarity and supply
artwork alone cannot invent a Net, short B to S, or suppress a floating-bulk
finding. The resolver must reevaluate defaults as their targets are removed;
compatibility data is interpreted only through the current effective-bulk
contract. Three-terminal presentation never deletes the electrical B terminal.

### Shared authority

- Every non-physical electrical union is explainable by a visible owner, a
  formal Cell Pin, or an explicit global declaration.
- Imported spelling survives round-trip without becoming hidden connectivity.
- Split, copy, composition, and owner deletion cannot resurrect stale Nets.
- ERC, highlight, trace, and export can share one Logical-Net resolver.

## Related documents

- [`0041-physical-cut-and-endpoint-readiness.md`](0041-physical-cut-and-endpoint-readiness.md)
- [`0053-chain-carried-project-compatibility.md`](0053-chain-carried-project-compatibility.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/connectivity-and-routing.md`](../specs/connectivity-and-routing.md)
- [`../specs/netlist-export.md`](../specs/netlist-export.md)
