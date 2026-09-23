# Session contract quick reference

Circuit operations are exactly `capabilities`, `snapshot`, `transact`,
and `render`. Inside transact, use exactly one of edits, structureEdits,
wireIntent, semanticIntent, or a browser-planned command. Commands reuse GUI
planners and the same Edit Engine. Simulation is a sibling resource with
capabilities/run/prepare/start/read/cancel/export; files remain in File Resource.
Neither expands the four Circuit operations. The Kit's static
authoring catalog is not Project state and is not a Circuit operation.

Use request IDs only for an exact-payload retry. A changed request gets a new
request ID. The current OpenAPI and `capabilities` response define the exact
available scopes, edit kinds, and limits for this session.
