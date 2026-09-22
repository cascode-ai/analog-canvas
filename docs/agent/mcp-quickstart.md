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
`inspect` when you need objects or pins. Unchanged reads reuse the clean full
Snapshot after its first load; set `refresh:true` after a known human change or
when explicitly reconciling. MCP manages credentials, request IDs and expected
revisions.

Choose only the guidance needed for the task:

Use a focused tool's displayed parameters directly. If a field is hidden by the
host or unfamiliar, `describe_tool` returns exact contracts offline: omit
selectors for the directory, select `tool` + `operations` for complete call
envelopes, or add `field` (argument JSON Pointer; `*` for array items). For example,
`{"tool":"simulation_plot","field":"/request/formats"}` returns only the format
field and its context. Reuse it within the returned `contractVersion`; fetching
a contract is optional, never a prerequisite. Use `editKind` for one low-level
edit. Existing resource URIs and broad tool entry points remain available.

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
Resources describe capabilities; reading them is not an authorization gate.

Transactions carry the revision of their planning Snapshot. Do not refresh just
to confirm an accepted commit receipt. A stale-revision response causes a fresh
read and replan; `verify` is for a milestone or reconciliation, not every small
edit. Simulation `prepare` freezes one explicitly revisioned input, so
start/read/download do not reread the circuit.
