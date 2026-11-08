# Agent Circuit API

Status: `accepted`

Version: `3.0`

Primary owner: `packages/agent-adapter`

The generated OpenAPI at `/api/agent/openapi.json` is the normative wire
contract; transport, pairing and scopes are in
[web sessions](web-agent-session.md).

## Circuit operations

`POST /api/agent/sessions/{sessionId}/circuit` with exactly four operations:
`capabilities`, `snapshot`, `transact`, `render`. Every request carries
`apiVersion: "3.0"`, a stable `requestId` and the `sessionId` from claim
redemption; the bearer goes only in `Authorization`. No versioned URL aliases,
query operations, dynamic catalog snapshots or compatibility readers. Project
structural writes are a form of `transact`; `snapshot.traceNet` (read-only
trace from the GUI's Project Connectivity Index) is a `snapshot` option; the
session status read is not a Circuit operation. None is a fifth operation. The public Agent Kit's static catalog is
not Document state or an operation.

- `capabilities` reports operations, permissions, edit kinds,
  `commandKinds`, `transactionForms`, resource capabilities and server limits.
  Requests are bounded by bytes (`maxRequestBytes`), never by a count of
  edits, actions, wires, parts or selected objects; a transaction of any size
  commits once, as one undo. `maxTransactionEdits` stays reported (256) for
  clients that read it and is not enforced.
- `snapshot` returns one complete read-only Document plus the bounded Project
  index (with `structureRevision`).
- `render` returns a bounded formal or diagnostics SVG.

An incompatible client gets the version diagnostic, never an incompatible
Snapshot. Saved simulation containers use Folder identity (no parallel Setup
writer). GUI and Agent writes cross the same Edit Engine and permission
checks. Project file loading stays independently backward-compatible.
Additive Snapshot fields (Instance `styleOverride`, `signalFlowParameters`,
Cell interfaces, bulk defaults, inductor couplings, external definitions)
appear only when present. Local and production codecs share one schema.

## Snapshot semantics

- Connectivity is bidirectional: each resolved pin reports `netId`; each Net
  its complete terminal membership. `port`/`port-filled` are ordinary
  single-pin Instances; formal terminal mappings report ID, direction, Net and
  their Port Instance, never a separate object class.
- Each placed pin reports read-only `connection`: `contactPoint`, persistable
  `gridLanding`, derived `escapePath`, `outward`. Route polylines and contact
  points may hold decimals; authoring uses endpoint identity and
  `gridLanding`, never copies `contactPoint` into a Junction or waypoint.
- Nets are resolved Logical Nets (same names, scopes, power roles and
  conflicts as GUI, ERC and export). `net.id`/`netId` is a deterministic
  representative for that Document revision, not persistent: discard all of
  them after any commit, stale-revision result or uncertain outcome. Naming
  is marker-owned; raw Base-Net name/scope/role writes, typed Evidence and
  terminal-Net edits (kept for GUI parity) are not a naming API.
- `textBounds` (geometry Snapshot) adds each annotation's `text.position` and
  `text.bounds` as label placement measures them. `instanceLabels` (full or
  `pins`) adds per-instance `annotations` (`id`, `kind`, `parameter`,
  `visible`, `resolvedText`, `position` = the anchor `move-annotation` sets).
  Both are opt-in so released strict clients keep their fields.
- RichText uses the Project's one union: styled runs or one
  `{kind:"math", latex, display}` run. Generated SVG, glyph paths and formula
  metrics are never accepted as mutation data.
- VDD is a named Net with rail geometry and a bound annotation, never a
  symbol; MOS bulk is a terminal/Net fact ([schematic model](schematic-model.md)).

## Transactions

- Edits follow the [Edit Engine](edit-engine.md): one Document per
  `expectedRevision`; Cell and interface work in `structureEdits` with
  `expectedStructureRevision`; all or nothing; optional dry run. A Snapshot or
  whole Project is never a mutation payload. Reuse a `requestId` only for an
  exact-payload retry.
- `transact.command` (exclusive form): Model switching, Cell lifecycle, copy,
  alignment, selection transforms via the GUI planners; structural commands
  require `expectedStructureRevision`.
- `transact.actions` (exclusive form): MCP `apply_actions` actions
  ([authoring](../agent/shared/authoring.md)). The browser plans and commits
  them as one edit batch, wire batch, command or focus operation. The MCP
  Helper never plans them itself: an editor not listing `actions` in
  `transactionForms` gets `EDITOR_OUTDATED` and nothing is sent. Refusals:
  `ACTION_BATCH_NOT_ATOMIC` (with `error.calls`, the consecutive calls to send
  instead), `ACTION_COMPILE_FAILED` (malformed or naming absent objects); each
  names `error.actionIndex`/`error.actionKind` and its message starts
  `actions[i] (kind):`. `ACTION_COMPILE_FAILED` checks every action and lists
  each refused one in `error.issues` (`actionIndex`, `actionKind`, `message`,
  in list order; the first is `error.actionIndex`); an action naming a part a
  refused placement would have made is not checked further and carries
  `dependsOn`, that placement's index. A placement origin off the Document
  grid is refused here. Pass-through forms keep their `expectedRevision`
  check; target-resolving lists need Snapshot permission and are planned and
  committed in one step on the current Document. A no-change list answers
  `applied: false` with no history entry.
- `focus` beside other actions adds no transaction: shown after commit (not on
  dry run), result in `semantic`, needs `editor.semantic-control`; a view that
  cannot show it leaves the commit with a warning; a host without a live view
  skips it with `VIEW_STEP_SKIPPED`. A standalone view request needs a live
  view.
- Undo/redo use the shared browser history and require all edit permissions;
  no private Agent stack. Receipts keep the server diff, diagnostic delta and
  locators.
- `wireIntent` uses the interactive Wire planner. `routingMode` is
  `orthogonal` (default), `octilinear` or `free`
  ([routing rationale](../adr/routing.md)); left out, waypoints with a 45°
  step are refused. A tap on a Route (`wire-at`, `route-segment`) lands
  exactly there and must be on the pin grid. `cornerOrder` picks the
  diagonal/orthogonal pair when an exact 45° leg cannot reach.
- After a stale revision or uncertain result, refresh and reconcile; never
  replay a changed or obsolete transaction.

`@icm/agent-routing` expands a complete Agent-authored RouteGraph into typed
edits; it chooses no topology and yields no edits on conflict
([types](../../packages/agent-routing/src/types.ts)).

## Sibling resources

- `/files` (File Resource): bounded Project/formal-artifact download,
  Project/structural-SPICE candidate staging, simulation workspaces and
  artifacts. Staging never changes the browser Project; replacement needs
  explicit human approval.
- `/simulation`: prepare/run through the shared SimulationService
  ([execution](simulation-execution.md)); saved setup changes are Project
  structure edits.
- `/projects` (`resources.project`):
  - `list-gallery`, `read-gallery-entry`, `read-gallery-entries` (size
    bounded): cursor-paged public entries with Project Code, optional netlist
    and `aiGenerated`; simulation folders only per
    [testbench privacy](community-gallery.md#testbench-privacy). Adapters
    parse strictly and report unknown fields with where to update
    (`/api/agent/mcp-manifest.json`); the MCP release reading a new field
    ships before the Editor sends it.
  - `publish-gallery-entry` / `update-gallery-entry` publish the tab's working
    copy via the Editor's Publish client (`name`, `description`, `tags`),
    always AI-marked (only the author unmarks, in the Editor); update defaults
    to the copy's source entry and keeps unnamed fields; both answer
    `galleryEntryId`, `url`, `previewRevision`. An AI account's
    `takeOver: true` republishes another AI account's entry under its name
    ([take-over](community-gallery.md)), never a person's.
  - `list-gallery` `scope: "ai-seats"` lists every AI entry (incl. rejected,
    withdrawn) with `status` and `rejectReason`, `status` filtering; a person
    gets `AI_ACCOUNT_REQUIRED`; `status` alone is `GALLERY_STATUS_NEEDS_SCOPE`.
  - `read-project-code`/`replace-project-code`, `read-netlist`/
    `replace-netlist` use the Editor's planners with structure-revision guards.
    Netlist replacement is limited to device names, model targets and
    parameter values; topology goes through Project Code or transactions.
  - `list-projects`, `list-cells`, `import-cell`
    (`importMode: "project-local-copy"`, needs `expectedStructureRevision`;
    repeats report `already-imported`). Failures carry `recovery`: `sign-in`,
    `refresh`, `fix-input` or `retry`.
  - Scopes: Cloud Cell ops `project.import`; code reads `project.download`;
    writes their Circuit edit scopes; Gallery reads `circuit.snapshot`;
    publication `gallery.publish` (no edit scope implies it). No second Cloud
    store or write path.
- No arbitrary host files or code execution; authored SPICE runs only in the
  isolated executor.

## Model sources

`apply_model_source` accepts native `spice`/`spectre` owners with optional
`transform.language`/`transform.process`; GUI and Agent share one converter,
dependency validation and atomic Apply; saved drafts may keep a distinct
language. File Resource spans with
`derived:true` and `sourceLength` navigate to the native owner and never
authorize byte-reverse edits.

## Acceptance

Generated JSON Schema/OpenAPI match the runtime schemas; contract tests cover
auth, version rejection, capabilities, topology, edit parity, request-ID
binding, revision conflict, render bounds and File Resource approval.
