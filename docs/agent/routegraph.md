# Repository-only RouteGraph helper

Read only when repository work explicitly uses `@icm/agent-routing`. It is not
shipped as an MCP tool or HTTP request form. The product wire planner supports
free-angle routing; this optional library deliberately accepts a narrower graph.

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
