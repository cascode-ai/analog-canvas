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
export const AGENT_OPERATING_KIT_VERSION = "5";

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
- Use only the published session API: HTTPS, or HTTP on loopback for local
  development. Do not use DOM, mouse, keyboard, visual
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

1. Read the initial Snapshot, then follow the shared native authoring workflow
   in \`references/authoring-contract.md\`. Prefer \`transact.command\` with
   \`place-components\` over bare \`add_instance\`: the browser creates owned
   displays and formal Cell terminals through the same planners as the GUI.
   Read the command schema from OpenAPI; MCP action names are not HTTP requests.
2. Create supply using the catalog primitive: a named \`VDD\` rail is
   \`add_power_rail\` with \`netName: "VDD"\`, explicit scope, and
   \`powerDomain: "vdd"\`, never
   \`add_instance { symbolId: "vdd" }\`. \`ground\`, \`port\`, and
   \`port-filled\` have catalog symbols; formal Ports must use native placement.
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
- \`ground\`, \`port\`, and \`port-filled\` have catalog symbols and pins,
  but placing a formal Port also requires its owned Cell terminal and Net.
  Use the native placement command below, not a bare Port \`add_instance\`.
- A three-terminal MOS presentation hides only artwork. Its canonical \`B\`
  pin remains electrical. Supply defaults are explicit Snapshot/Edit-Engine
  facts, not an inference from MOS orientation or a visible rail.

## Two-phase construction

1. Create reviewed symbols using the native commands below.
2. Refresh Snapshot and wire only returned endpoints/route segments through
   \`wireIntent\` or advertised typed edits.
3. Render, inspect diagnostics, and refresh before handoff.

## Shared native authoring workflow (MCP and HTTP)

MCP wraps these operations in tools; HTTP sends the published Circuit
\`transact\` envelope with exactly one \`command\`, \`wireIntent\`, \`edits\`,
\`structureEdits\`, or \`semanticIntent\`. Read OpenAPI for field shapes and
current capabilities for authority. Never send an MCP tool envelope to HTTP.

- Placement: use browser command \`place-components\` (MCP
  \`apply_actions\` / \`place-component\`). Native placement creates attached
  Reference and Value annotations. For \`port\` / \`port-filled\`,
  \`reference\` names the new Cell terminal; its Port, Net and bound terminal
  display are created atomically. Refresh Snapshot before using its actual ID
  and pin positions. Ground and power markers are not named devices.
- Displays: set electrical values first, then use \`set-instance-display\`
  with \`showReference\`, \`showValue\` or \`showParameters\`. Transformer keys
  are \`k/lp/ls\`; T-Coil keys are \`k/l1/l2/cb\`. Unsupported keys reject the
  action. Do not replace these projections with free text.
- Net names: use browser command \`set-net-label\` (MCP \`add-label\` or
  Net Label \`edit-text\`). It creates the electrical name claim and attached
  annotation together. Supply \`position\` when creating a new label; use the
  published RichText \`runs\` shape (text runs use \`value\`, not \`text\`).
  A drafting text saying OUT does not name a Net.
- Read, edit, refresh, render and inspect diagnostics. Use current revisions;
  on a conflict reconsider instead of overwriting human work.

## Shared simulation and result handoff

Native meas computes metrics; source comments define optional acceptance rules:
\`* @spec peak <= 1.8 unit=V\`, \`* @spec bias range 0.4 0.6 unit=V\`,
\`* @spec delay target 1e-6 tol 1e-8 unit=s\`. Decimal/scientific literals only;
units declare the native numerical unit, with no implicit conversion. Use one
rule per uniquely declared measurement name. The shared \`outputData.specs\` and
\`specs.json\` report includes captured inputDigest, runId, source path/line,
value, expected condition, judgment and reason. \`specs.csv\` is portable. Missing
metrics, duplicate names, invalid rules and incomplete runs are not-evaluated;
no rule means unconstrained, never Pass. Reports are not reevaluated after edits.
Read raw/CSV through the existing authorized file API and plot externally.
Raw numbers live in \`result.data\` or \`result.json\`, with one complete
\`<analysis>-<record-index>.csv\` per record. New runs do not generate
\`outputs-*.csv\`, \`measurements.csv\`, \`device-operating-points.csv\`,
\`outputs.json\` or \`native-measurements.json\`. The legacy
\`outputData.analyses\` array is empty; do not read it for waveforms.
Only authored native meas values enter Specs; there are no automatic summaries.
Explorer presents \`specs.csv\`; \`specs.json\` remains available through File
Resource and full diagnostic export. Large receipts may omit inline outputs:
read \`result.json\` and \`specs.json\` by artifact ID instead.
Built-in Plot, Compare, OP presentation and simulation-plot image export are
retired; OP simulation itself is unchanged. No GUI or Helper step is required.

For results the human should inspect in the Project, use a \`project-folder\`
source, not a private session workspace. Create a canonical folder with
\`upsert_simulation_folder\` inside \`transact.structureEdits\` (MCP
\`simulation_folder\`), using the current Project structure revision and the
published folder schema. Save setup v4 source/config files through File Resource
\`simulation-input\` / \`update\` with a \`project-folder\` owner (MCP
\`simulation_files\`). Read the actual input revision before writing.

Use the sibling Simulation resource: \`capabilities\`, \`prepare\` with the
folder and current structure revision, \`start\` with the returned prepared ID
and digest, then \`read\` to completion. Preserve returned IDs; do not invent
profiles, analysis records, output IDs or revisions. Preparation is not execution,
and a started run is not a successful result. Read diagnostics and outputs, then
perform the requested measurements. For code-authoritative experiment config
version 2, author native \`save\`, analyses, \`meas\` and \`write\` in source;
there is no hidden final write. Config version 1's JSON output/measurement/
device-OP helpers are legacy-only, not the version 2 authoring path. Read the
returned config version and schema before choosing a helper.

Project-folder runs appear under Project runs; Open result restores a finished
run without rerunning it. Completed handoffs are archived in this browser/origin,
not Cloud Save. Check warnings: storage failures can leave session-only results.
Session-workspace results have no Project folder to attach to. Normal Project
JSON exports contain sources, not results; Project + results ZIP is an evidence
bundle, not an importable Project format. Never claim a result was saved merely
because the run started or a source Project was exported.

## HTTP client responsibilities

This path is an explicit user choice, not an automatic recovery from failed
MCP host loading. Report the failed MCP stage before offering HTTP; successful
HTTP execution is not MCP acceptance.

HTTP uses the same server validation and permissions. The version-pinned package
in the MCP bootstrap manifest also runs without an MCP host: execute its binary
with --http followed by a published tool name (connect, connection_status,
get_context, etc.), supplying that tool's JSON arguments on standard input.
Use --http list-tools to read the exact argument schemas, and --http resource
with a resource URI on standard input for quickstart and authoring references.
This is a local entry into the same AgentSessionClient and tool handlers, not
another network protocol; no host installation or restart is required.
Set ANALOG_CANVAS_API_URL to this exact server. The default connector file is
isolated by origin; ANALOG_CANVAS_MCP_CONNECTOR overrides a file path, never a token.
For caller-managed exact retries, --http circuit accepts the published Circuit
request unchanged, including its requestId and transactionId. Keep that request
before sending; after an uncertain process exit retry it unchanged, never repeat
a higher-level write tool that would allocate a new ID.
Keep bearers in memory and connectors in private credential storage. Resume
through the server even if a saved connector deadline is stale; browser activity
may have renewed it. Respect terminal revocation/expiry. Retry uncertain writes
only with the identical request ID and payload; honor Retry-After for 429 with
bounded retries. Verify artifact byte length and SHA-256 before saving downloads.
Reuse this shared client rather than rebuilding lifecycle logic each turn.
Raw HTTP clients remain supported by the same published OpenAPI.
`,
    },
    {
      path: "references/razavi-authoring-catalog.json",
      content: authoringCatalogContent,
    },
  ],
};
