# Circuit responses and recovery

Read structured fields, diagnostic paths and object IDs before messages. A
successful transaction confirms edit validation, not visual quality or
electrical performance.

## Receipts

`revision` is current; a dry run (`applied: false`) leaves it unchanged, may
return `proposedRevision`, and is not a committed change.
`diff.changedObjectIds` names touched objects; `resolvedRoutes` gives their
normalized polylines (check them after moving instances or editing paths). MCP
receipts count the Cell's `errors` and `warnings` and name stages such as
compile and commit; `unwiredPins` counts the errors that are pins not wired yet
(`MISSING_PIN_NET`), as most are mid-drawing; errors beyond it need attention.
A structure-only change (`create-cell`) leaves the open Cell unchanged with no
findings; `changedObjectIds` names the new Cell. `STATE_CHANGED` means
re-inspect and reconsider, not retry.

## Recovery by cause

| Cause | Action |
| --- | --- |
| INVALID_REQUEST / MCP EDIT_SCHEMA_INVALID | Fix the reported fields from the current schema; changed input needs a new identity |
| STALE_REVISION / STALE_STRUCTURE_REVISION / MCP STATE_CHANGED | Refresh affected facts and reconsider the operation |
| EDIT_PRECONDITION | Inspect path/objectIds for locks, pin maps or state; never reorder edits to bypass validation |
| PERMISSION_DENIED | Narrow the operation or obtain authorization; no alternate mutation path |
| LIMIT_EXCEEDED | Split coherent edits within the advertised bounds, keeping all connectivity work |
| SNAPSHOT_TOO_LARGE | Select an existing child Document or report the limit |
| RENDER_TOO_LARGE | Request bounded render regions |
| GALLERY_ACCOUNT_BLOCKED | Contact the Owner using the message's address; do not retry, reconnect or change accounts to bypass the block. `recovery:"fix-input"` preserves the existing Project response contract; the code identifies this account intervention. |

Credentials, offline transport and request-cache recovery belong to the
transport's entry guide. File and Simulation resources return their own domain
errors; recoverable input/execution failures do not revoke the session. Use
[diagnostic policy](shared/diagnostics.md) for findings and the
[task workflow](workflow.md) for completion scope.
