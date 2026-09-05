import { agentRazaviAuthoringCatalog } from "./agent-authoring-catalog.generated.js";

// Node-side consumers (local MCP helper) read the same catalog object the Kit
// serializes, so there is exactly one generated catalog source.
export { agentRazaviAuthoringCatalog };

/**
 * Small, provider-neutral operating material for an Agent that has no checkout
 * of this repository. The Kit has no Project data, credentials, or mutation
 * surface: it teaches a browser Agent how to use the existing session API and
 * the reviewed built-in authoring facts it needs before a first Snapshot has
 * any instances.
 */

export const AGENT_OPERATING_KIT_FORMAT = "icm-agent-kit-v1";
export const AGENT_OPERATING_KIT_VERSION = "4";

export interface AgentOperatingKitFile {
  path: string;
  content: string;
}

export interface AgentOperatingKit {
  format: typeof AGENT_OPERATING_KIT_FORMAT;
  version: typeof AGENT_OPERATING_KIT_VERSION;
  files: readonly AgentOperatingKitFile[];
}

const authoringCatalogContent = `${JSON.stringify(
  agentRazaviAuthoringCatalog,
  null,
  2,
)}\n`;

export const agentOperatingKit: AgentOperatingKit = {
  format: AGENT_OPERATING_KIT_FORMAT,
  version: AGENT_OPERATING_KIT_VERSION,
  files: [
    {
      path: "README.md",
      content: `# Interactive Circuit Maker Agent Kit

This private working folder is operating material for one browser-authorized
session. It is not a checkout of the editor and contains no Project data,
credential, or hidden tool.

Read \`AGENTS.md\`, then \`skills/icm-circuit-session/SKILL.md\`, then
\`references/authoring-contract.md\`. The checked-in
\`references/razavi-authoring-catalog.json\` gives the reviewed built-in
symbols needed to author from an empty Document. Fetch the published OpenAPI
before forming requests; it is the wire-contract authority.
`,
    },
    {
      path: "AGENTS.md",
      content: `# Operating boundary

- The live browser Project is authoritative. Read it through \`snapshot\`; do
  not guess existing IDs, Net membership, placement, pin positions, or
  revision. The Kit catalog is authoritative only for the listed built-in
  Razavi symbol IDs, canonical pin order, and variants before first placement.
- For a symbol absent from the Kit catalog, an imported/custom/PDK symbol, or
  an electrical fact absent from a Snapshot, stop and ask the human. Do not
  extrapolate from a label, symbol appearance, or another library.
- Use only the published HTTPS API. Do not use DOM, mouse, keyboard, visual
  automation, source repositories, or a second edit path to change a circuit.
- \`transact\` is the sole mutation path. Preserve human edits, locks, and
  revision conflicts rather than trying to overwrite them.
- Keep bearer tokens only in memory. Never place a claim code or token in a
  file, URL, log, rendered annotation, or user-visible response.
- The browser must be online while an operation runs; it may reconnect to the
  same Project/session after a browser restart. Treat a terminal session error
  as a request for new human authorization, not permission to retarget.
`,
    },
    {
      path: "skills/icm-circuit-session/SKILL.md",
      content: `# Interactive Circuit Maker live-session workflow

## Bootstrap

1. Redeem the human-provided claim code at \`/api/agent/claims\` to obtain the
   initial bearer and connector credential.
2. Keep the bearer only in memory. Store the connector only in private host
   credential storage, and exchange it through \`/api/agent/connectors/resume\`
   when the bearer expires. Reusing a live claim rotates both credentials.
3. Read \`/api/agent/openapi.json\`, then call \`capabilities\` once through
   \`/api/agent/sessions/{sessionId}/circuit\`.
4. Select only an authorized \`documentId\` and request one complete
   \`snapshot\` before deciding or editing.

## Create from an empty Document

For reviewed built-in Razavi assets, read
\`references/razavi-authoring-catalog.json\` rather than guessing a symbol ID
or pin order. The catalog contains no page coordinates: after placing objects,
the next Snapshot is the only source of their actual pins and positions.

1. Read the initial Snapshot. Allocate new object IDs that do not collide with
   it. Dry-run then commit ordinary \`add_instance\` edits for known catalog
   symbols. Omit \`symbolVariantId\` to use the catalog default unless a
   listed variant is intentionally required.
2. Create supply using the catalog primitive: a named \`VDD\` rail is
   \`add_power_rail\` with \`netName: "VDD"\`, explicit scope, and
   \`powerDomain: "vdd"\`, never
   \`add_instance { symbolId: "vdd" }\`. \`ground\`, \`port\`, and
   \`port-filled\` are ordinary catalog symbols.
3. Refresh Snapshot before wiring. Prefer one high-level \`wireIntent\` for
   each ordinary connection; it derives the necessary Net, Route, and
   Junction edits from the current Document.
4. MOS \`B\` remains an electrical pin even when the default three-terminal
   variant hides it. After supply Nets exist, inspect the refreshed
   \`mosBulk\` facts and use the advertised typed bulk/default edits only when
   an explicit policy is required. Never assume \`B = S\`.

## Edit loop

1. Reason from the Snapshot's resolved pins, Nets, Routes, Junctions, locks,
   diagnostics, and revision.
2. Use the Snapshot revision as \`expectedRevision\`. Dry-run a non-trivial,
   multi-object, routing, or connectivity transaction.
3. Commit exactly the reviewed edits while the revision is unchanged.
4. Render after a successful commit and read a fresh Snapshot before handoff.

## Files and recovery

Use the separate \`files\` resource only when capabilities and scope advertise
it. Staging is not import: a browser human must approve replacement.

On \`STALE_REVISION\`, refresh the Snapshot and reconsider. On an uncertain
transport result, retry only the exact same request ID and payload. On bearer
loss or expiry, resume once with the connector; on invalid connector, revoked,
expired, or replaced Project state, stop and ask for a new connection.
`,
    },
    {
      path: "references/session-contract.md",
      content: `# Session contract quick reference

Circuit operations are exactly \`capabilities\`, \`snapshot\`, \`transact\`,
and \`render\`. Inside transact, use exactly one of edits, structureEdits,
wireIntent, semanticIntent, or a browser-planned command. Commands reuse GUI
planners and the same Edit Engine. Simulation is a sibling resource with
capabilities/prepare/start/read/cancel/export; files remain in File Resource.
Neither expands the four Circuit operations. The Kit's static
authoring catalog is not Project state and is not a Circuit operation.

Use request IDs only for an exact-payload retry. A changed request gets a new
request ID. The current OpenAPI and \`capabilities\` response define the exact
available scopes, edit kinds, and limits for this session.
`,
    },
    {
      path: "references/authoring-contract.md",
      content: `# Built-in authoring contract

## Authority split

- \`razavi-authoring-catalog.json\`: reviewed built-in Razavi asset IDs,
  canonical pin order, default variants, and the VDD authoring primitive.
- \`snapshot\`: every object that already exists in the browser Document,
  including real object IDs, page positions, current Net membership, locks,
  revision, and MOS bulk status.
- OpenAPI plus \`capabilities\`: request shape, permitted edit kinds, scopes,
  and limits.

No dynamic catalog operation exists. A built-in absent from this catalog, a
custom/PDK asset, or a pin mapping not reported by Snapshot is a human-fact
boundary.

## Product primitives

- \`vdd-rail\` is a semantic authoring primitive. Submit the OpenAPI-defined
  \`add_power_rail\` edit with explicit \`netName\`, scope, and
  \`powerDomain: "vdd"\`; \`vdd\` is never
  a symbol ID.
- \`ground\`, \`port\`, and \`port-filled\` are ordinary symbols in the
  catalog. Their canonical pins are listed there.
- A three-terminal MOS presentation hides only artwork. Its canonical \`B\`
  pin remains electrical. Supply defaults are explicit Snapshot/Edit-Engine
  facts, not an inference from MOS orientation or a visible rail.

## Two-phase construction

1. Create reviewed symbols and semantic primitives with unique new IDs.
2. Refresh Snapshot and wire only returned endpoints/route segments through
   \`wireIntent\` or advertised typed edits.
3. Render, inspect diagnostics, and refresh before handoff.
`,
    },
    {
      path: "references/razavi-authoring-catalog.json",
      content: authoringCatalogContent,
    },
  ],
};
