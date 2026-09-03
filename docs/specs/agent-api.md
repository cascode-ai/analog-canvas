# Agent Circuit API

Status: `accepted`

Version: `2.0`

Primary owner: `packages/agent-adapter`

The generated OpenAPI at `/api/agent/openapi.json` is the normative wire
contract. The runtime exposes exactly one Circuit endpoint and four operations:

```text
POST /api/agent/sessions/{sessionId}/circuit
  capabilities | snapshot | transact | render
```

Every request uses `apiVersion: "2.0"`, a stable `requestId`, and the
`sessionId` returned by claim redemption. The bearer token is sent only in the
Authorization header. There are no versioned URL aliases, query operations,
dynamic catalog snapshots or compatibility readers. Project-structural writes
remain a form of `transact`; they are not a fifth operation.
The separate public Agent Kit may carry a static projection of reviewed built-in
product assets; it is not Document state or a Circuit operation.

Session pairing and bearer refresh are transport concerns, not Circuit
operations. The local MCP Helper redeems a claim once, persists only the
revocable connector, and uses `/api/agent/connectors/resume` to obtain fresh
process-local bearers.

## Operation contract

| Operation      | Purpose                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `capabilities` | Report the exact operations, permissions, edit kinds, resource capabilities, and server-owned limits. |
| `snapshot`     | Return one complete, read-only selected Document plus the bounded Project index.                      |
| `transact`     | Dry-run or atomically commit typed Document edits, or a bounded Project structural transaction.       |
| `render`       | Return a bounded formal or diagnostics SVG artifact.                                                  |

Snapshot connectivity is bidirectional: every resolved Instance pin reports
its `netId`, and every Net reports its complete terminal membership. Canvas
`port` and `port-filled` are ordinary single-pin Instances. Formal cell
terminal mappings report stable ID, direction, Net, and their ordinary Port
Instance; they never materialize a separate canvas object class. The Project
index reports `structureRevision` for structural optimistic concurrency.

RichText payloads use the Project's one canonical union. An editable text
content is either ordinary styled runs or one `{kind:"math", latex, display}`
run. Agents submit only bounded formula source and display intent through the
existing typed edit; generated SVG, glyph paths, and formula metrics are never
accepted as mutation data and do not add an operation or endpoint.

Snapshot format `2.0` reports each placed pin's read-only `connection` with
`contactPoint`, persistable `gridLanding`, derived `escapePath`, and `outward`.
Route polylines and contact points may contain derived decimals. Agent
authoring submits endpoint identity and uses `gridLanding` for any explicit
page geometry; it never copies `contactPoint` into a Junction or waypoint.

VDD is a named Net with Route/Junction rail geometry and a net-name-bound
annotation. It is never a symbol, and local versus global scope is explicit in
the Net/edit payload. MOS Instances use canonical `nmos`/`pmos`
assets, whose deterministic default visual variant is
`textbook-3terminal`; explicit bulk connectivity remains a terminal/Net fact.

## Mutation safety

MCP 0.3 / Kit 4 retain API and Snapshot version 2.0. Additive Snapshot fields
include Instance `styleOverride` and `signalFlowParameters`, Cell interfaces
and bulk defaults, and Project external definitions. Local and production
codecs now reference one schema rather than independently maintained copies.

`transact.command` is a mutually exclusive alternative for Model switching,
Cell lifecycle, copy, alignment and selection transforms. The browser reuses
GUI/shared planners; resulting edits still pass through the same revision,
permission and controller boundary. `capabilities` advertises supported
`commandKinds` and `transactionForms`. Structural commands require
`expectedStructureRevision`.

Undo/redo uses the shared browser Document/Project history and requires all
edit permissions. Dry-run does not advance history; there is no private Agent
stack or last-Agent-only undo guarantee. Transaction receipts retain the
server's diff, diagnostic delta, and diagnostic locators.

Optional `snapshot.traceNet` requests cross-Cell/global-Net tracing from the
same Project Connectivity Index used by the GUI; the result is read-only
`trace` evidence. It is not a fifth Circuit operation or a client-side Net
inference algorithm.

- Ordinary edits target one Document and one `expectedRevision`. Add/remove
  Cell and formal-interface work uses `structureEdits` plus one
  `expectedStructureRevision`; nested Document changes still carry their exact
  revisions and reuse the same typed edit union.
- A non-trivial edit is dry-run first; commit uses the same edits only while
  the revision is unchanged.
- All edits commit or none commit, and a successful commit advances revision
  once.
- Reuse a `requestId` only for an exact-payload retry. A different payload with
  the same ID is rejected.
- A Snapshot or whole Project is never accepted as a mutation payload;
  structural transactions contain only typed add/remove/transact operations.
- GUI and Agent writes cross the same Edit Engine and permission checks.

After commit, render and then request a fresh Snapshot for final verification.
On a stale revision or uncertain transport result, refresh state and reconcile;
do not replay a changed or obsolete transaction.

Agent Snapshots expose resolved Logical Nets, so lookup and inspection use the
same names, scopes, power roles, and conflicts as the GUI, ERC, and export
paths. Naming remains marker-owned: raw Base-Net name/scope/power-role writes
are not a naming API. Existing typed Evidence and non-graphical terminal-Net
edits are available for GUI copy/property parity; they retain Edit Engine
validation and do not create an alternate naming authority.

Every Snapshot `net.id` and every `netId` reference to it is a deterministic
Logical-Net representative scoped to that Snapshot Document revision. It is
not a persistent identity: split, merge, pruning, or Evidence edits may change
the representative even when some circuit intent remains recognizable. After
any commit, stale-revision result, or uncertain transport outcome, discard all
previous Snapshot Net IDs and request a fresh Snapshot. Persisted Base-Net IDs
remain valid only while their objects survive the edit lifecycle and are not
exposed as an alternate Agent naming protocol.

`wireIntent` has the same Route planner as interactive Wire. Its optional
`routingMode` is `orthogonal` (default), `octilinear`, or `free` (ADR 0039);
an optional
`cornerOrder` selects the deterministic diagonal/orthogonal pair used when an
exact 45-degree leg cannot reach the target. It never creates a diagonal-only
edit or a second Route model.

## File Resource boundary

`POST /api/agent/sessions/{sessionId}/files` is separate from Circuit
operations. It provides only authorized bounded Project/formal-artifact
download and Project/structural-SPICE candidate staging. Staging never changes
the browser Project. Replacement requires explicit human approval in the
editor. The resource provides no filesystem, arbitrary-code, simulator, or
waveform access.

## Validation

Generated JSON Schema and OpenAPI artifacts are checked against the runtime
schemas. Contract tests cover authentication, exact version rejection,
capabilities closure, complete Snapshot topology, typed-edit parity,
request-ID binding, revision conflict, bounded render, and File Resource
approval boundaries.
