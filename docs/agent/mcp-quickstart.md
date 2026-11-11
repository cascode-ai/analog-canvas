# Analog Canvas MCP quickstart

## Open a review task

`open_canvas({})` opens a dedicated Canvas tab for a new task at the configured
origin. A successful reply includes the `taskRef`, `sessionId` and live Project
and Cell context. Wait for `projectRead: "ready"` before importing or editing.
Pass the returned `taskRef` on every tool call for the task.

If approval is pending, have the user choose **Allow Agent access** in the
browser, then reuse `open_canvas({taskRef})`. A signed-in user can choose
**Trust this device** so later tasks for this site, installation and account
open without a click (`trusted: true`). Trusted tasks use local review copies.
For a closed, revoked or blocked task, see
[Recover a review task](analog-canvas://reference/quickstart?section=Recover%20a%20review%20task).

## Recover a review task

- Reuse `open_canvas({taskRef})` to check or reopen the task. Task references
  last for the running MCP process. Wait for `projectRead: "ready"`. If recovery
  is `"previous-project-unconfirmed"`, verify the Project and revision before
  continuing earlier work. Each task has its own working copy and credentials.
- `SESSION_REVOKED` means the user ended the task in Canvas. Ask before
  reconnecting, then use `open_canvas({})` for a new task. Canvas checks trust
  again or shows the one-time approval. **Stop trusting this device** in the
  Agent panel or **Account → Settings → Trusted Canvas devices** ends the device's
  trust and its trusted tasks.
- `TRUSTED_TASK_LOCAL_ONLY` means the operation needs account access. Tell the
  user what it needed. Have them do it in Canvas, or open a separate
  `open_canvas({approval:"once"})` task for an authorized account operation. The
  user approves it in the browser. Do not retry it in the trusted task.
- `REVIEW_TARGET_CHANGED` on image export means the receipt is stale. Read the
  current revision and explain the change before exporting it. A restored copy
  has a new `workspaceGeneration`. Report the recovery and confirm the live
  copy before presenting an image as current.

## Connect

For a dedicated task, see
[Open a review task](analog-canvas://reference/quickstart?section=Open%20a%20review%20task).
For a user-provided Claim, use the manual connection below.

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
  [file delivery and its receipt](analog-canvas://reference/mcp-tools?section=Import%20a%20local%20source) for the source root and
  version fields.
- Netlist to review: [start a review](analog-canvas://reference/mcp-tools?section=Start%20a%20review).
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
