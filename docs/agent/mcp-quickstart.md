# Analog Canvas MCP quickstart

## Connect

`open_canvas({})` opens a dedicated Canvas tab for a new task at the configured
origin. The user chooses **Allow Agent access** in the browser. A successful
reply includes `taskRef`, `sessionId` and the live Project and Cell context.
Wait for `projectRead: "ready"` before editing. Pass that `taskRef` on every
Canvas tool call in this task, including another `open_canvas` to reuse the tab
or reopen after closing. If approval is pending, continue with the returned
reference after the user approves. Task references last for the running MCP
process. After a reopen with `recovery: "previous-project-unconfirmed"`,
verify the target Project and revision before continuing earlier work.
`SESSION_REVOKED` means the user revoked the task in the browser: ask before
reconnecting, then call `open_canvas({})` for a new task, which needs a fresh
approval.

Use the manual connection for a page the user paired using a Claim. Run it
in a separate MCP process from dedicated Canvas tasks.

`connection_status({"refresh":false})` reports the loaded version and bound
API origin (`runtime.apiOrigin`) locally. When the origin matches, `connect`
with the Claim once (omit it to resume the saved connector); the exchange
checks compatibility and its `site` names the bound origin. Read
[installation](mcp-install.md) only for a missing, wrong-origin or incompatible
adapter. The reply is authoritative context (identity, counts, revisions;
`access` with the granted `scopes` and every tool this server offers, by
group; `capabilities`, the Circuit resource's operations and edits, where a
resume counts edit kinds as `editKindCount` and `connect({"detail":"full"})`
lists them), so no `get_context` follows. MCP manages credentials, request IDs
and expected revisions.

Every tool in `access.tools` is available. A host that defers MCP tools loads
one (e.g. by tool search) before concluding it is missing.

`compatibility.status: "outdated"` (and `runtime.status` of
`connection_status`) means this adapter is older than the origin's manifest
release `latestVersion`: tell the user and follow its `upgrade` step. An
unreadable manifest omits `latestVersion` and never fails `connect`.
`compatibility.unsupportedEditKinds` lists edits this adapter lacks: upgrade
from the exact origin's manifest before using one. An older adapter without
that report resolves `describe_tool({"editKind":"apply_model_source"})` before
its first model-source Apply. `UNKNOWN_EDIT_CONTRACT` means upgrade the
adapter, not a new Claim or Project Code replacement (model-source Apply and
mapped source origins need MCP 0.17.45+, custom artwork migration 0.17.46+). A
deployment cannot change an installed binary; reloading a host may need the
user's restart or a new conversation, never an automatic restart.

## Read only what the task needs

- New instance endpoints:
  `inspect({"target":{"kind":"pins","instanceIds":["<stable-id>"]}})` (≤64).
- Known objects' geometry:
  `inspect({"target":{"kind":"geometry","objectIds":["<stable-id>"]}})`.
- Other inspections reuse the clean full Snapshot; `refresh:true` rereads
  after a known human change.

Plan with the current revision; accepted receipts need no reread. Replan after
a stale revision and keep `verify` for milestones. Simulation `prepare`
freezes its input, so start/read/download need no circuit reread.

## Task guidance

- Local circuit delivery: `import_file` with `action:"open-local"`. See
  [file delivery and its receipt](mcp/tools.md#projects-files-and-gallery) for the source root and
  version fields.
- Netlist to review: [choose how to draw and how to present](mcp/tools.md#from-a-netlist-to-a-review).
  Reuse a usable drawing and keep one live Canvas revision across images and Web.
- Circuit editing: [authoring](shared/authoring.md), then the built-in catalog
  for unfamiliar symbols (`analog-canvas://catalog/builtins?symbols=nmos,pmos,port`
  selects IDs); [tool details](mcp/tools.md) for less common calls.
- Simulation: [simulation calls](mcp/simulation.md); any authored or imported
  circuit is a valid input.
- Failures: [recovery](response-semantics.md). Keep uncertain write/start
  identities and reconcile before repeating; never restart a run to fetch
  results.
- Gallery reuse: `gallery_circuits` `action:"insert"` (entry ID,
  `targetDocumentId`, `position`; one undo, no tab), with the Editor's login.

Use displayed parameters directly; `describe_tool` (`tool`, `operations`,
`field`, e.g. `{"tool":"simulation_plot","field":"/request/formats"}`) is for
unfamiliar fields, never a prerequisite.

Sessions renew on Agent operations and manual edits with a 30-minute idle
deadline; a person present in the open editor extends it up to 8 hours after
the last operation or edit. Keep the editor open; closing connection details
does not disconnect ([session rules](shared/session.md)). Bootstrap fallback
follows the [connection rules](shared/session.md#connection); an established
session stays on its chosen transport.
