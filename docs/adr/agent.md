# Agent and Resource Boundaries

Status: `accepted`
Owners: `packages/agent-adapter`, `packages/agent-client`, `apps/mcp-server`, `worker`

Agents make revision-bound semantic edits through the
[Agent API](../specs/agent-api.md) against the live browser, which is
authoritative under [web-session authorization](../specs/web-agent-session.md).
MCP is an Agent-side adapter; File, Simulation and Project are scoped sibling
resources, not other Circuit mutation paths.

- Typed edits share human validation and undo; revision guards make retries
  safe. MCP stays outside the domain; one generator distributes canonical
  sources from the [distribution registry](../agent/distribution.json).
- Browser authority keeps the real open Project and a human decision, at the
  cost that the browser must be reachable. A circuit grant gives no filesystem
  or shell access.
- That decision is one approval per task, or a standing trust a signed-in user
  gives one local installation for
  [local review tasks](../specs/web-agent-session.md#pairing), which then open
  without a click. Only the same OS user can use the installation and those
  tasks get no account powers, so a per-task click would protect nothing; the
  user can revoke the trust at any time.
- The Agent-local RouteGraph expander only does coordinate arithmetic; it never
  persists a plan or silently reroutes.
