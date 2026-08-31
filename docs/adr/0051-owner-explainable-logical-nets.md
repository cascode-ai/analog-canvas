# ADR 0051: Owner-explainable Logical Nets

Status: accepted

Date: 2026-08-31

Owners: `packages/model`, `packages/derived`, `packages/edit-engine`,
`packages/project-protocol`

## Context

The editor separates physical Base Nets from derived Logical Nets so repeated
Net Labels and power markers can name disconnected drawing regions without
destructively merging their topology. ADR 0040 established that separation,
but also admitted an `explicit-equivalence` evidence record that could union
arbitrary Base-Net IDs without a Label, marker, terminal mapping, physical
conductor, or production authoring operation.

No product path ever created that record. It remained reachable through the
persisted schema, resolver, Clipboard transport, and low-level evidence edits,
so imported JSON could carry an invisible electrical edge that users could not
inspect or remove from the schematic. Preserving it during split, merge,
deletion, and cross-Document composition also required a second connectivity
lifecycle unrelated to any authored object.

## Decision

The runtime has these connectivity authorities:

1. A **Base Net** is one physical topology component: terminal membership plus
   Routes and Junctions that reference its stable ID. Physical contact may
   merge Base Nets; cutting the last physical path partitions them.
2. **Connectivity Evidence** describes one Base Net at a time. A `name-claim`
   records a typed naming source, scope, and optional power role. A
   `spice-source` record is import provenance only and never creates electrical
   identity.
3. A **Logical Net** is a pure derived class. Distinct Base Nets join only when
   they carry matching folded names in the same scope. Conflicting claims on
   one resulting group remain errors; no claim silently wins.
4. Cross-Document electrical identity is expressed by explicit hierarchy
   terminals and instance bindings, not by Document-local evidence edges.

There is no generic persisted equivalence edge. Schema 33 removes
`explicit-equivalence` from `ConnectivityEvidence`, the Logical-Net resolver,
typed edits, deletion/reset handling, simulation, and Clipboard transport.

This decision does not settle the separate authoring policy for
`explicit-net-property`. It remains a typed name source used by current import
and naming paths, but it cannot express an unnamed or arbitrary Base-Net union.

## Alternatives considered

### Keep `explicit-equivalence` as an internal escape hatch

- Benefit: future features could union arbitrary Base Nets without another
  schema change.
- Cost: every consumer must preserve an invisible electrical edge with no
  authoring owner or deletion gesture.
- Reason not selected: speculative flexibility does not justify ambiguous
  persisted connectivity.

### Convert each record to `explicit-net-property`

- Benefit: the existing name resolver could preserve some unions.
- Cost: unnamed equivalence has no name to materialize, while named conversion
  would invent a naming authority and could conflict with visible claims.
- Reason not selected: migration must not guess electrical intent.

### Physically merge member Base Nets

- Benefit: connectivity would survive without an evidence record.
- Cost: this would claim disconnected geometry is one physical component and
  would rewrite stable Net references across Routes, terminals, and owners.
- Reason not selected: logical evidence cannot be promoted into physical fact.

## Consequences

### Positive

- Every multi-Base-Net Logical Net is explainable by its scoped name claims.
- Cutting geometry always partitions Base Nets without a hidden edge keeping
  them electrically joined.
- Merge, deletion, reset, Clipboard, and simulation no longer maintain a
  second ownerless relation lifecycle.
- The Agent and Project schemas cannot author or persist arbitrary unnamed Net
  unions.

### Negative or limiting

- A future Alias feature must introduce an explicit user-visible owner and
  lifecycle rather than reusing a generic union record.
- A schema-32 file containing ownerless equivalence cannot be upgraded
  automatically because its intended replacement is unknowable.

## Compatibility and migration

Schema-32 Projects without `explicit-equivalence` advance to schema 33 by
changing only the version stamp. If an occurrence exists, the migration fails
at its exact `documents[*].connectivityEvidence[*]` path and instructs the
author to replace it with physical topology, owner-addressed Net Labels, or
hierarchy terminals. The migration never silently drops the edge, merges Base
Nets, or invents a name.

Canonical schema-33 validation rejects the retired record. Current fixtures,
Agent schemas, MCP resources, and saved examples use schema 33.

## Validation

- Model schema tests prove the current evidence union has no equivalence
  member.
- Migration tests prove ordinary schema-32 files upgrade and ambiguous files
  fail with a precise diagnostic.
- Logical-Net tests prove source provenance remains non-electrical and matching
  scoped names remain the only cross-Base-Net union rule.
- Edit Engine, simulation, Clipboard, generated-contract, and compatibility
  suites compile and pass without the retired shape.

## Related documents

- [Schematic Model](../specs/schematic-model.md)
- [Connectivity and Routing](../specs/connectivity-and-routing.md)
- [Project File Format](../specs/project-file-format.md)
- [ADR 0041](0041-physical-cut-and-endpoint-readiness.md)
- [ADR 0044](0044-imported-source-provenance.md)
