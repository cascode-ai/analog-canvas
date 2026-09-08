# ADR 0013: Project connectivity index

Status: accepted

Date: 2026-08-12

Owners: `packages/derived` (read model), `packages/edit-engine` (mutations)

## Context

Independent connectivity scans in rendering, routing guidance, search, trace,
and ERC drift in both meaning and cost. Persisting their answers would create
another electrical authority and require repairing caches after every edit.

## Decision

`ProjectConnectivityIndex` is a pure, non-persisted read model built from the
Project and symbol resolver. The authoritative interfaces live in
[connectivity-index.ts](../../packages/derived/src/connectivity-index.ts);
this ADR does not duplicate their field declarations.

The index distinguishes:

- endpoint-to-Base-Net physical membership;
- the owner-explainable Logical-Net view and lookup from each Base Net;
- resolved Route/contact components and shared Document geometry;
- explicit project-global grouping and hierarchy-interface edges;
- object locators and imported routing guidance.

Source provenance may support routing guidance, but is not an electrical union.
A dashed guide is neither a Wire nor proof of an ERC failure. Hidden pins keep
their electrical facts while being excluded from visible geometry/guidance;
visibility never implies MOS `B=S`.

Document results are cached against Document identity, revision, and resolver.
Unchanged Documents can reuse their derived context; Project aggregation builds
the hierarchy, globals, and object lookup from those contexts. This does not
promise constant-time Project rebuilding or persist a cache. Guidance is derived
once per Document, not once for every Net. Selection cannot become electrical
input to the index.

Hierarchy edges describe Cell interfaces; traversal carries occurrence context
so separate instances of one definition are not conflated. Logical-Net IDs
are revision-scoped representatives, not permanent identities across split/merge.

## Consequences

Consumers share derived facts and tests without owning a competing connectivity
protocol. Only typed edits mutate the underlying Project. Crossings remain
disconnected unless an explicit operation establishes contact. Export and ERC
can interpret the same electrical facts while imposing different readiness rules.

Cache invalidation and aggregation cost remain engineering obligations, covered
by connectivity-index tests and the [performance budgets](../specs/performance.md).
Rendering and geometry retain the boundary in
[ADR 0014](0014-resolved-route-geometry.md); naming authority follows
[ADR 0052](0052-owner-explainable-net-authority.md).

## Related documents

- [Connectivity and routing](../specs/connectivity-and-routing.md)
- [Object location and diagnostics](0015-object-locator-and-diagnostic-envelope.md)
- [Schematic model](../specs/schematic-model.md)
