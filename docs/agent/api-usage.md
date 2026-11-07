# Raw HTTP session guide

For callers implementing the HTTP lifecycle. `GET /api/agent/openapi.json`
from the exact editor origin is the authority for schemas, envelopes and
limits.

## Connect and select a Document

1. Redeem the human's claim: `POST /api/agent/claims` with
   `{"claimCode":"<claim-code>"}`. Automation that opened the editor itself at
   `/editor?agent=pair` gets that page's claim from
   `await window.analogCanvasAgent.claimCode()`; keep it out of URLs, storage
   and logs.
2. Keep `sessionId`, `projectId`, `documentIds` and `contextRevision`. Hold
   `agentToken` in memory only; store `connectorToken` only in private
   credential storage. Never log credentials or put them in circuit files.
3. Call Circuit `capabilities` for permissions, operations and limits; it has
   **no Project Index**: choose a Document from claim/resume authorization and
   read the narrowest Snapshot projection that answers the task
   ([projections](tool-behavior.md)).
4. Follow the [task workflow](workflow.md) and [native authoring](shared/authoring.md);
   use the [catalog](../../packages/agent-adapter/src/agent-authoring-catalog.generated.ts)
   for built-in placement and refresh pins before wiring new parts.

Send `Authorization: Bearer <agentToken>`, `Content-Type: application/json`,
and `apiVersion` (currently `3.0`) and `requestId` where required.

| Route under `/api/agent/sessions/{sessionId}` | Purpose |
| --- | --- |
| `POST /circuit` | capabilities, snapshot, transact, render |
| `POST /files` | Project exports/import candidates, simulation source and artifacts |
| `POST /simulation` | Capabilities, authoring help, run/prepare/start/read/cancel/export, batches |
| `POST /projects` | Gallery, active Project Code/Netlist, Cloud Cells, workspaces |
| `GET /status` | Session observations; attached is not execution readiness |

The four-operation limit applies to Circuit only. No route grants host files
or shell access.

Pairing belongs to the browser workspace. Project-bound requests send
`x-agent-context` (from claim/resume/status or a snapshot response header) for
the human's active Project, or `x-agent-workspace` (from `workspace.list`) for
another open copy, which fails if that copy closes. After
`PROJECT_CONTEXT_STALE`, refresh context and replan; never redirect an old
mutation. Gallery returns `NO_ACTIVE_PROJECT` without revoking.

Project `operation:"workspace"` `request.action`: `list` live copies and
revisions; `activate`; `open` (`background:true` returns a `workspaceId`
without selecting it, as does File `open`); `save` (`asNew:true` is Save As);
`copy` with explicit source/target workspace and Cell IDs, revisions and an
offset (omit selection for the whole Cell; GUI copy with dependencies, one
undo). `list-projects`/`list-cells` read saved Cloud data; `import-cell`
imports a reusable Cell closure. Cloud actions keep account checks.

## Transactions and request identity

Use exactly one form: `edits`, `structureEdits`, `wireIntent`,
`semanticIntent`, `command` or `actions`, with current `expectedRevision` and,
when required, `expectedStructureRevision`. `actions` takes MCP
`apply_actions`' actions; a refusal names `error.actionIndex` and
`error.actionKind`, and `ACTION_BATCH_NOT_ATOMIC` lists the calls to send in
`error.calls`.

For a risky edit, dry-run and inspect diff/diagnostics, then commit with
`dryRun:false`, a **new requestId and transactionId**, and the same expected
revisions while still current ([examples](examples.md)). After an uncertain
response, retry the **identical envelope** (IDs, revisions, payload). After a
schema rejection, fix the payload with new IDs. After a stale revision, read
fresh state and replan; changing only the revision is not recovery.
`REQUEST_RESULT_UNAVAILABLE` means the request ran but its cached response is
gone: reconcile, do not replay.

## Simulation

Follow the [shared simulation rules](shared/simulation.md): Simulation
`capabilities` for a Profile and its engine, `authoring-help` for syntax. File
`operation:"simulation-input"` reads/updates source with
`owner:{kind:"project-folder",folderId}` (a Project structure object, updated
at the structure revision) or `{kind:"session-workspace",workspaceId}` (File
`create` makes an expiring workspace, not a folder). Simulation
`operation:"run"` takes `source:{kind:"project-folder",folderId,expectedStructureRevision}`
or `{kind:"workspace",workspaceId,expectedRevision}` at the body root (not
MCP's `request`); keep the whole request and retry an uncertain submission
unchanged; `prepare` + `start` (`preparedId`/`digest`) is optional; each `read`
poll gets a new request ID. Select files with `catalog`, get a descriptor from
File `input:{action:"download",artifactId}`, download whole files through its
authenticated path and verify length and digest ([handoff](simulation-result-handoff.md)).
An accepted request or start is not a successful simulation: check the outer
response and the resource result.

## Resume, failure and authorization

Exchange the saved connector at `POST /api/agent/connectors/resume` and save
the refreshed credentials; ask even past the saved deadline, since activity may
have extended it. A Claim is redeemed once: only a retry after a lost response,
within 2 minutes, is answered again, and it replaces the earlier credentials.

- Invalid/expired bearer: resume once, then retry the exact request.
- Invalid/expired connector or revoked/expired session: stop; get new
  authorization. A Project switch only refreshes context.
- Offline editor: wait for the browser, then reconcile or retry exactly.
- Rate limit: bounded backoff honouring `Retry-After`.
- Missing scope: ask for authority; never use a second edit path.
- Circuit failures: [response semantics](response-semantics.md).

File staging never replaces the live Project. Inspect the candidate, then File
`operation:"open"` (scope `project.import`) opens a new tab; replacing the
current Project needs approval only the browser human can give. Refresh
context after either switch; the pairing stays. The browser must be online;
closing connection details does not revoke.
