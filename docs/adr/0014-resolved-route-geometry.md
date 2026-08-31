# ADR 0014: Resolved Route Geometry

Status: `accepted`

Date: `2026-08-12`

Owners: `packages/derived` (geometry), `packages/render-svg` + editor + export
(consumers)

Implementation status: `implemented` (R10, 2026-08-17)

## Context

At the time of this decision there was no single resolved geometry for a Route.
The stored centerline,
manual path, Agent escape, local/group stretch, the SVG renderer's private
terminal and Junction miter bridges (`packages/render-svg/src/render.ts`),
editor hit targets, segment drag handles, route-marker attachment, and
visual diagnostics each compute or assume slightly different geometry. The
roadmap (§4.3.2, §5.3) identifies this as the second core problem: the same Wire
is seen differently by different consumers, which is why direct-Pin corners and
degree-2 Junction joins can show seams or interactive disagreement.

Two behaviors must be preserved verbatim and are pinned by existing tests:
terminal miter bridges close the anti-alias seam at a direct Pin corner without
adding route geometry (`render.test.ts` "bridges direct terminal corners"), and
a retained degree-2 Junction join renders as one continuous dotless wire even
when stored as two Routes (`render.test.ts` "bridges a retained dotless
degree-two branch corner").

## Decision

Introduce one derived `ResolvedRouteGeometry` per Route, owned by
`packages/derived`. It is the
single geometry truth for rendering, hit testing, segment drag, marker
attachment, visual/routing diagnostics, and formal export. It is never
persisted.

### Frozen interface

```ts
interface ResolvedRouteGeometry {
  routeId: string;
  netId: string;
  centerline: readonly Point[]; // strictly [from, …waypoints, to]
  segments: readonly ResolvedRouteSegment[];
  vertices: readonly ResolvedRouteVertex[];
  endpointJoins: readonly EndpointJoin[]; // terminal miter recipes
}

interface ResolvedRouteSegment {
  address: { routeId: string; segmentIndex: number };
  from: Point;
  to: Point;
  mode: SegmentMode;
}

interface ResolvedRouteVertex {
  index: number;
  point: Point;
  kind: "terminal" | "junction" | "bend" | "route-anchor";
}

interface EndpointJoin {
  kind: "terminal-miter" | "junction-miter";
  at: Point;
  // terminal joins carry pinOutward + routeDirection;
  // Junction joins carry junctionId + the two incident directions.
}
```

### Centerline and joins are separate facts

- `centerline` strictly terminates at real Pin/Port/Junction origins. It is
  never secretly extended by the escape length (manual Wire keeps arbitrary
  bend control; Agent escape is an authoring helper, not stored extra points).
- `endpointJoins` carry exactly the miter bridge strokes the renderer currently
  computes privately: the terminal bridge that closes the direct-Pin corner
  seam, and the degree-2 Junction bridge that renders two stored Routes as one
  continuous dotless wire. Moving the bridges out of the renderer does not
  add waypoints, change topology, or persist extra points.
- A segment address is revision-scoped and positional. It is never persisted as
  an identity across split, insertion, normalization, or stretch.
- Hit tolerance and bounds are consumer-local view concerns; they are not part
  of the electrical route geometry protocol.

### Ownership and consumer boundary

- Owner: `packages/derived` resolves geometry from the connectivity index
  (ADR 0013) and stored Routes.
- Consumers (read-only): SVG renderer, editor hit testing, marker attachment,
  visual/routing diagnostics, formal SVG/PNG/PDF export.
- Mutators: only the Edit Engine changes stored Routes. Its `RouteEditPlan`
  derives the transaction edits and pointer preview from one proposal; the
  geometry resolver remains pure.

### Implemented migration and deletion gate

R10 completed the migration. `routePolyline`, `routeAttachmentPlacement`, and
the derived-package mutation helpers were deleted. Render, editor interaction,
attachment placement, query/tap/crossing reads, and diagnostics consume
resolved geometry; editing operations live in `@icm/edit-engine`.

## Amendment — 2026-08-12 recovery semantics

The initial additive implementation supplies useful centerline and bridge
ingredients, but does not yet implement the frozen interface as written. In
particular, an array `index` is **not** stable across split, insertion,
normalization, or stretch. It is only a revision-scoped positional index and
must not be used as a persistent attachment identity.

R10 deliberately keeps the revision-scoped positional `RouteSegmentAddress`.
It does not introduce synthetic stable IDs or an attachment-remap protocol:
after a structural edit, existing marker recovery follows the persisted anchor
and fallback semantics. `EndpointJoin` remains a raw recipe; the renderer
resolves profile-specific stroke overlap. Document-level retained Junction
joins are exposed by the document routing-geometry aggregate carried by ADR
0013's index.

## Alternatives considered

### Alternative A — leave bridges in the renderer

- Benefits: no change to a working seam fix.
- Costs: editor hit, drag, marker, and export continue to re-derive geometry;
  the seam fix stays coupled to SVG output, so PNG/PDF and hit testing can drift.
- Reason not selected: the roadmap requires one geometry truth; coupling the
  bridge to SVG is what prevents sharing it.

### Alternative B — persist bridge waypoints

- Benefits: renderer becomes stateless about bridges.
- Costs: violates the persistence boundary; silently changes stored topology
  and breaks the "manual Wire is not secretly extended" contract.
- Reason not selected: rejected by roadmap §2 and the preservation matrix.

## Consequences

### Positive

- Render, hit, drag, marker, export, and diagnostics share one geometry.
- Direct-Pin corners and retained degree-2 Junction joins are seam-free across all
  outputs, not just SVG.
- Marker attachment and segment identity become stable across edits.

### Negative or limiting

- Segment address remains revision-scoped; a future stable attachment identity
  needs a deliberate schema and edit migration, not an inferred adapter.

## Compatibility and migration

R10 is a clean cut with no Project-file change: the legacy read and mutation
exports are removed. The renderer consumes `EndpointJoin` recipes directly;
the Edit Engine owns normalization, escape authoring, segment movement, and
stretch planning.

## Validation

- Characterization tests pin centerline, endpoint joins, route tap, and
  attachment behavior.
- Edit Engine tests pin plan preview/commit parity and orthogonal mutation.
- SVG renderer tests retain the terminal and Junction miter seam behavior.
- Negative test: `centerline` is unchanged by adding/removing a terminal bridge.

## Related documents

- [`../../docs/roadmap/connectivity-routing-debugging-plan.md`](../roadmap/connectivity-routing-debugging-plan.md) §5.3, §8 R3
- [`../specs/connectivity-and-routing.md`](../specs/connectivity-and-routing.md)
- [`../specs/export.md`](../specs/export.md)
- [`0013-project-connectivity-index.md`](0013-project-connectivity-index.md)
- [`0009-move-stretches-connected-routes.md`](0009-move-stretches-connected-routes.md)
