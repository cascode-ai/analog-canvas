# Session contract quick reference

Circuit operations are exactly `capabilities`, `snapshot`, `transact`,
and `render`. Inside transact, use exactly one of edits, structureEdits,
wireIntent, semanticIntent, a browser-planned command, or high-level actions.
Commands and actions reuse GUI/shared
planners and the same Edit Engine. Simulation is a sibling resource with
capabilities/run/prepare/start/read/cancel/export; files remain in File Resource.
Neither expands the four Circuit operations. The Kit's static
authoring catalog is not Project state and is not a Circuit operation.

Use request IDs only for an exact-payload retry. A changed request gets a new
request ID. The current OpenAPI and `capabilities` response define the exact
available scopes, edit kinds, and limits for this session.

Dry-run is optional, not a mandatory call before edits. Target-resolving actions
are planned on the current Document and committed in one browser step. Raw
transactions, pass-through forms and undo/redo retain their revision guards;
not every concurrent human edit produces STATE_CHANGED. Use the receipt and
targeted inspection when sufficient; render/full Snapshot only when the task
needs them. Refresh affected state on stale revisions or uncertain outcomes.
