# ADR 0013: Project Connectivity Index

Status: `accepted`

Date: `2026-08-12`

Owners: `packages/derived` (index), `packages/edit-engine` (mutation boundary),
editor/Agent/ERC/export (consumers)

## Context

The repository has no single read model for electrical connectivity. Today,
schema, `packages/derived` (`endpoint.ts`, `connectivity.ts`,
`resolved-route-geometry.ts`),
`packages/edit-engine`, `apps/editor`, and `packages/agent-routing` each query
endpoint-to-Net membership, visible Route components, and hierarchy relations
independently. The roadmap
(`docs/roadmap/connectivity-routing-debugging-plan.md` §4.3, §5.2) calls this
the first real problem: there is no unified connectivity read model, so
flightlines, net highlight, cross-Cell trace, search, and ERC each re-derive
partial and slightly different facts.

Existing behavior that the index must preserve is pinned by the WP-R0
characterization tests (`packages/derived/src/endpoint.test.ts`,
`routes.test.ts`) and the preservation matrix (roadmap §7). WP-R0 also found a
real sensitivity: the current `deriveFlightlines` emits the same flightline
endpoints and distance whether a visible wire is one Route or two joined at a
`route-anchor`, but its `from`/`to` direction — and therefore the derived
flightline id — is **not** partition-invariant, because the component-pair order
depends on each component's first-node key.

## Decision

Introduce one read-only, derived `ProjectConnectivityIndex` owned by
`packages/derived`, built from a `CircuitProject` and a `SymbolResolver`. It is
the single source of connectivity truth for flightlines, net highlight, trace,
search object indexing, and ERC. It is never persisted, exported, or mutated by
GUI state.

### Frozen interfaces

```ts
interface ProjectConnectivityIndex {
  projectId: string;
  documents: ReadonlyMap<string, DocumentConnectivityIndex>;
  hierarchy: HierarchyConnectivityIndex;
  objectIndex: ProjectObjectIndex; // instance/net/port/route/junction lookup
}

interface DocumentConnectivityIndex {
  documentId: string;
  endpointToNet: ReadonlyMap<EndpointKey, string>;
  nets: ReadonlyMap<string, NetConnectivityRecord>;
  routingGeometry: ResolvedDocumentRoutingGeometry; // see ADR 0014
}

interface NetConnectivityRecord {
  logicalEndpoints: readonly EndpointRef[]; // terminals + ports (electrical truth)
  visibleEndpoints: readonly EndpointRef[]; // subset that participates in visible graph
  routedComponents: readonly RoutedComponent[];
  routes: readonly string[];
  junctions: readonly string[];
  virtualEdges: readonly VirtualConnectivityEdge[];
  flightlines: readonly Flightline[];
}

interface VirtualConnectivityEdge {
  kind: "net-label" | "power-label" | "hierarchy-port";
  from: EndpointRef;
  to: EndpointRef;
  evidence: string; // label text or parent-pin → child-port mapping id
}

interface HierarchyConnectivityIndex {
  // parent instance pin → child Document port edges, see ADR 0015 HierarchyFrame
  edges: readonly HierarchyEdge[];
}

interface ProjectObjectIndex {
  // documentId → object kind → objectId → locator, see ADR 0015
  resolve(documentId: string, objectId: string): ObjectLocator | undefined;
}
```

`EndpointKey`, `EndpointRef`, `RoutedComponent`, and `Flightline` keep their
existing `packages/derived` shapes; the index does not invent new endpoint
identity.

### Three-layer fact model

Each `NetConnectivityRecord` expresses three distinct facts that consumers must
not collapse:

1. **Logical membership** — SPICE/author Net terminals and ports (electrical
   truth, independent of geometry).
2. **Visible routed graph** — connected components of Routes, Junctions, and
   visible Pins.
3. **Virtual connection** — net-label/power-label and hierarchy port edges that
   connect components without a continuous Wire.

A Flightline is derived **only** from the difference between logical membership
and the union of routed + virtual components. "Has Net membership but no drawn
Wire" is not an error; it is an unrouted endpoint expressible as a flightline.

### Ownership and consumer boundary

- Owner: `packages/derived` builds and caches the index.
- Consumers (read-only): flightline overlay, net highlight, cross-Cell trace,
  project search, ERC, formal-export geometry input.
- Mutators: only the Edit Engine changes the persisted facts that invalidate
  the index. No consumer mutates the index.

### Cache and invalidation

The index is cached per Project revision and per Document revision. Editing one
Document rebuilds only that Document's index and the hierarchy edges that touch
it. Pointer move, preview, and selection never rebuild the index. Derived cache
is never written to Project JSON, recovery, or formal export.

### Failure semantics (frozen)

- An unresolved endpoint (unplaced Instance, unknown Symbol/pin, unpositioned
  Port) yields a `null` point and is excluded from the visible graph; it is
  never guessed geometry.
- A geometric crossing never merges Nets, creates a Junction, or splits a Route.
- A variant-hidden or `implicit`-presentation Pin keeps its logical Net
  membership but is excluded from the visible graph and never generates a
  flightline. Hiding a Pin never rewrites its terminal record, merges Nets, or
  implies a device-specific short such as MOS `B=S`.
- Same-name labels are not an automatic merge; they become a typed
  `VirtualConnectivityEdge` only when the author committed the merge or the
  label-union rule already applies.

### Flightline id normalization (resolves the WP-R0 finding)

The index normalizes the flightline id and direction to be partition-invariant:
the flightline `from`/`to` are ordered by `endpointKey` (not by component-pair
order), so the same logical flightline yields the same id whether the visible
wire is one Route or several joined at route-anchors. This is a deliberate,
pinned change from the current `deriveFlightlines` behavior, recorded by the
WP-R0 "pins the current from/to direction per partition" test which R2 will
replace with the normalized expectation.

## Implementation status — 2026-08-17

The current implementation exposes `DocumentConnectivityIndex.routingGeometry`
as the document-level aggregate from ADR 0014. The index cache is keyed by the
persisted document revision and relevant resolver inputs. Consumers must read
this aggregate rather than reconstructing per-route geometry or calling a
compatibility route helper.

The flightline normalization and other staged recovery notes below are retained
as decision history; the accepted runtime interface is the one declared above.
## Alternatives considered

### Alternative A — keep per-consumer derivation

- Benefits: no new module; each consumer already works.
- Costs: flightline/highlight/trace/ERC continue to drift; cross-Cell trace and
  hierarchy-aware search are not expressible without re-deriving in each
  consumer.
- Reason not selected: the drift is the problem the roadmap is solving, and R0
  already proved the partition sensitivity is real.

### Alternative B — persist a connectivity cache

- Benefits: reopen is faster.
- Costs: violates the persistence boundary (roadmap §5.1); creates a second
  source of truth that can disagree with the Project after external edits.
- Reason not selected: rejected explicitly by the roadmap (§2, §5.1).

## Consequences

### Positive

- One connectivity read model for flightline, highlight, trace, search, and ERC.
- Cross-Cell net trace and hierarchy-aware object location become possible.
- The flightline id becomes stable and partition-invariant.

### Negative or limiting

- `packages/derived` gains a larger, cached surface that must be invalidated
  correctly per revision.
- Consumers must migrate one at a time (R10); until then both old and new paths
  coexist behind adapters.

## Compatibility and migration

Additive only until R10. The existing `deriveVisibleConnectivity`,
`deriveNetConnectivity`, `deriveFlightlines`, and `deriveCrossings` remain the
production path. R2 introduces the index and an adapter that compares old vs new
flightline/component output on all existing fixtures. Production flightline
switches to the index only when the diff is empty or differences are explicitly
accepted in this ADR's normalization clause. Old helpers are deleted only in
R10, after `rg` proves no production consumer and characterization parity holds.

No schema change, no fixture change, no Project-file change.

## Validation

- WP-R0 characterization tests keep passing (endpoint, route, crossing,
  partition behavior).
- R2 old/new adapter: for every existing fixture, index-derived flightlines and
  components match `deriveFlightlines`/`deriveVisibleConnectivity` exactly,
  except the accepted id/direction normalization.
- Revision-cache test: editing one Document does not rebuild another Document's
  index.
- Persistence negative test: the index never appears in serialized Project JSON
  or formal export.

## Related documents

- [`../../docs/roadmap/connectivity-routing-debugging-plan.md`](../roadmap/connectivity-routing-debugging-plan.md) §5.2, §8 R2
- [`../specs/connectivity-and-routing.md`](../specs/connectivity-and-routing.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`0014-resolved-route-geometry.md`](0014-resolved-route-geometry.md)
- [`0015-object-locator-and-diagnostic-envelope.md`](0015-object-locator-and-diagnostic-envelope.md)
