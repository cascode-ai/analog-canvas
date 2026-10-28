# Analog Canvas MCP quickstart

## Connect

`connection_status({"refresh":false})` reports the loaded version and API
origin locally. When the origin matches, `connect` with the Claim once (omit it
to resume the saved connector); the exchange checks compatibility. Read
[installation](mcp-install.md) only for a missing, wrong-origin or incompatible
adapter. The reply is authoritative context (identity, counts, revisions,
capabilities; a resume counts edit kinds as `editKindCount`, and
`connect({"detail":"full"})` lists them), so no `get_context` follows. MCP
manages credentials, request IDs and expected revisions.

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
does not disconnect ([session rules](shared/session.md)). HTTP fallback needs
the user's explicit choice and is not MCP acceptance.
