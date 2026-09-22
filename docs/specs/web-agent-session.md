# Web Agent Session

Status: `accepted`

Primary owners: `worker/agent-session.ts`, `worker/agent-session-runtime.ts`,
`worker/agent-session-do.ts`, and `apps/editor/src/agent`

The browser Project is authoritative. Clicking **Agent** creates a
tab/workspace session with full circuit editing, file and simulation access;
there is no permission-tier picker. The relay returns a short-lived pairing
code; claim redemption returns `sessionId`, authorized `documentIds`, a
short-lived bearer, and a
session-bound connector credential. A still-valid claim may be redeemed again
only to rotate both credentials. Bearers are never persisted. The local MCP
Helper may persist the connector in the user's private profile; the relay
stores only its verifier, and session revoke invalidates both credentials.

## Resources

Browser reconnect credentials are scoped to the current tab's sessionStorage.
Refresh, opening or switching Projects, and Gallery return retain that pairing.
Gallery silently maintains transport with an empty Document roster; circuit
operations report `NO_ACTIVE_PROJECT`. No recovery banner or copied Project
store is introduced. Returning to Editor registers fresh services and context.

Manual pause remains authoritative across request completion, socket recovery,
and connector bearer renewal. A transport failure does not revoke a pairing.

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

`GET /api/agent/kit` is one small public, static JSON download for the Agent's
private scratch folder. It contains `README.md`, `AGENTS.md`, one session
`SKILL.md`, concise authoring rules, and a reviewed built-in Razavi catalog
projection. It contains no Project data, claim code, token, or mutation
operation; it is not part of the Circuit OpenAPI. The catalog supplies only
known built-in authoring facts before first placement; a Snapshot remains the
authority for every object in the live Project. The Agent fetches the Kit only
when a human gives it a connection setup, then writes the listed files locally
before redeeming the claim.

The Circuit resource implements only API 3.0
`capabilities/snapshot/transact/render`. File Resource handles advertised
bounded Project/formal-artifact downloads, approved candidate staging, simulation
raw workspaces, and execution artifacts. The sibling Simulation resource uses
the shared prepare/start/read/cancel/export lifecycle; saved setup edits remain
Project structure edits. See [simulation execution](simulation-execution.md).

There is no arbitrary filesystem or host-code execution resource, retired query
operation, dynamic catalog Snapshot, or unapproved whole-Project replacement.
Running authored SPICE in the configured isolated executor is a scoped simulation
capability, not general shell access.

## Binding and authority

A session binds the browser workspace, scopes, expiry and editor secret. Project
identity and the Cell roster are current context supplied by the authenticated
browser heartbeat, not a second authorization lifecycle. `projectSessionId` in
older persisted records is historical metadata, not an authorization boundary.

Each Editor host registration publishes a `contextRevision`. Claim, resume and
status report it; successful Circuit snapshot responses expose it in
`x-agent-context`. Project-bound requests send that header. The relay and browser
both reject stale context without revoking credentials. The original context
travels with a request across asynchronous forwarding; never replay an old write
against a newly selected Project. Cell switches do not change this context.
Connection readiness waits for the matching heartbeat acknowledgement, not a
full Snapshot. Refresh context on an explicit switch or stale-context failure,
not before every operation.

File staging and its existing human approval boundary remain unchanged.
Simulation services, prepared inputs and results retain their originating
controller across tab selection; selecting another Project cannot retarget them.

The Project resource's `workspace` operation lists live tabs and their Cell
revisions, activates a tab, opens a Cloud Project, saves/Save As, and copies a
selection or whole Cell into a specified live target. Copy uses the GUI's
dependency/placement planner and one undoable transaction. Cloud discovery and
`import-cell` remain separate from live working-copy discovery; they read saved
Cloud versions, not unsaved tab contents. No separate copy engine is introduced.

## Credential lifetimes and rotation

The deployed defaults are part of the accepted transport contract:

- a Claim remains redeemable for 30 minutes;
- an Agent bearer remains valid for at most 8 hours and is never persisted;
- the session and its connector expire after 30 minutes of inactivity;
  activity renews the deadline without an absolute lifetime limit;
- a completed request result remains in the idempotency cache for 5 minutes,
  still subject to the configured entry-count and byte ceilings.

Claim redemption, admitted Circuit/File/Simulation/Project operations and their
responses, manual Document edits (including changes to the Cell roster), and
explicit pause/resume reset the idle window. Capabilities probes, connector refresh, heartbeat acknowledgements,
SSE keepalives, and transport reconnects do not. Relay forwards time out after
30 seconds, well within the idle window. The relay persists the renewed
deadline, reschedules expiry, and sends `session.renewed` so browser recovery
and its timer follow the same deadline. `session.expired` ends idle sessions.
The initial connector expiry returned to a client is a deadline snapshot;
resume must ask the server even if that saved timestamp has passed.

Every credential requires a live session, even before its own expiry.
Redeeming a still-valid Claim rotates both the connector and bearer; connector resume rotates the bearer.
Each rotation invalidates the previous credential. Session revoke or expiry
invalidates the Claim, bearer, and connector together. The
local MCP Helper may persist only the connector in its private user profile;
browser recovery persists neither Agent credential.

The workspace's transport controller owns socket creation, liveness probes and
reconnect timers independently of React rendering and active Cell selection.
After a scheduling gap or browser wake it probes the existing socket before
closing it; validated business traffic also establishes liveness. A fresh probe
has a five-second response window. Reconnect uses bounded jittered backoff.
Close diagnostics retain at most 16 local records with reason categories,
timestamps and visibility, never credentials or message payloads.

The browser may authenticate the existing status resource with its editor
secret to verify an elapsed local deadline or a failed handshake. This read
neither renews nor resumes the session. Local deadline snapshots cannot revoke
authorization: only a server terminal response or an explicit local revoke
clears the pairing. A failed network check preserves it.

Circuit, File, Simulation and Project clients share request deduplication and
exact-payload network recovery. An `EDITOR_OFFLINE` rejection precedes dispatch
and gets up to three delayed retries (500/1000/2000 ms) under the same request ID.
An `EDITOR_DISCONNECTED` response has an uncertain outcome and is surfaced for
reconciliation, not automatically replayed. No normal request needs a separate
status/readiness probe and no mutation is queued indefinitely while offline.

## Transport state machine

The Session status resource authenticates the existing bearer (including while
paused) and reads relay observations without forwarding to the browser. Its
canonical schema lives in `packages/agent-adapter/src/envelope.ts`, alongside
the existing Session envelopes. `authorization` is active or paused; revoked
and expired sessions return the existing typed errors. `editor` is attached or
detached, with `observedAt` and the authoritative idle `expiresAt`. Attachment
only means an open socket was observed, not that an operation will succeed.
The read does not resume the session, renew its deadline, or enter the Circuit
request ledger. It is not a fifth Circuit operation.

MCP and direct clients use this same resource for status. The shared client
retains pairing on a failed network probe and reports unknown; its previous
observation remains timestamped evidence, not current confirmation. Only an
actual Circuit response establishes online execution transport. Normal Circuit
operations do not require a status request first.

The official thin browser states are:

```text
idle -> creating -> waiting-for-agent -> connected <-> working
connected -> paused -> reconnecting -> connected
connected|working -> offline -> reconnecting
any live state -> revoked|expired
```

Only declared transitions are applied. Heartbeats detect a stale transport;
bounded exponential reconnect keeps the same Project/session binding. Bearer
tokens remain Agent-side only; browser recovery stores only the editor-side
session record required for same-browser reconnect.

## Idempotency and revisions

Each request ID is bound to the canonical exact payload hash. An exact retry
returns the cached terminal response or resumes the same pending request; a
different payload under the same ID returns `REQUEST_ID_REUSED`. Relay and
browser caches are bounded by entry count, bytes, and session lifetime.

Circuit edits target one exact Document revision. Dry-run and commit share the
same validation path. On `STALE_REVISION`, uncertain write outcome, reconnect,
or human revision event, the Agent refreshes Snapshot state and reconciles
before deciding what to do; it never blindly changes and replays a request.

## Permissions

New browser connections grant the complete supported scope set. Replacing a
connection also grants full access; automatic recovery resumes the original
session with its existing scopes. Pause and Disconnect remain available.

Circuit permissions independently cover Snapshot, render, source spans,
geometry, connectivity, presentation, and temporary semantic editor control.
File permissions independently cover Project download, visual download, and
candidate staging (`project.import`), which also gates the Project resource.
The separate `simulation.run` scope covers Simulation operations and File
Resource simulation workspaces, independent of every edit scope; Simulation
capability and authoring-help requests need no scope. A saved Project-folder
source update needs both `simulation.run` and `project.import`, plus the
connectivity edit scope when it carries circuit edits. The relay checks bearer
token, session/document binding, scope, expiry, body size, and rate limits
before forwarding.

Semantic editor control may select a canonical locator, highlight a Net,
activate/fit an existing Cell, or clear focus. It never advances revision,
enters undo history, or changes Project data.

## Security and failure behavior

- Claims, bearer tokens, and connectors use constant-time comparison and
  redacted telemetry; the relay persists verifiers rather than raw secrets.
- Responses use `Cache-Control: no-store`; payloads and secrets are excluded
  from analytics and recovery.
- Browser offline, revoked, expired, replaced, connector-invalid, permission-denied, stale-
  revision, invalid-request, and request-ID-reuse failures are typed.
- Revoke is locally terminal even when the relay is unreachable.
- CORS/origin, payload, rate, cache, expiry, and reconnect behavior are covered
  by deterministic Worker/browser tests.
