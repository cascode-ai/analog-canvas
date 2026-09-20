# Analog Canvas MCP quickstart

## Connect and inspect

Call `connect` with the browser Claim Code once; omit it to resume the saved
connector. The Helper owns HTTP endpoints, tokens, request IDs and revisions.
Closing the browser details panel does not revoke the connection.
Call `get_context` and read the built-in catalog before placing devices.
Use `inspect` and `search` for IDs and pins, not screenshot coordinates.
Read `analog-canvas://reference/authoring` for the shared native placement,
display, Port, Net Label and simulation-result workflow. Both surfaces are generated directly from the same source; the tool
examples below are MCP-specific mappings, not a separate operating policy.

Production exposes the hosted Agent UI. The retired Preview service is offline;
its former accounts, Projects, and connector bindings remain isolated and
dormant.

Before pairing, `connection_status({"refresh":false})` identifies the loaded
MCP version and exact API origin without a network request. Installation and
host loading are separate stages: an installed binary is not proof that this
conversation can call it. Prefer the verified local launch described in
[installation](mcp-install.md). Do not silently replace a failed MCP connection
with HTTP; that path requires the user's explicit choice and is not MCP acceptance.

For the explicit shared-client CLI path, read
[CLI lifecycle](http-cli.md). Compatibility is determined by the current
bootstrap manifest and loaded runtime, not a remembered release version.

Sessions have a renewable 30-minute idle deadline. Agent operations and manual
edits renew it; passive heartbeats do not. A saved connector's deadline may be
stale after activity in the browser: MCP asks the server whether it can resume,
rather than discarding the connector based on its local timestamp. Expired or
revoked server sessions still require a new Claim Code.

## Choose task guidance

- [Editing, verification and recovery](mcp/tools.md) for circuit work.
- [Simulation tools](mcp/simulation.md) for source ownership, prepare/start/read and evidence.
- [Native authoring](shared/authoring.md) for shared electrical and visual rules.
- [CLI lifecycle](http-cli.md) only when explicitly using the command-line path.

Read these on demand. Reading a resource never unlocks a tool.
