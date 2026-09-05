# Agent Integration Guide

The Agent Circuit API is a regular JSON/TypeScript API. It exposes a complete
Snapshot and typed edits through the same Schematic Edit Engine used by humans;
it does not bundle an LLM provider, browser automation, or a second command
engine.

## Choose the entry point

1. **Default: packaged local stdio MCP.** Install or unpack the Agent-side MCP adapter
   (`apps/mcp-server`, [ADR 0020](../adr/0020-agent-side-mcp-adapter.md)) and
   connect a host such as Codex, Claude Code, or Cursor to it. The adapter
   owns claim redemption, persistent connector resume, process-local bearers,
   revisions, idempotent retries, and compact tools; the model never sees
   tokens or the raw OpenAPI. The copied handoff points the Agent to the
   versioned bootstrap manifest, so first-time setup can start from the same
   text. See [mcp-install.md](mcp-install.md).
2. **Fallback: Kit + HTTP API.** For hosts without the packaged
   MCP entry point, fetch the public
   `GET /api/agent/kit` JSON, write its listed files to a private scratch
   directory, redeem the claim, and call the four operations directly.
3. **Advanced: direct OpenAPI.** `GET /api/agent/openapi.json` is the
   wire-contract authority for direct API integrations. An MCP-based Agent
   does not need it; `advanced_transact` reuses existing transaction forms.
   Read `analog-canvas://contract/advanced-edits` on demand, without a
   read-to-unlock ceremony.

For an MCP session: start the adapter, call `connect` with a Claim Code, read
`analog-canvas://reference/quickstart`, call
`get_context`, then operate. Knowledge documents surface as MCP Resources
declared by [`resource-manifest.json`](resource-manifest.json); the same
manifest projects the shared sources into the HTTP Kit.

## Browser-host availability

The public production editor is human-only by default and does not expose a
claim UI or reconnect a prior browser session. Trusted development or staging
builds can enable that browser surface with `VITE_ICM_AGENT_UI=enabled`; the
API and MCP contracts themselves are unchanged.

The preview channel enables it (`VITE_ICM_AGENT_UI: enabled` in
`.github/workflows/deploy-preview.yml`), because the preview is where
simulation runs and simulation is Agent-first (ADR 0055): open **Agent →
Connect Agent** in the preview editor for a Claim Code and start the MCP
adapter with `ANALOG_CANVAS_API_URL=https://analog-canvas-preview.tokenzhang.com`.

## External Agent bootstrap (no MCP)

An Agent without this repository receives a connection setup from the editor.
It first fetches the public `GET /api/agent/kit` JSON, writes its listed files
to a private scratch directory, and reads `README.md` followed by the session
`SKILL.md`. The Kit contains a small static projection of reviewed built-in
Razavi authoring facts, but neither a Project, token, nor alternate API. The
Agent then redeems the claim and uses the published OpenAPI as the
wire-contract authority.

## Read in this order

1. Kit `README.md`, `skills/icm-circuit-session/SKILL.md`, and
   `references/authoring-contract.md` for an external session; repository
   contributors begin with the next document instead.
2. [`../specs/agent-api.md`](../specs/agent-api.md) — normative domain contract.
3. [`workflow.md`](workflow.md) — required read, edit, refresh, render, and
   review loop.
4. [`tool-behavior.md`](tool-behavior.md) — runtime behavior and transaction
   boundaries.
5. [`response-semantics.md`](response-semantics.md) — conflicts, diagnostics,
   generated artifacts, and completion decisions.
6. [`api-usage.md`](api-usage.md) — loopback and browser-session requests.
7. [`circuit-style-knowledge.md`](circuit-style-knowledge.md) and
   [`knowledge/`](knowledge/README.md) — evidence-first circuit reading and
   on-demand style/pattern guidance.
8. [`examples.md`](examples.md) — checked, reproducible workflows.

The browser-authorized relay adds transport, session, and permission rules in
[`../specs/web-agent-session.md`](../specs/web-agent-session.md). It carries the
same Agent Circuit domain requests and does not redefine circuit semantics.

## Enforcement boundary

```text
API schemas and permissions
  define what an Agent may request

Schematic Edit Engine and model validators
  enforce hard electrical, revision, lock, and atomicity rules

derived diagnostics
  report measurable visual problems without moving objects

Agent guides
  describe preferred but non-mandatory layout judgment
```

When guidance and schemas differ, the schemas and Edit Engine validation win.
Explicit Junction semantics, Net consistency, and locked-object protection
never depend on an Agent following prose.
