# Web Agent Session

Status: `accepted`

Primary owners: `worker/agent-session.ts`, `worker/agent-session-runtime.ts`,
`worker/agent-session-do.ts`, and `apps/editor/src/agent`

The browser Project is authoritative; the relay only forwards. Circuit
operations are in the [Agent API](agent-api.md).

```text
GET  /api/agent/kit
POST /api/agent/claims
POST /api/agent/connectors/resume
GET  /api/agent/sessions/{sessionId}/status
POST /api/agent/sessions/{sessionId}/circuit
POST /api/agent/sessions/{sessionId}/files
POST /api/agent/sessions/{sessionId}/simulation
POST /api/agent/sessions/{sessionId}/projects
GET  /api/agent/openapi.json
```

## Pairing

- **Agent** creates a tab/workspace session with every supported scope (no
  tier picker; replacement also grants full access; recovery resumes the
  original scopes). The relay returns a short-lived Claim; redemption returns
  `sessionId`, authorized `documentIds`, a bearer and a session-bound
  connector. Redeeming a still-valid Claim again only rotates both.
- An adapter names its release in the `x-agent-adapter-version` header
  (`x.y.z`) of claim and connector resume; the relay keeps the last one for
  the session and sends the editor `agent.adapter` (absent or malformed:
  unknown), and the Connect Agent panel shows it while paired.
- `?agent=pair` pairs headlessly: the page creates a connection on load
  (unless it recovered one) without panel or control, exposing the Claim only
  as `window.analogCanvasAgent.claimCode()`. A Claim never enters a URL,
  storage or logs.
- The Claim shows as soon as creation succeeds; its countdown uses the
  response `Date` advanced by the page's elapsed clock (a wrong computer clock
  cannot expire it). Expiry removes the code, not its explanation; failed or
  cancelled setup removes it; a new connection replaces the handoff;
  Disconnect is locally terminal even with requests pending.
- `GET /api/agent/kit`: one small public static JSON (`README.md`,
  `AGENTS.md`, a session `SKILL.md`, authoring rules, the built-in palette
  catalog) with no Project data, secrets or mutation, outside the Circuit
  OpenAPI; fetched only when a human hands over setup, before redeeming.

## Credentials

- Claim redeemable 30 minutes; bearer ≤ 8 hours, never persisted; session and
  connector expire after 30 minutes idle (no absolute limit); idempotent
  results cached 5 minutes within entry/byte ceilings.
- Idle is reset by redemption, admitted Circuit/File/Simulation/Project
  operations and responses, manual Document edits (Cell roster included) and
  pause/resume; not by capabilities probes, connector refresh, heartbeat
  acks, SSE keepalives or reconnects.
- Presence: while the editor socket is attached and the tab is visible or had
  input in the last 30 minutes, the editor sends the editor-secret `presence`
  control every 5 minutes, renewing only within 8 hours of the last Agent
  operation or edit; a relay without an attached socket ignores it.
  `session.expiring` (1 minute before) shows **Keep connected**, which sends
  `keep-alive` (renews like pause/resume). Disconnect ends both. The relay
  persists the deadline, reschedules expiry and emits `session.renewed`;
  `session.expired` ends idle sessions. Relay forwards time out after 30 s.
- Every credential needs a live session. Claim redemption rotates connector
  and bearer; connector resume rotates the bearer; rotation invalidates the
  previous one; revoke or expiry invalidates all three. The relay stores only
  verifiers. The MCP Helper may persist only the connector in its private
  profile, holding the default per-origin file by a liveness-checked lease (a
  concurrent Helper keeps its connector in memory with its own Claim; stale
  leases pass on; explicit paths take no lease). Browser recovery persists
  neither credential. A returned connector expiry is a snapshot: resume
  always asks the server.
- Ended sessions bulk-delete download copies (failures retried later) and
  answer the typed expired/revoked errors.

## Binding and context

- A session binds the browser workspace, scopes, expiry and editor secret.
  Project identity and Cell roster come from the authenticated heartbeat, not
  a second authorization; `projectSessionId` in old records is metadata.
- Each host registration publishes `contextRevision`, reported by claim,
  resume and status and in `x-agent-context` on Snapshot responses.
  Project-bound requests send it; relay and browser reject stale context
  without revoking. A request keeps its original context through forwarding;
  never replay a write against a newly selected Project. Cell switches keep
  context. Readiness waits for the matching heartbeat ack.
- Reconnect credentials live in the tab's sessionStorage; refresh, Project
  switches and Gallery return keep the pairing. In the Gallery the roster is
  empty and circuit operations return `NO_ACTIVE_PROJECT`. Manual pause stays
  authoritative across completion, recovery and renewal; transport failure
  never revokes.
- Simulation services, prepared inputs and results keep their originating
  controller; selecting another Project cannot retarget them.
- Project resource `workspace` lists live tabs and Cell revisions, activates,
  opens, saves and copies into a live target via the GUI planner (one Undo);
  Cloud discovery and `import-cell` read saved versions only.
- `insert-gallery-entry` copies a source Cell (top by default) into the bound
  target Cell through GUI import and placement, rechecking revisions and
  identity after download, with no tab switch or publication; empty sources
  reject; one Undo removes it. Scopes: `project.import` + the three
  circuit-edit scopes. The receipt maps source/target, revisions, objects and
  dependencies.

## Transport

- `GET …/status` authenticates the bearer (also while paused) and reports
  relay observations without forwarding, renewing, resuming or entering the
  request ledger (schema in `packages/agent-adapter/src/envelope.ts`):
  `authorization` active|paused (revoked/expired are typed errors), `editor`
  attached|detached with `observedAt` and idle `expiresAt`. Attached only
  means a socket was seen. A failed probe keeps the pairing and reports
  unknown; only a Circuit response proves execution transport. No operation
  requires a status read first.
- Browser states (only declared transitions apply):

  ```text
  idle -> creating -> waiting-for-agent -> connected <-> working
  connected -> paused -> reconnecting -> connected
  connected|working -> offline -> reconnecting
  any live state -> revoked|expired
  ```

- The workspace transport controller owns sockets, probes (5 s) and bounded
  jittered reconnects, independent of React and Cell selection, probing
  before closing after a scheduling gap. Only a server terminal response or
  explicit revoke clears the pairing; reading status with the editor secret
  checks a deadline without renewing.
- `EDITOR_OFFLINE` (before dispatch) retries up to three times
  (500/1000/2000 ms) under the same ID; `EDITOR_DISCONNECTED` is uncertain and
  surfaced, never replayed; nothing is queued indefinitely.
- Timing (client `headerMs`/`bodyMs`/`totalMs`, relay `serverMs` =
  `preForwardMs` + `forwardMs` + `postForwardMs`) and close diagnostics are
  bounded observations without credentials or bodies; never subtract remote
  wall clocks.

## Idempotency and revisions

A request ID binds its exact payload hash: an exact retry returns the cached
result or joins the pending one; a different payload is `REQUEST_ID_REUSED`.
Reads leave no ledger entry. A completed mutation's identity (ID, hash,
timestamps, never its result) is stored once under its own Durable Object key
for the session; after the result cache is gone it answers
`REQUEST_RESULT_UNAVAILABLE` instead of re-executing. Session state keeps only
pending mutations; session end deletes both. On `STALE_REVISION`, uncertain
outcome, reconnect or a human revision event the Agent refreshes and
reconciles, never blindly replays.

## Permissions and limits

- Circuit scopes: Snapshot, render, source spans, geometry, connectivity,
  presentation, semantic editor control. File scopes: Project download, visual
  download, staging (`project.import`, which also gates the Project resource).
  `simulation.run` covers Simulation operations and simulation workspaces
  (capability/help requests need none); saving a Project-folder source needs
  `simulation.run` + `project.import` (+ connectivity edit if it edits the
  circuit). `gallery.publish` is independent of edit scopes; older sessions
  need a new connection for it.
- Semantic control selects a locator, highlights a Net, activates/fits a Cell
  or clears focus; never advances revision or history.
- The relay checks bearer, session/document binding, scope, expiry, body size
  and rate before forwarding. File Resource payloads ≤ 10 MB decoded
  (`fileResource.maxBytes`, advertised and enforced by the editor; clients
  build in no ceiling). Relay body/message ceiling 16 MB (base64 headroom,
  under the 32 MiB Durable Object WebSocket message).
- Secrets use constant-time comparison and redacted telemetry. Responses are
  `no-store`; payloads and secrets stay out of analytics and recovery.
  Offline, revoked, expired, replaced, connector-invalid, permission-denied,
  stale-revision, invalid-request and request-ID-reuse failures are typed.
  Revoke is locally terminal even when the relay is unreachable.
