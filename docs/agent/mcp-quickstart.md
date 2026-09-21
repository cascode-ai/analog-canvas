# Analog Canvas MCP quickstart

Before pairing, `connection_status({"refresh":false})` reports the loaded
version and exact API origin locally. Match the current bootstrap manifest;
see [installation](mcp-install.md) only for setup problems.

Call `connect` with the Claim once, or omit it to resume the saved connector.
Its reply already includes context. Use that context immediately; no duplicate
`get_context` is required. Use `inspect` when you need objects/pins; it refreshes
by default. MCP manages credentials, request IDs and expected revisions.

Choose only the guidance needed for the task:

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
