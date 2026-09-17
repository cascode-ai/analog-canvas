# 0007 - Agent and Resource Boundaries

Status: `accepted`

Owners: `packages/agent-adapter`, `packages/agent-client`, `apps/mcp-server`, `worker`

## Decision

Expose revision-bound semantic edits through the
[Agent API](../specs/agent-api.md), with the live browser authoritative under
[web-session authorization](../specs/web-agent-session.md). MCP is an
Agent-side adapter. File, Simulation and Project are scoped sibling resources,
not alternative Circuit mutation paths.

## Context

Agents need convenient connection, retries and authoring without a detached
Project copy, independent undo stack or host-specific electrical protocol.

## Rationale

Typed edits share human validation and history; snapshots avoid treating pixels
as electrical truth. Revision guards and exact request identity distinguish a
safe retry from repeating an uncertain mutation.

Keeping MCP outside the domain prevents an Agent-host protocol from defining
product semantics. The adapter centralizes credentials and retry handling;
HTTP remains usable independently. Knowledge comes from the shared resource
manifest rather than a second instruction corpus maintained by the adapter.

Browser authority preserves explicit approval and the actual open Project.
The cost is that the browser must be reachable; saved Cloud Projects do not
imply an offline Agent editing service. Relay TLS is not end-to-end encryption,
and a circuit grant does not imply arbitrary filesystem or shell access.

The optional Agent-local RouteGraph expander removes repetitive coordinate
arithmetic, not topology decisions. Persisting its plan or letting it silently
reroute would create another circuit model. Its stricter geometry is a helper
input limit, not a restriction on the editor's free-angle Routes.
