# Agent response semantics

Owner: Agent API, Edit Engine, RouteGraph helper, and derived diagnostics.
Strength: factual interpretation. Trigger: whenever an Agent reads a helper,
transaction, Snapshot, or render result.

Read structured fields before messages. Messages help humans; codes, paths,
object IDs, revisions, bounds, points, and parameters support reliable repair.

## Interpret results by layer

| Result layer                | Means                                                                                    | Blocks commit/completion?                                                               | Correct response                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| RouteGraph `conflicts`      | The proposed graph cannot be deterministically expanded.                                 | Yes; expansion is atomic and contains no edits.                                         | Change graph or placement, then expand again.                                                   |
| API/Edit Engine `ok: false` | Request, authority, revision, or edit contract failed.                                   | Yes.                                                                                    | Use error code, `path`, and `objectIds`; do not parse only the message.                         |
| Successful `transact`       | The edit batch validated; commit or dry-run result is coherent.                          | Not a visual-quality pass.                                                              | Read revision, diff, `resolvedRoutes`, and diagnostics.                                         |
| Structural diagnostic       | A high-confidence model or topology condition exists at a known revision/location.       | Gate-eligible errors block; gate-eligible warnings block only under an explicit policy. | Repair the responsible model fact or stored constraint.                                         |
| Visual observation          | A heuristic found measurable geometry that may or may not be undesirable.                | Never blocks automatically.                                                             | Inspect the formal render; change it only when the observation corresponds to a visible defect. |
| Crossing                    | Two Route segments intersect geometrically without an explicit connection.               | Only if unintended or visually confusing.                                               | Keep a clear intentional crossing or redesign the local graph.                                  |
| Flightline                  | Terminals on one Net are not visibly connected by Routes/labels under the derived model. | Normally yes.                                                                           | Route/label the missing relation or report a deliberate incomplete view.                        |
| Formal render               | Actual export-visible schematic.                                                         | Required visual gate.                                                                   | Inspect whole page and local detail; compare with intended circuit expression.                  |

No single layer substitutes for another. In particular, zero diagnostics cannot
prove that the Agent chose a readable visible topology.

## API failures

| Code                 | Meaning                                                                                                 | Action                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `INVALID_REQUEST`    | Payload failed the versioned request schema.                                                            | Compare with capabilities/schema; repair field names and types.                            |
| `PERMISSION_DENIED`  | Session lacks the requested read, render, geometry, connectivity, presentation, or source authority.    | Narrow the operation or request authority; never use a side channel.                       |
| `LIMIT_EXCEEDED`     | Transaction or request exceeded a server-owned limit.                                                   | Split the edit batch without dropping its electrical interpretation.                       |
| `SNAPSHOT_TOO_LARGE` | Selected Document cannot be returned as one complete Snapshot.                                          | Choose a meaningful hierarchical Document; do not fall back to an invented query language. |
| `STALE_REVISION`     | Another committed change invalidated `expectedRevision`.                                                | Refresh Snapshot and reconsider all affected assumptions.                                  |
| `EDIT_PRECONDITION`  | A typed edit conflicts with current object state, endpoint identity, geometry, symbol/pin map, or lock. | Use `path` and `objectIds` to fix the specific edit; do not reorder edits blindly.         |
| `RENDER_TOO_LARGE`   | Requested SVG exceeds the render byte limit.                                                            | Request bounded render regions, while retaining a final whole-document review path.        |

A rejection path such as `["edits", 12]` identifies the failed edit index. A
Route geometry path such as `["routes", routeId]` identifies the affected
persisted Route. `objectIds` is more stable for repair than names embedded in a
message.

## Successful transaction fields

- `revision`: actual current revision for a commit, or unchanged current
  revision for a dry run.
- `proposedRevision`: revision that the dry run predicts.
- `diff.changedObjectIds`: objects the transaction would or did change.
- `diagnostics`: derived findings for the candidate/committed state.
- `resolvedRoutes`: post-normalization polylines for touched Routes.

Always compare `resolvedRoutes` with the intended graph after route creation,
waypoint edits, or instance movement. Collinear waypoint normalization and
local stretch can make stored geometry differ from the submitted arithmetic
without changing connectivity.

## RouteGraph conflicts

These are pre-transaction facts. Because expansion is atomic, never submit
edits when any conflict is present.

| Conflict                                     | Meaning                                                            | Repair direction                                        |
| -------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `DUPLICATE_NODE_ID` / `DUPLICATE_EDGE_ID`    | Graph identifiers are not unique.                                  | Generate stable unique IDs.                             |
| `MISSING_ENDPOINT_REF` / `MISSING_ENDPOINT`  | Endpoint node lacks a valid Snapshot endpoint.                     | Resolve the exact Instance terminal or Junction.        |
| `MISSING_NODE_POSITION`                      | A positioned node cannot resolve `at` or relative positioning.     | Supply a valid position/reference.                      |
| `EDGE_UNRESOLVED_NODE`                       | Edge references an unresolved node.                                | Repair node IDs/positions first.                        |
| `MISALIGNED_EDGE`                            | Edge endpoints differ on both axes.                                | Add an explicit degree-two bend or change placement.    |
| `ZERO_LENGTH_SEGMENT`                        | Both ends collapse to one snapped coordinate.                      | Remove the edge or separate the intended nodes.         |
| `ESCAPE_MALFORMED`                           | Escape does not connect exactly one electrical endpoint.           | Reclassify or rebuild the edge.                         |
| `ESCAPE_DIRECTION`                           | Edge leaves a terminal against its known outward vector.           | Move the escape node into the outward corridor.         |
| `WIRE_THROUGH_SYMBOL`                        | Proposed edge intersects another instance silhouette.              | Change placement or graph; helper will not detour.      |
| `BEND_DEGREE`                                | A transient bend is not exactly degree two.                        | Use a real branch Junction or correct the path.         |
| `ROUTE_SELF_LOOP` / `UNANCHORED_ROUTE_CYCLE` | Graph contains a closed path that cannot become an anchored Route. | Remove the cycle and express actual endpoints/branches. |

## Visual diagnostics

Every derived finding carries three policy fields:

- `category`: `structural` or `observation`;
- `confidence`: `high`, `medium`, or `low`;
- `gateEligible`: whether an explicit quality policy may use the finding as a
  completion gate.

An Agent must not infer gate eligibility from `severity` or from the word
"warning". A quality policy cannot promote `gateEligible: false` into a
blocker.

| Code                          | Severity/meaning                                                                           | Normal response                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `VISUAL_UNPLACED_INSTANCE`    | Warning: instance has no placement.                                                        | Place it before routing or explicitly scope it out of the view.                     |
| `VISUAL_UNRESOLVED_SYMBOL`    | Error: symbol/pin geometry is unavailable.                                                 | Add or correct explicit symbol mapping; do not guess pins.                          |
| `VISUAL_SYMBOL_OVERLAP`       | Low-confidence observation: clustered visible primitive bounds overlap.                    | Inspect the render; compact stacks and matched groups may be intentional.           |
| `VISUAL_LABEL_OVERLAP`        | Low-confidence observation: measured annotation bounds overlap.                            | Inspect actual text; move it only when readability is affected.                     |
| `VISUAL_SHORT_SEGMENT`        | Warning: a Route contains a suspiciously short segment.                                    | Remove redundant bend or redesign the local graph.                                  |
| `VISUAL_AMBIGUOUS_JUNCTION`   | Error: a Junction lies on an unrelated-Net Route and visually suggests a false connection. | Inspect exact Nets and point; move the graph so the real branch dot is unambiguous. |
| `VISUAL_CONSTRAINT_VIOLATION` | Warning: evidence against a stored constraint.                                             | Respect locks/constraints and change surrounding layout.                            |
| `VISUAL_OUTSIDE_PAGE`         | Warning: object is outside Document bounds.                                                | Move or intentionally resize bounds.                                                |
| `VISUAL_WIRE_THROUGH_SYMBOL`  | Low-confidence observation: Route crosses a visible-symbol bounding region.                | Confirm against visible strokes before changing graph/placement.                    |
| `VISUAL_ROUTE_OVERLAP`        | Medium-confidence observation: same-Net Routes share a collinear span.                     | Shared trunks may be intentional; collapse only redundant ownership.                |
| `VISUAL_TERMINAL_DEPARTURE`   | Info: first segment does not follow the pin outward direction.                             | Inspect render; repair if it creates a hook or reversal.                            |

Observations are clustered where possible so one dense neighborhood or shared
Net does not produce a quadratic list of pair warnings. Diagnostics do not
currently identify every confusing small box, duplicated
nearby branch, semantically poor shared-gate drawing, bad functional grouping,
or excessive label repetition. Absence of those codes is not approval.

## Completion decision

Require both gates:

1. **Structural gate:** transaction accepted, topology preserved, endpoint
   coverage complete, blocking diagnostics resolved, no unintended flightline.
2. **Semantic visual gate:** formal render communicates function, shared nodes,
   signal flow, labels, and repetition without misleading bumps or dots.

When the gates disagree, the task is not complete. A confusing but structurally
valid image requires Agent reasoning and another edit/render iteration, not a
new success code.
