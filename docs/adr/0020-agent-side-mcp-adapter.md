# 0020 - Agent-side MCP adapter over the four-operation API

Status: `accepted`

Date: 2026-08-14

Owners: `apps/mcp-server`, `packages/agent-client`

## Context

ADR 0005 and ADR 0016 delivered the Agent surface as a transport-independent
four-operation Circuit API (`capabilities`, `snapshot`, `transact`, `render`)
behind a browser-authorized HTTPS relay, and explicitly rejected MCP inside the
product core. ADR 0019 froze that four-operation golden contract.

Practical use showed the remaining cost sits on the Agent host side: an
external Agent must download the HTTP Kit, redeem a claim code, manage bearer
tokens, track revisions and request IDs, read the full OpenAPI, and assemble
typed edit unions by hand. That machinery is identical for every host
(Codex, Claude Code, Cursor) and is protocol plumbing, not circuit judgment.

Hosts increasingly standardize on the Model Context Protocol for tool access.
A local stdio MCP process can absorb exactly that plumbing while the product
keeps one authoritative circuit protocol.

## Decision

The product gains an **Agent-side MCP adapter** as a new local stdio process,
`apps/mcp-server` (`@icm/mcp-server`), backed by a reusable Node helper package,
`packages/agent-client` (`@icm/agent-client`).

- The four-operation HTTPS API remains the only machine protocol. The MCP
  server is a client of that API, never a second server. No worker, editor,
  Edit Engine, or domain package learns about MCP.
- `packages/agent-client` owns connection state, claim redemption and
  process-local bearer reuse, capabilities/revision caches, exact-payload
  request-ID retry, a Snapshot cache with `STATE_CHANGED` detection, and
  compilation of compact high-level actions into existing typed edits and
  `wireIntent`. It never
  re-implements Net/Junction/Route semantics; electrical behavior stays in the
  server-side capabilities (ADR 0019).
- The default tool surface is 12 compact tools (`connect`, `disconnect`,
  `connection_status`, `export_file`, `import_file`, `get_context`, `inspect`,
  `search`, `apply_actions`, `advanced_transact`, `verify`, `render`). Full typed edit unions remain
  reachable only through `advanced_transact`, gated on reading the
  `analog-canvas://contract/advanced-edits` resource in the same session.
- Bearers and claim codes stay inside the Helper process and Authorization
  headers; they never appear in tool results, resources, logs, or files. The
  Helper persists only a server-issued connector credential in the user's
  private profile and exchanges it for fresh short-lived bearers. Browser or
  MCP disconnect revokes the whole session.
- `docs/agent/resource-manifest.json` is the single declaration of which
  documents project to MCP Resources, the HTTP Kit, and the non-MCP fallback.
  `scripts/generate-mcp-resources.mjs` generates the MCP resource payload from
  the entries projected to MCP (`pnpm mcp:resources`); transport-specific
  quickstarts may differ, while shared domain references retain one source. A
  vitest contract test in `ci:unit` rejects drift between the manifest, the
  sources, and the generated payload.
- The MCP stdio protocol layer (initialize/tools/resources/ping,
  newline-delimited JSON-RPC 2.0) is implemented in-repo with zero new runtime
  dependencies. The official SDK was considered; its zod v3 peer requirement
  conflicts with this repository's zod v4 single-version policy, and the
  implemented subset is small, frozen, and fully covered by protocol tests.

This preserves the transport-independent domain service and
browser-authoritative session boundaries: MCP is an Agent-side adapter, not a
second mutation engine, server-side MCP deployment, or fifth Circuit operation.

## Alternatives considered

### Alternative A: MCP Server inside the Worker/domain service

- Benefits: one deployment, protocol at the edge.
- Costs: couples circuit domain to MCP, adds a remote protocol surface and
  provider coupling ADR 0005/0016 rejected, moves tokens server-side.
- Reason not selected: violates the transport-independence decision and the
  local-first, browser-authoritative session model.

### Alternative B: keep HTTP Kit as the only entry

- Benefits: no new code.
- Costs: every host re-implements token/revision/retry plumbing and reads the
  full OpenAPI; the documented pain point remains.
- Reason not selected: the Kit stays as the fallback, but the default path
  should not require reimplementing session machinery per host.

### Alternative C: depend on `@modelcontextprotocol/sdk`

- Benefits: reference implementation of the full protocol.
- Costs: zod v3 peer conflict with the repository's zod v4 pin; large
  dependency for a frozen small subset.
- Reason not selected: hand-rolled subset is smaller and testable; revisitable
  when the SDK supports zod v4 cleanly.

## Consequences

### Positive

- Host Agents stop handling tokens, revisions, raw OpenAPI, and typed edit
  unions; they see compact tools and compact results.
- One shared knowledge source feeds MCP Resources, the HTTP Kit, and the
  fallback docs, enforced by CI.
- The four-operation contract, Edit Engine semantics, and session relay are
  untouched; MCP adds no electrical authority.

### Negative or limiting

- A stdio protocol subset must track MCP revisions; unsupported host features
  (prompts, subscriptions, sampling) fail closed with `method not found`.
- `render` returns `image/svg+xml`; hosts that only rasterize PNG/JPEG will
  show metadata instead of pixels until a raster step is added.
- Hosts must run a local Node.js stdio process. The release therefore ships a
  self-contained executable package and npm-compatible tarball in addition to
  the browser assets.

## Compatibility and migration

- M0-M3 added the Helper/MCP packages. M4 adds one connector-resume transport
  endpoint and browser-restart recovery without changing the four Circuit
  operations. M5 packages the adapter and includes it in the release gate.
- `docs/agent/README.md` now orders entry points: MCP first, Kit + HTTP
  fallback second, direct OpenAPI last.
- ADR 0005 and ADR 0016 remain accepted; the ADR index notes the partial
  supersession.

## Validation

- `packages/agent-client` unit tests: claim/resume, token secrecy, retry
  idempotency, `STATE_CHANGED`, error normalization, action compilation
  validated against `AgentSchematicEditSchema`.
- `apps/mcp-server` contract tests: tool schemas, tool-to-API mapping with an
  in-process fake relay, protocol handshake and dispatch behavior, and
  manifest/source/generated-payload resource consistency.
- The packaged release smoke proves claim, context, atomic edit, verify,
  render, export, staged import, process restart, and connector resume against
  a deterministic local relay.

## Related documents

- ADR 0005 (Agent Circuit API without MCP — domain independence survives)
- ADR 0016 (browser-authoritative Agent session)
- ADR 0019 (four-operation golden contract)
- `docs/agent/resource-manifest.json`, `docs/agent/README.md`
