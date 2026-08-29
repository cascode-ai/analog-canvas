# ADR 0005: Transport-independent Agent Circuit API

Status: `accepted`

## Decision

The circuit domain service is a transport-independent TypeScript boundary
shared by hosted HTTPS/WebSocket relay and optional loopback development. It is
not an MCP server and exposes no storage or DOM automation surface.

The current API is exactly version 2.0 with four operations:
`capabilities/snapshot/transact/render`. The browser host and loopback adapter
invoke the same parser, service, Edit Engine, Snapshot builder, and renderer.
OpenAPI and JSON Schema derive from that one contract.

Authentication, claim/session lifecycle, bearer secrecy, document allowlists,
request-ID idempotency, and File Resource staging are transport concerns around
the domain service. They do not create alternate circuit operations.

## Consequences

- GUI and Agent edits have deterministic semantic parity.
- Domain tests run without network, tokens, browser DOM, or MCP.
- Transport implementations cannot add query, compatibility, whole-Project,
  or arbitrary-file mutation paths.
