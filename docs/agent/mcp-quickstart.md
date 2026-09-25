# Analog Canvas MCP quickstart

Before pairing, `connection_status({"refresh":false})` reports the loaded
version and exact API origin locally. When the origin matches, connect directly
and let the capabilities/bootstrap exchange confirm compatibility. Fetch the
bootstrap manifest and read [installation](mcp-install.md) only for a missing,
wrong-origin, or rejected incompatible adapter; installed-package integrity
checks are not part of ordinary pairing.

Call `connect` with the Claim once, or omit it to resume the saved connector.
Its reply already includes lightweight authoritative context. Capabilities and
that bootstrap Snapshot are fetched in parallel. Use the returned identity,
counts and revisions immediately; no duplicate `get_context` is required. Use
`inspect` when you need objects or pins. For only current placement, route,
annotation-anchor or drafting geometry, use
`inspect({"target":{"kind":"geometry","objectIds":["<stable-id>"]}})`;
this reads selected authored objects without constructing a full Snapshot.
Other inspections reuse the clean full Snapshot after its first load;
`refresh:true` forces a reread after a known human change or for reconciliation.
MCP manages credentials, request IDs and expected revisions.

Choose only the guidance needed for the task:

Use a focused tool's displayed parameters directly. For a hidden or unfamiliar
field, `describe_tool` can select its exact offline contract by `tool`, optional
`operations`, and `field` (argument JSON Pointer; `*` for array items).
For example, `{"tool":"simulation_plot","field":"/request/formats"}`
returns the format field and its context. Contract lookup is optional, not a
prerequisite for calling a tool.

- Circuit editing: [authoring](shared/authoring.md), then the built-in catalog
  before placing new symbols. [Tool details](mcp/tools.md) cover less common edits.
- Simulation: [simulation calls](mcp/simulation.md). Start with its quick path
  and follow its detailed-contract link only for the feature being used.
- Failures: [recovery](response-semantics.md). Keep uncertain write/start identities;
  reconcile before repeating a mutation. Never restart a run just to fetch results.

Sessions renew on Agent operations and manual edits, with a 30-minute idle
deadline. Keep the editor open. Closing connection details does not disconnect.
Read [session rules](shared/session.md) when investigating lifecycle behavior.
HTTP fallback requires the user's explicit choice; it is not MCP acceptance.

Use the planning revision for transactions; accepted receipts need no
confirmation reread. Replan after a stale-revision response and reserve
`verify` for milestones. Simulation `prepare` freezes a revisioned input, so
start/read/download need no circuit reread.
