# ADR 0016: Browser-authoritative Agent session

Status: accepted

Date: 2026-08-12

Owners: `apps/editor/src/agent`, `worker`, `packages/agent-adapter`

## Context

An external Agent must edit the actual open Project, not a detached copy with a
separate commit and undo mechanism. Exposing a Node loopback listener or driving
DOM controls would not preserve browser authorization, revision, and transaction
boundaries.

## Decision

The browser owns live circuit state for its Agent session. A bounded relay
authenticates, forwards, serializes requests, deduplicates results, and expires
credentials. It does not execute schematic edits, derive connectivity, or own
circuit undo. Cloud Project storage is a separate save service, not offline
Agent editing of this live session.

Three boundaries share one domain protocol:

1. Circuit API: capabilities, Snapshot, typed transaction, and render.
2. Editor host: authenticated transactions dispatched through the same
   controller/history/recovery path as human edits.
3. Session transport: claim/resume, browser WebSocket, Agent HTTPS/events,
   scoped credentials, idempotency, limits, pause, and revoke.

A session binds Project identity, browser Project-session identity, authorized
Documents, scopes, and expiry. Changing the active Cell does not retarget an
Agent request. The authenticated browser can synchronize the same Project's Cell
roster; the Agent cannot authorize another Project by supplying an ID.

A public session ID is not a credential. The browser retains its editor secret;
the Agent Helper keeps its bearer out of resources/logs/tool results. Only the
server-issued connector may be persisted in the Helper's private profile.
Claim redemption and connector resume rotate credentials according to the
[web-session contract](../specs/web-agent-session.md), which owns lifetimes.

Transient disconnection can recover the same authorized session, including the
bounded same-browser reconnect path. It never grants a new Project or replays an
uncertain write. Explicit revoke, expiry, and Project replacement invalidate
authorization; a new Project requires new approval. Idempotent request IDs and
expected revisions remain the write-safety boundary after reconnect.

Circuit edit permission does not imply arbitrary files or host execution.
Advertised File and Simulation resources have their own validated operations
under the session. Candidate staging never replaces live data without explicit
human approval. Simulation execution does not make the relay a second circuit
mutation engine.

## Alternatives and consequences

A server-authoritative live editing/merge model would be a separate product
decision. The saved Cloud Project service does not imply one. DOM automation
and whole-Snapshot replacement bypass typed editing and were rejected.

MCP is an Agent-side adapter under [ADR 0020](0020-agent-side-mcp-adapter.md),
not a protocol inside the Edit Engine. The optional loopback host remains local;
its existence is not a public-network deployment policy.

The live browser must be reachable to service circuit requests. HTTPS protects
transport, not against the relay operator: end-to-end encryption is not claimed.
Credentials, payloads, and source text must not leak through analytics, ordinary
logs, or recovery copies.

## Validation

Session tests cover claim/resume, rotation, scope, expiry, revoke, replacement,
offline/reconnect, request deduplication, late responses, and stale revisions.
Host tests prove human/Agent undo and recovery parity. Resource and deployment
tests protect limits and authorization across the actual relay boundary.

## Related documents

- [Transport-independent domain API](0005-transport-independent-agent-api.md)
- [Snapshot-driven workflow](0007-snapshot-driven-agent-workflow.md)
- [Agent API](../specs/agent-api.md)
- [Web sessions](../specs/web-agent-session.md)
- [Deployment](../deployment.md)
