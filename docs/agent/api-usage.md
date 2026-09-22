# Raw HTTP session guide

This guide is for a caller implementing HTTP lifecycle, not an MCP tool caller.
Read `GET /api/agent/openapi.json` from the exact editor origin for request
schemas, response envelopes and limits. The Kit does not replace that contract.

## Connect and select a Document

1. Redeem the human's claim with `POST /api/agent/claims` and
   `{"claimCode":"<claim-code>"}`.
2. Retain returned `sessionId`, current `projectId`, `documentIds` and `contextRevision`.
   Keep `agentToken` in memory; store `connectorToken` only in private
   credential storage. Never log credentials or put them in circuit files.
3. Call Circuit `capabilities` for permissions, operations and limits.
   **Capabilities does not contain a Project Index.** Choose a Document from
   claim/resume authorization; read its `snapshot` for Project context,
   resolved pins, Nets, locks and revisions.
4. Follow [task workflow](workflow.md) and [native authoring](shared/authoring.md).
   Use the [catalog](../../packages/agent-adapter/src/agent-authoring-catalog.generated.ts)
   for built-in placement; refresh Snapshot before wiring newly created pins.

Use `Authorization: Bearer <agentToken>` and `Content-Type: application/json`
for session requests. Include `apiVersion` and `requestId` where required;
current examples use API `3.0`.

| Route under `/api/agent/sessions/{sessionId}` | Purpose                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `POST /circuit`                               | Four Circuit operations: capabilities, snapshot, transact, render          |
| `POST /files`                                 | Project exports/import candidates, simulation source and artifacts         |
| `POST /simulation`                            | Capabilities, authoring help, prepare/start/read/cancel/export and batches |
| `POST /projects`                              | Public Gallery, active Project Code/Netlist, reusable Cloud Cells          |
| `GET /status`                                 | Session observations; attached is not execution readiness                  |

The four-operation restriction applies to **Circuit**, not sibling resources.
These routes do not grant arbitrary host files or shell access.

Pairing belongs to the browser workspace, not one Project. Send `x-agent-context`
with Project-bound requests; obtain it from claim/resume/status or a successful
snapshot response header. After `PROJECT_CONTEXT_STALE`, refresh current context
and re-plan; never redirect an old mutation automatically. Gallery returns
`NO_ACTIVE_PROJECT` without revoking the session. No per-operation status probe
or full Snapshot is required.

Project `operation:"workspace"` accepts `request.action` list/activate/open/save/copy.
`list` discovers live working copies and revisions; `list-projects` and
`list-cells` discover saved Cloud data. Copy uses explicit source/target workspace
and Cell IDs, source/target revisions and an offset; omit selection for the
whole Cell. It reuses GUI copy/dependency handling and commits once with undo.
`save` with `asNew:true` uses Cloud Save As. Existing `import-cell` imports a
reusable Cell closure, not scene contents. Cloud actions retain account checks.

## Transactions and request identity

Use exactly one schema-defined form: `edits`, `structureEdits`, `wireIntent`,
`semanticIntent` or `command`. Use current `expectedRevision` and, when
required, `expectedStructureRevision`. Semantic focus is non-mutating.

For a risky edit, send a dry run and inspect its diff/diagnostics. Commit the
reviewed payload with `dryRun:false`, **new requestId and transactionId**, and
the same expected revisions while still current. A dry-run receipt is not a
committed edit. See [request examples](examples.md).

After an uncertain response, retry the **identical envelope**, including IDs,
revisions and payload. Never give an uncertain write a new identity.
After a definite schema rejection, fix the payload and assign new IDs.
After a stale revision, read fresh state and replan; changing only the revision
is not recovery. `REQUEST_RESULT_UNAVAILABLE` means a request ran but its
cached response is gone: reconcile current state, do not replay the mutation.

## Simulation through HTTP

1. Discover Simulation `capabilities`; choose an advertised Profile and read
   its engine. Request `authoring-help` for native syntax. Follow the
   [shared simulation rules](shared/simulation.md), not a remembered dialect.
2. Use File `operation:"simulation-input"` with its schema-defined `input`.
   Source read/update uses `owner:{kind:"project-folder",folderId}` or
   `owner:{kind:"session-workspace",workspaceId}`. Saved folders are Project
   structure objects; File `create` creates an expiring workspace, not a folder.
   Project-folder updates use the Project structure revision. Preserve
   generated files; reported editable circuit fields have a separate mapping.
3. Send Simulation `operation:"prepare"` with
   `source:{kind:"project-folder",folderId,expectedStructureRevision}` or
   `source:{kind:"workspace",workspaceId,expectedRevision}`.
   Fields are at the HTTP body's root, not inside MCP's `request` wrapper.
4. On successful preparation, `start` with returned `preparedId` and `digest`.
   Inspect prepared input artifacts only when needed to investigate the input.
   Retain the entire request before sending. Retry an uncertain start unchanged.
   Each new `read` poll uses a new request ID and returned `runId`.
5. Use `catalog` to select registered files, then File simulation-input
   `input:{action:"download",artifactId}` for a download descriptor. Download
   whole files to the caller's local workspace through its returned authenticated
   path; verify the declared byte length and digest. Text `artifact` paging is
   optional preview, not the default transfer. `export` is an optional inventory
   lookup; reuse complete local files. Large receipts may be previews.
   Follow [result handoff](simulation-result-handoff.md) for browser visibility,
   durable evidence and source export versus results ZIP.

Check both the outer response and resource result for failure. A successful
HTTP request or accepted start is not a successful simulation.

## Resume, failure and authorization

Exchange the saved connector through `POST /api/agent/connectors/resume`
using the published schema. Save returned refreshed credentials; bearers remain
memory-only. Ask the server even if a saved connector deadline has passed:
activity may have extended it. Reusing a valid claim rotates the pairing and
invalidates earlier credentials.

- Invalid/expired bearer: try connector resume once, then retry the exact request.
- Invalid/expired connector or revoked/expired session: stop and obtain new
  authorization. A Project switch only refreshes context, not authorization.
- Offline editor: wait for the browser, then reconcile or retry the exact request.
- Rate limit: bounded backoff; honor `Retry-After` when present.
- Missing scope: ask for authority; do not use a second edit path.
- Circuit failures: follow [response semantics](response-semantics.md).

File staging never replaces the live Project. Inspect the candidate and request
approval; only the browser human can confirm replacement. Then refresh context
before further Project operations; pairing remains active.
The browser must be online for operations. Closing connection details does not
revoke it.
