# Circuit transaction and geometry contract

The Circuit resource has four operations: `capabilities`, `snapshot`, `transact`
and `render`. File, Simulation and Project are separate advertised resources.
Capabilities reports versions, permissions, limits, transaction forms and edit
kinds; it does not return a Project Index. Snapshot has one protocol operation
with two projections: `bootstrap` contains only Project/Document identities,
revisions and counts for fast connection, while the default `full` projection
contains the selected Document and Project editing context. Use the current
transport schema for exact fields.

## Transactions

- Ordinary edits use `expectedRevision`; structure edits additionally use
  `expectedStructureRevision` and the target revisions of nested Document edits.
- A transaction accepts exactly one payload form: edits, structureEdits,
  wireIntent, semanticIntent or command. Edits commit atomically; dry-run does
  not advance revision. Semantic focus changes do not mutate Project data.
- Snapshot is read-only evidence, not a replacement Project payload. GUI and
  Agent changes use the same edit validation and locks.
- Clean full Snapshots may be reused across unchanged reads and transaction
  planning. Every mutation still supplies `expectedRevision` (and structure
  revision when required); stale rejection, not a precautionary reread before
  every operation, is the authoritative concurrency boundary.

For MCP calls the helper constructs the envelope. Raw HTTP callers construct it
from published OpenAPI. A built-in catalog describes available assets, never
live positions or Net membership.

## Geometry and electrical identity

`wireIntent.routingMode` supports `orthogonal`, `octilinear` and `free`.
Orthogonal is the default planner constraint, not a universal persisted-route
restriction. Free-angle wires are valid. Power rails remain a single nonzero
horizontal or vertical segment.

Persisted Routes contain a starting endpoint and stable-ID legs to bends or an
endpoint. A route-segment attachment uses `{routeId, legId}` and the actual
point; a derived segmentIndex is not a stable identifier across revisions.
Segment modes such as manual, locked or trunk do not compute an autoroute.

A crossing does not connect Nets by itself. Real branches use explicit
Junctions; a bend is not a branch. For normal wiring, the shared wire planner
creates the required splits and Junctions. Use returned endpoint/Net identities,
not a pixel intersection, to decide whether a connection exists.

Moving an instance translates its attached annotations and can stretch connected
Routes. Inspect returned `resolvedRoutes`; movement does not promise a finished
global layout. Group movement must preserve the intended boundary connections.

Formal render shows persisted presentation, without selection, grid or diagnostic
overlays. Diagnostic render is a separate inspection mode. Interpret findings
using [diagnostic policy](shared/diagnostics.md).

The optional repository RouteGraph library has narrower expansion constraints
than `wireIntent`. It is not an MCP tool or HTTP request form; operating Agents
do not need to install it to draw a circuit.
