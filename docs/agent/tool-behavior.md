# Agent tool behavior

Owner: runtime implementation and normative specs. Strength: factual. Trigger:
before constructing API requests, RouteGraph data, typed edits, or repository
generation recipes.

This page describes behavior an Agent must account for. It is not a substitute
for the normative schemas in [`../specs/`](../specs/); schema and runtime
validation win if this page drifts.

## Agent API 3.0

The normal surface has four operations:

| Operation      | Behavior                                                                  |
| -------------- | ------------------------------------------------------------------------- |
| `capabilities` | Reports versions, permissions, edit kinds, and server-owned limits.       |
| `snapshot`     | Returns one complete read-only Document plus a compact Project index.     |
| `transact`     | Dry-runs or atomically commits typed Document or Project-structure edits. |
| `render`       | Returns bounded base64 SVG in `formal` or `diagnostics` mode.             |

The API intentionally has no dynamic catalog query, region,
topology-classifier, layout-intent, compatibility, or circuit-specific edit
endpoint. A browser Agent may receive a static reviewed built-in catalog in its
Kit; it is product material, not Project state or an API operation.

The complete Snapshot contains both directions of connectivity: every resolved
instance pin has `netId`, and every Net has complete terminal membership. These
views must agree. It also contains placements, route polylines, Junctions,
annotations, groups, constraints, presentation, hierarchy references, and
spatial diagnostics for a known revision.

## Typed transaction behavior

- Ordinary edits target one Document and one `expectedRevision`.
- Cell/interface edits use `structureEdits`, `expectedStructureRevision`, and
  exact revisions on nested `transact_document` entries.
- All edits apply or none apply.
- A dry run performs the same validation but does not advance revision.
- A successful commit advances revision once.
- GUI and Agent operations use the same Edit Engine.
- Geometry, connectivity, and presentation permissions are checked separately.
- Locks and complete Document validation cannot be bypassed by edit ordering.
- A Snapshot or whole Project is never accepted as a mutation payload.

Use the edit kind advertised by `capabilities`; do not assume every host has the
same additive edit set.

## Persisted Route geometry

A persisted Route has:

```typescript
{
  id,
  netId,
  start: RouteEndpoint,
  legs: Array<{
    id: LegId,
    to: BendTarget | EndpointTarget,
    mode: SegmentMode
  }>
}
```

The effective polyline is `resolved(start)`, every bend target, then the final
resolved endpoint target. Endpoint coordinates come from Instance terminals or
Junctions and are not duplicated in bend targets. Normal interactive route geometry must be
octilinear (horizontal, vertical, or ±45°); orthogonal is the default
authoring constraint. A `power-rail` is exactly one non-zero horizontal or
vertical segment. The Agent may request the same
`wireIntent.routingMode: "octilinear"` constraint as GUI. Persisted Route
attachments and route-segment wire intents use `{ routeId, legId }`; a derived
`segmentIndex` is valid only for the current Snapshot revision.

Segment modes describe/edit segment handling; they do not generate geometry.
In particular, setting `auto`, `escape`, `manual`, `locked`, or `trunk` does
not choose elbows, avoid obstacles, merge routes, or create connectivity.
Direct manipulation may refuse protected `locked`/`trunk` segments, so do not
use those labels casually.

A geometric crossing is disconnected unless explicit topology says otherwise.
A two-segment corner is not a Junction. A real branch must end Routes on an
explicit Junction belonging to the Net.

## Transient RouteGraph helper

`@icm/agent-routing` is Agent-side geometry scaffolding. RouteGraph is not in
the API schema or Project model and is never persisted.

The Agent supplies the complete local graph. The helper never decides Net
topology, inserts a missing node, chooses a visual shape, adds an elbow, changes
placement, or reroutes around a conflict.

### Node roles

| Role           | Persisted result      | Meaning                                                           |
| -------------- | --------------------- | ----------------------------------------------------------------- |
| `endpoint`     | none                  | Bind an Instance terminal or Junction at its resolved coordinate. |
| `bend`         | Route bend leg target | Degree-two, dot-free change of direction.                         |
| `tap`          | branch Junction       | Real electrical branch point.                                     |
| `junction`     | branch Junction       | Real electrical branch point.                                     |
| `label-anchor` | label-anchor Junction | Electrical anchor for an attached local Net label.                |

Non-endpoint nodes use either explicit `at` or relative
`alignWith + axis + offset` positioning. The helper snaps positioned nodes to
the 10-unit grid. `axis: "x"` preserves the referenced x coordinate and applies
the offset in y; `axis: "y"` preserves y and offsets x.

### Edge roles

| Role     | Behavior                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------- |
| `escape` | Must connect exactly one endpoint to a positioned node and honor a known terminal outward direction. |
| `trunk`  | Produces a Route segment marked `trunk`; it does not decide where the trunk belongs.                 |
| `link`   | Produces an ordinary Route segment.                                                                  |
| `label`  | Produces an attached `net-label` annotation instead of a Route.                                      |

Non-label `link` and `trunk` edges must already be octilinear (horizontal,
vertical, or ±45°). An `escape` edge remains axis-aligned with its terminal's
outward direction. To turn a corner, the Agent must add a degree-two `bend`.
The helper folds consecutive bend nodes into one Route's bend legs and keeps
them dot-free.

### Atomic conflict behavior

Any expansion conflict returns no edits and no resolved geometry. Typical
conflicts include duplicate node/edge IDs, missing endpoint/position, unresolved
edge node, misaligned edge, zero-length segment, malformed or reversed escape,
wire through symbol, bend degree other than two, self-loop, and unanchored bend
cycle. Change the graph or placement; never commit a subset.

## Movement behavior

Moving or aligning an instance also translates its attached annotations. The
Edit Engine proposes a local stretch for connected Routes; it preserves
connectivity but does not globally reroute or promise an aesthetically finished
result. Inspect the returned `resolvedRoutes` and render after movement.

Moving a group does not mean every nearby Route is automatically selected as a
visual group. Preserve internal wiring deliberately and inspect external
boundary connections.

## Rendering and diagnostics

The formal renderer consumes persisted model objects. It does not infer
electrical connectivity from pixels:

- explicit branch Junctions draw branch dots;
- `port` and `port-filled` Instances render their own reviewed symbol artwork
  and participate electrically only through pin `P`;
- label-anchor Junctions provide attachment without adding a branch dot;
- a normal bend or disconnected crossing draws no dot;
- device pin anchors remain invisible;
- a power label renders from its explicit Net and rail Route/Junction geometry;
- formal render excludes selection, grid, flightline, preview, and diagnostic
  overlay layers.

Diagnostics are derived observations. They never move objects or rewrite
Routes. Diagnostic mode may overlay findings; formal mode is the export truth.

## Repository generator

`tools/agent-layout/generate.mjs` is a deterministic fixture/experiment runner,
not the public Agent API and not an automatic layout engine. A recipe owns
topology recognition and edit construction. The runner owns SPICE import,
batching, dry-run/commit, validation, reporting, and export.

`requireComplete` blocks publication on gate-eligible structural errors and
flightlines, plus explicitly configured gate-eligible warning codes and
crossing limits. Visual observations with `gateEligible: false` remain
non-blocking even when an older recipe lists their code. It cannot judge whether a valid
CMOS gate, differential stage, or bus is visually expressed in the clearest
way. The Agent must inspect the render.
