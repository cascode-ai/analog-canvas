# ADR 0016: Browser-Authoritative Agent Session

Status: `accepted`

Date: `2026-08-12`

Owners: `apps/editor/src/agent`, `worker`, `packages/agent-adapter`,
`docs/specs/web-agent-session.md`

## Context

ADR 0005 and ADR 0007 define a transport-independent Agent Circuit API
(`capabilities`, `snapshot`, `transact`, `render`) and a Snapshot-driven read
path. The in-process service and an optional authenticated **loopback** adapter
exist in `packages/agent-adapter`, but neither reaches the published browser
editor. `packages/agent-adapter/src/service.ts` creates the `agent` actor and
runs edits through the shared Edit Engine, but it commits through its own
`AgentDocumentStore.commitDocument()`, disconnected from the editor's live
`EditorDocumentController`/`DocumentHistory`, React state, recovery, and undo.
`worker/index.ts` serves static assets and analytics only; there is no public
Agent session, authorization, or live relay.

The product goal is to let a user authorize an external Agent (for example
Codex) to inspect and edit the Project open in the browser editor through a
small HTTPS API, with human and Agent edits sharing one revision, validation,
undo/redo, and recovery lifecycle. This must be delivered without visual/DOM
automation, MCP, a second mutation engine, or server-side Project persistence.

## Decision

Adopt a **browser-authoritative** temporary relay for the first web release. The
open browser editor is the state authority for an Agent session; the relay only
authenticates, queues, forwards, expires, and audits bounded messages. It does
not persist `.icproj`, derive connectivity, execute circuit edits, own undo, or
create actors.

Three boundaries share one domain protocol:

1. **Agent Circuit domain API** — retained `capabilities`/`snapshot`/`transact`/
   `render`, transport-independent.
2. **Editor host boundary** — reads live session state and dispatches complete
   authenticated transactions through one
   `EditorDocumentController.dispatchTransaction()` / `DocumentHistory` path.
3. **Session transport** — claim exchange, capability-token authorization,
   authenticated browser WebSocket, Agent HTTPS/SSE, bounded result cache,
   expiry, revocation, and rate/size limits. It invents no circuit operation.

Authorization uses scoped capability tokens, not product accounts:

- `sessionId` — public opaque id; not authorization.
- `editorSecret` — high-entropy secret held only by the originating browser tab
  for its WebSocket channel.
- `claimCode` — one-time, short-expiry (at most five minutes) code/link shown
  only after explicit user action.
- `agentToken` — high-entropy bearer capability issued after claim, scoped to
  one session, Project identity, Document set, permission scopes, and expiry
  (default one hour, never outliving the editor session).

Permissions are explicit scopes (`circuit.snapshot`, `circuit.render`,
`circuit.source-spans`, `circuit.edit.geometry`, `circuit.edit.connectivity`,
`circuit.edit.presentation`). Within a granted scope, operations do not prompt
individually; the user retains visible pause/revoke and the shared undo history.
Import/export, raw download, filesystem access, and arbitrary code are not
implied by full circuit edit.

A session is bound to an immutable `projectSessionId`, a Project identity, and an
authorized Document set. Switching the active Document does not retarget Agent
requests. Open, Import, Restore, or demo replacement terminates the session and
emits `document.replaced`; the old token cannot read or edit the new Project.

Serialization and retry are deterministic: one Durable Object serializes in-flight
writes per session; `requestId` is an idempotency key deduplicated at both relay
and browser; `expectedRevision` remains the optimistic-concurrency authority; a
timeout, disconnect, or late response can never transform an unknown write into
an automatic retry. Full endpoint, envelope, event, and error contracts are
recorded in [`../specs/web-agent-session.md`](../specs/web-agent-session.md).

A transient WebSocket loss may replace only the browser transport for the same
in-memory session, `editorSecret`, Project identity, and authorized Document
set. Replacement is bounded and never replays a domain request. Project
replacement and browser refresh remain terminal; they are authorization
lifecycle events, not transport recovery.

## Alternatives considered

### MCP or provider tool discovery in product core

- Benefits: ecosystem-standard tool discovery.
- Costs: extra protocol/runtime surface, provider coupling, and a second control
  path beside the bounded Circuit API.
- Reason not selected: rejected by ADR 0005 product direction; the bounded
  Circuit API already exposes the needed operations.

### DOM/pointer/keyboard automation or vision as the mutation path

- Benefits: reuses whatever the GUI renders; no new API.
- Costs: fragile, non-semantic, bypasses revision/permission/atomicity checks,
  and cannot reason about a deterministic Snapshot.
- Reason not selected: the accepted design is semantic and Snapshot-driven
  (ADR 0007); visual output is only a review artifact.

### Expose the existing Node loopback listener to the network

- Benefits: minimal new code; the adapter already exists.
- Costs: `packages/agent-adapter/src/http.ts` imports `node:http`/`node:crypto`
  and deliberately binds to loopback only; it cannot serve a public browser
  editor and is not browser-importable.
- Reason not selected: transport and Node runtime must not leak into the browser
  host; the loopback adapter remains a desktop/scripted option.

### Whole-Project / Snapshot / SVG replacement from an Agent

- Benefits: superficially simple integration.
- Costs: bypasses invariants, revision conflicts, permissions, locks, and
  atomicity; already rejected by ADR 0005/0007.
- Reason not selected: every write stays a typed `transact` through one engine.

### Server-authoritative Project store or offline Agent edits

- Benefits: Agent works without an open browser; enables collaboration.
- Costs: requires `.icproj` persistence, merge/CRDT design, and conflict
  resolution that the first release deliberately avoids.
- Reason not selected: a later collaborative server model requires its own
  evidence and ADR; it is not an additive detail of this phase.

### Silent reconnection to a different Project

- Benefits: uninterrupted Agent operation across Open/Import/Restore.
- Costs: an authorized token would silently address a Project the user never
  authorized.
- Reason not selected: Project replacement revokes the session; the user
  explicitly authorizes a new Project.

## Consequences

### Positive

- The browser editor stays the single state authority; no new persistence or
  merge model is introduced.
- Human and Agent edits share one controller/history/undo/recovery path.
- The domain API, Snapshot, typed edits, capabilities, and render are reused
  unchanged.
- The relay is inspectable, bounded, and unable to forge an actor or edit.

### Negative or limiting

- The browser must remain open and online; closing the tab ends the session.
- Browser refresh revokes the session unless a later explicit reconnect design is
  accepted; no token is placed in recovery/localStorage by default.
- The relay sees encrypted payloads in transit; end-to-end encryption is deferred
  unless threat review requires protection from the service operator.
- The first release allows at most one Agent token per session; multi-Agent
  concurrency is deferred.

## Compatibility and migration

- No persisted Project or Document format changes; the session layer is
  additive.
- ADR 0005/0007 domain API, v1 query compatibility, v2 Snapshot, typed edits,
  permissions, and render contracts are unchanged.
- `packages/agent-adapter/src/service.ts` is refactored in WP-WA1/WP-WA2 to drop
  Node-only imports and to dispatch through the editor host instead of its own
  store/commit boundary; its operation semantics are preserved.
- The loopback adapter remains for desktop/scripted hosts; the web relay is an
  additional transport adapter.

## Validation

- contract examples, threat table, and protocol state-machine review in
  [`../specs/web-agent-session.md`](../specs/web-agent-session.md)
- `pnpm references:check` for documentation links
- later packages cite frozen decisions: identity, retry, expiry, scope, and
  project-replacement behavior (WP-WA1–WA7 exit gates)

## Related documents

- [`0005-transport-independent-agent-api.md`](0005-transport-independent-agent-api.md)
- [`0007-snapshot-driven-agent-workflow.md`](0007-snapshot-driven-agent-workflow.md)
- [`../specs/agent-api.md`](../specs/agent-api.md)
- [`../specs/web-agent-session.md`](../specs/web-agent-session.md)
- [`../roadmap/web-agent-session-integration-plan.md`](../roadmap/web-agent-session-integration-plan.md)
