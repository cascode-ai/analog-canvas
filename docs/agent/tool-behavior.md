# Circuit transaction and geometry contract

The Circuit resource has four operations, `capabilities`, `snapshot`,
`transact` and `render`; File, Simulation and Project are separate resources.
Capabilities reports versions, permissions, limits, transaction forms and edit
kinds, not a Project Index. Snapshot projections: `bootstrap` (identities,
counts), `state` (revision, counts, optional diagnostics), `folder-directory`
(experiment metadata without source), `geometry` (selected authored objects;
`textBounds` measures label text), `pins` (selected instances' endpoints and
bulk) and the default `full` (Document and Project editing context). A built-in
catalog describes assets, never live positions or Net membership.

Full Snapshot with `drawingPresentation: true` includes the effective
`drawingOrder` (back to front) and each Instance's fill capability and authored
fill. Use `set_body_fill` and `reorder_drawing_objects` through the presentation
grant. Placement with an explicit body fill takes both geometry and presentation.

## Transactions

- Ordinary edits use `expectedRevision`; structure edits also use
  `expectedStructureRevision` and nested Document edits' target revisions.
  Stale rejection, not a precautionary reread, is the concurrency boundary;
  clean full Snapshots may be reused for planning.
- A transaction has exactly one payload form: edits, structureEdits,
  wireIntent, semanticIntent or command (HTTP also `actions`). It commits
  atomically; a dry run does not advance the revision; semantic focus does not
  mutate Project data. GUI and Agent edits share validation and locks; a
  Snapshot is evidence, not a replacement payload.
- `diagnosticDeltaDetail:"compact"` keeps current and added diagnostics and
  replaces removed bodies with `removedIds`; an empty compact `removed` does
  not mean nothing was removed. Raw HTTP defaults to full; MCP edits default to
  compact and accept `detail:"full"`.

## Geometry and electrical identity

`wireIntent.routingMode` is `orthogonal` (planner default), `octilinear` or
`free`; free-angle wires are valid. Without a mode, a 45° step between via
points, or between an end's landing and the first/last via, is refused naming
the step: choose `octilinear` or `orthogonal`. Power rails are one nonzero
horizontal or vertical segment.

Routes have a starting endpoint and stable-ID legs to bends or an endpoint. A
route-segment attachment uses `{routeId, legId}` and the actual point; a
segment index is not stable across revisions. Manual, locked or trunk segments
do not autoroute. `wire-at` taps a `point` on the evolving wire batch,
optionally restricted by `net` or a member `{instanceId,pinName}`, including a
trunk created earlier in the batch; the point is tapped exactly and, like a via
point, must be on the pin grid (refused, never moved). A `net` target taps that
Net's nearest conductor where a pointer would land. A `free` anchor is not a
tap. Different Nets may cross, but a tap joining them is rejected.

A crossing connects nothing; real branches use Junctions; a bend is not a
branch. The wire planner makes the splits and Junctions. Decide connectivity
from returned endpoint/Net identities, not pixel intersections.

Moving an instance moves its attached annotations and stretches connected
Routes; wiring that hangs only from moved parts (open stubs with bends, open
Junctions, Net labels) travels whole. Check `resolvedRoutes`; group moves must
keep intended boundary connections.

Formal render shows persisted presentation without selection, grid or
diagnostic overlays; diagnostic render is a separate mode (see
[diagnostic policy](shared/diagnostics.md)).
