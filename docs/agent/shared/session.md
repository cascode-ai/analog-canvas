# Session contract quick reference

## Connection

The current copied handoff authorizes MCP-first connection with raw HTTP Kit
fallback before pairing. An older handoff without that permission needs an
explicit HTTP choice; a user's MCP-only restriction always wins. Announce the
failed setup stage and chosen transport. The package's HTTP CLI still needs
its Node runtime and is not the runtime-independent fallback.

Fallback handles host/runtime/download/startup/loading obstacles. Integrity
or runtime-identity failures stop; authorization and session failures follow
session recovery. Choose one transport before redeeming the Claim. After an
uncertain redemption, reconcile through that transport rather than redeeming
again to switch. Keep an established connection on its transport.

Success requires pairing and reading the actual Editor circuit; name MCP or
HTTP. A local handshake, written configuration or session status alone is not
acceptance. HTTP success does not establish MCP loading. Keep the Editor open
and the Claim/credentials private; request a fresh Claim only after expiry or
terminal session recovery requires it.

## Operations

Circuit operations are exactly `capabilities`, `snapshot`, `transact` and
`render`. A transact carries exactly one of edits, structureEdits, wireIntent,
semanticIntent, a browser-planned command, or high-level actions; commands and
actions reuse the GUI planners and Edit Engine. Simulation
(capabilities/run/prepare/start/read/cancel/export) and File are sibling
resources. The static authoring catalog is not Project state.

Reuse a request ID only for an exact-payload retry. The current OpenAPI and
`capabilities` define this session's scopes, edit kinds and limits.

Dry-run is optional. Actions are planned on the current Document and
committed in one browser step; raw transactions and undo/redo keep their
revision guards, and not every concurrent human edit produces STATE_CHANGED.
Prefer receipts and targeted reads; refresh on stale revisions or uncertain
outcomes.
