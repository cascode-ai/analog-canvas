# Circuit responses and recovery

Read structured success/error fields, diagnostic paths and object IDs before
human-readable messages. A successful transaction confirms edit validation,
not visual quality or electrical performance.

## Receipts

`revision` is the current revision; a dry-run leaves it unchanged and may return
`proposedRevision`. `diff.changedObjectIds` identifies touched objects.
`resolvedRoutes` gives their normalized route polylines; inspect it after moving
instances or editing paths. Do not count a dry-run as a committed change.

MCP receipts also identify stages such as compile and commit; an explicit
`dryRun` request is not committed and reports `applied: false`. A
`STATE_CHANGED` receipt means re-inspect and reconsider; it is not a transport
retry instruction. Raw HTTP callers separately manage exact-payload retries.

## Recovery by cause

| Cause | Action |
| --- | --- |
| INVALID_REQUEST / MCP EDIT_SCHEMA_INVALID | Correct reported fields using the current schema; changed input needs new identity |
| STALE_REVISION / STALE_STRUCTURE_REVISION / MCP STATE_CHANGED | Refresh affected Document/Project facts and reconsider the operation |
| EDIT_PRECONDITION | Inspect path/objectIds for locks, pin maps or current state; do not reorder edits to bypass validation |
| PERMISSION_DENIED | Narrow the operation or obtain authorization; no alternate mutation path |
| LIMIT_EXCEEDED | Split coherent edits within advertised bounds without dropping connectivity work |
| SNAPSHOT_TOO_LARGE | Select an appropriate existing child Document or report the limit; do not invent a query operation |
| RENDER_TOO_LARGE | Request bounded render regions |

Session credentials, offline transport and request-cache recovery belong to the
selected MCP/CLI/HTTP entry guide. File and Simulation resources also return
their own domain errors; recoverable input/execution failures are not revocation.

Use [diagnostic policy](shared/diagnostics.md) for structural findings and visual
observations. Follow the [task workflow](workflow.md) for completion scope;
reading a value does not require a full drawing-quality audit.
