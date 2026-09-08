# ADR 0020: Agent-side MCP adapter

Status: accepted

Date: 2026-08-14

Owners: `apps/mcp-server`, `packages/agent-client`

## Context

Claim redemption, credential rotation, request IDs, Snapshot refresh, and typed
request assembly are protocol plumbing every Agent host would otherwise repeat.
MCP can package that work without creating another electrical authority.

## Decision

A local stdio MCP process in `apps/mcp-server` uses `packages/agent-client`
to call the browser-authorized APIs. No Worker, Edit Engine, or circuit model
depends on MCP.

- The Circuit resource retains its four operations. File and Simulation are
  named sibling resources, not forbidden additions or extra Circuit operations.
- Compact authoring tools call existing GUI planners and typed transactions;
  they do not implement a separate Net/Route/Junction lifecycle.
- Advanced typed edits remain available. Reading a reference resource is
  advisory, never an execution permission gate.
- The Helper owns claim/resume, bearer reuse, request-ID/payload binding, caches,
  and stale-state detection. It persists only the connector credential in its
  private profile; bearers and claim codes do not appear in tool results,
  resource bodies, logs, or files.
- Simulation tools use the same service and File artifacts as the GUI. Full
  Circuit Edit grants the advertised simulation scope without another prompt
  per operation. Raw SPICE stays inside the isolated workspace/executor;
  recoverable domain errors do not revoke the session.
- [The resource manifest](../agent/resource-manifest.json) declares knowledge
  projections. The generator creates MCP resource payloads from those sources
  and the operating Kit; CI checks consistency. Do not copy another set of
  circuit instructions into the adapter.
- The in-repository stdio protocol subset keeps unsupported host methods
  explicit. Its runtime/tool declarations and tests own the supported surface,
  rather than a duplicated fixed tool-count list in this ADR.

## Alternatives and consequences

Putting MCP in the Worker/domain would couple product logic to a host protocol.
Keeping only the raw HTTP Kit would force every host to reproduce connection
and retry handling. The local adapter serves both concerns while the HTTP API
remains independently usable.

The adapter adds a packaged local process and protocol maintenance obligations,
not a server-side Agent execution service. Rendering is still an evidence
artifact, not a substitute mutation path. Session revoke and Project replacement
keep the authorization semantics of [ADR 0016](0016-browser-authoritative-agent-session.md).

## Validation

Client tests cover credentials, exact retries, revision refresh, and typed
action compilation. MCP contract tests cover handshake/dispatch, tool-to-resource
mapping, error recovery, and manifest/source/generated consistency. Packaged
smoke exercises connect, context, edit, verify, render, file staging/export,
process restart, and connector resume against a deterministic relay; deployed
journeys separately validate the hosted boundary.

## Related documents

- [Agent guide](../agent/README.md)
- [MCP quickstart](../agent/mcp-quickstart.md)
- [Agent API](../specs/agent-api.md)
- [Web sessions](../specs/web-agent-session.md)
- [Simulation execution](../specs/simulation-execution.md)
