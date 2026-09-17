# Interactive Circuit Maker live-session workflow

## Bootstrap

This is the raw HTTP path, selected explicitly by the user. Failed MCP host
loading is not permission to switch transports. Paths in backticks below are
relative to the extracted Kit root, not this nested file.

1. Redeem the human-provided claim code at `/api/agent/claims` to obtain the
   initial bearer and connector credential.
2. Keep the bearer only in memory. Store the connector only in private host
   credential storage, and exchange it through `/api/agent/connectors/resume`
   when the bearer expires. Reusing a live claim rotates both credentials.
3. Read `/api/agent/openapi.json`, then call `capabilities` once through
   `/api/agent/sessions/{sessionId}/circuit`.
4. Select only an authorized `documentId` and request one complete
   `snapshot` before deciding or editing.

The caller owns lifecycle: keep bearers in memory and connectors in private
credential storage; resume through the server even if a saved deadline looks
stale. Respect terminal revocation/expiry. Retry uncertain writes only with the
identical request ID and payload. Honor `Retry-After` with bounded retries and
verify artifact byte length and SHA-256 before saving downloads.

## Create from an empty Document

For reviewed built-in Razavi assets, read
`references/razavi-authoring-catalog.json` rather than guessing a symbol ID
or pin order. The catalog contains no page coordinates: after placing objects,
the next Snapshot is the only source of their actual pins and positions.

1. Read the initial Snapshot, then follow the shared native authoring workflow
   in `references/authoring-contract.md`. Prefer `transact.command` with
   `place-components` over bare `add_instance`: the browser creates owned
   displays and formal Cell terminals through the same planners as the GUI.
   Read the command schema from OpenAPI; MCP action names are not HTTP requests.
2. Create supply using the catalog primitive: a named `VDD` rail is
   `add_power_rail` with `netName: "VDD"`, explicit scope, and
   `powerDomain: "vdd"`, never
   `add_instance { symbolId: "vdd" }`. `ground`, `port`, and
   `port-filled` have catalog symbols; formal Ports must use native placement.
3. Refresh Snapshot before wiring. Prefer one high-level `wireIntent` for
   each ordinary connection; it derives the necessary Net, Route, and
   Junction edits from the current Document.
4. MOS `B` remains an electrical pin even when the default three-terminal
   variant hides it. After supply Nets exist, inspect the refreshed
   `mosBulk` facts and use the advertised typed bulk/default edits only when
   an explicit policy is required. Never assume `B = S`.

## Edit loop

1. Reason from the Snapshot's resolved pins, Nets, Routes, Junctions, locks,
   diagnostics, and revision.
2. Use the Snapshot revision as `expectedRevision`. Dry-run a non-trivial,
   multi-object, routing, or connectivity transaction.
3. Commit exactly the reviewed edits while the revision is unchanged.
4. Render after a successful commit and read a fresh Snapshot before handoff.

## Files and recovery

Use the separate `files` resource only when capabilities and scope advertise
it. Staging is not import: a browser human must approve replacement.

On `STALE_REVISION`, refresh the Snapshot and reconsider. On an uncertain
transport result, retry only the exact same request ID and payload. On bearer
loss or expiry, resume once with the connector; on invalid connector, revoked,
expired, or replaced Project state, stop and ask for a new connection.
