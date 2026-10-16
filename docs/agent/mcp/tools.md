# MCP editing tools and local inspection

Call tools with their listed schema. Action semantics are in
[authoring](../shared/authoring.md); this page covers MCP specifics.

## Contracts and input errors

`describe_tool` (e.g.
`{"tool":"circuit_wire","operations":["connect"],"field":"/actions/*/from"}`)
and the resources `analog-canvas://contract/edits/{kind}` and
`analog-canvas://contract/tools/{name}` (with `operations` and `field` query
parameters) are equivalent optional lookups. Unknown selectors fail; broad
queries return a narrowing hint, never a truncated schema. Runtime validation
is complete, including constraints JSON Schema cannot express.

Invalid arguments return `INVALID_TOOL_INPUT` with `recovery:"fix-input"`; each
issue gives `path`, `code` and what would pass: unknown `keys` beside the
branch's `allowed` keys, accepted `values`, `minimum`/`maximum` with
`inclusive`, or the `expected` type. A missing or unknown
`kind`/`action`/`operation` lists the accepted `values`. Submitted values are
never echoed. Fix the arguments rather than reconnecting.

## Focused tools and batches

Focused circuit tools (`circuit_place`, `circuit_wire`, `circuit_transform`,
`circuit_selection`, `circuit_view`, `circuit_text`, `circuit_properties`)
take `{documentId?, actions:[...]}` and are projections, not separate engines:
the editor resolves each action into one transaction form and plans it with
the GUI's own planner. Commands that can share a transaction are planned in
order on a private copy, so later actions see earlier ones; `undo`/`redo` go
alone. An editor page loaded before it could plan lists answers
`EDITOR_OUTDATED`: reload and retry. `circuit_view` `focus` never edits (scope
`editor.semantic-control`).

A focused tool sends actions that cannot share a transaction as consecutive
calls in the compiler's order, reported under `split` (each call's actions,
outcome, revision). Each call is atomic; the first failure stops the rest and
earlier calls stay applied. `apply_actions` instead refuses such a mix with
`ACTION_BATCH_NOT_ATOMIC` and keeps every action family (Cell structure,
reset, history). A refusal names its action as `actions[i] (kind): …` with
`actionIndex` and `actionKind`.

`apply_actions` takes one atomic edit batch, wire batch, planned command or
focus per call. Split create and wire phases so new pin geometry comes from
a Snapshot (`pins` read). Several `connect` actions share one call,
planned in order and committed once (one Undo); a failure leaves no wiring.
`wireIntent` takes one intent or an ordered array (up to 64), within the edit
limit. Multiple taps on one original Route may use pre-batch Route/leg IDs;
the planner follows split children.

`advanced_transact` is the full typed-edit escape hatch with the same
validation and guards, not a permission tier. Its schema lists the exclusive
payload forms; the helper supplies IDs and Document/Project revisions. Nested
`transact_document` entries use their target revisions (current when omitted).
A refused payload names the field, e.g. `structureEdits[0].edits[1].kind`.
`analog-canvas://contract/advanced-edits` is the HTTP envelope for offline
tooling, not this tool's argument schema; do not load it for one edit.

Simulation tools take arguments flat (`{action, …}`) or in `request`. `detail`
`summary|full` shapes a response; `text|mapped` selects a source projection.

## Wiring and movement

- `connect` takes `via`, `routingMode` and `cornerOrder` (45° rules:
  [tool behavior](../tool-behavior.md)). The wire passes every `via` point
  (listed either direction); an order that would double back is refused. A
  wire from a pin or Junction keeps clear of other Nets and parts' bodies:
  without `via` it detours; with a blocked `via` it is refused naming the obstacle, the two
  points between which it meets it, and the clear path as `via` points to send
  (or why leaving the route to the editor fails too). With no clear path it is
  refused like `route-net`. A wire between free points is drawn as asked and
  may end on a wire to join it.
- `{kind:"wire-at",point,member:{instanceId,pinName}}` (or `net`) taps a trunk
  drawn earlier in the batch; `{kind:"net",net}` taps the conductor nearest the
  adjacent `via`, else the other end; `point` is a free end; `route-segment`
  takes a `legId` and `point`. Existing Junctions are reused.
- Pin targets take a Reference string or `instance:{kind:"instance",id}`.
  Name Nets through labels/markers, never raw Base-Net fields.
- `move` on a Junction (or a Junction selection translation) re-plans incident
  routes atomically keeping connectivity; a position normalization cannot keep
  is rejected. HTTP command `move-junction`; raw `move_junction` needs
  consistent caller geometry. Locked/trunk geometry is protected.
- A moved part joins a pin it lands on, as a drag does; wires it stretches
  across a part or another Net are redrawn clear, and labels newly covered move
  clear (also for rotate, mirror, arrange). `arrange` puts origins on one
  coordinate; the GUI's Align is `circuit_selection` `align`.
- `copy` follows GUI copy for internal wires and references. `detach-move`
  leaves wires behind; `unplace` keeps electrical facts in the tray. Drafting
  rotation in 45° steps matches the GUI; other drafting transforms use
  `upsert_drafting_object` rather than partially transforming a selection.
  `selection` takes `instanceIds`, `routeIds`, `junctionIds`, `annotationIds`,
  `draftingIds` (omitted lists empty).
- `disconnect` on a pin is the GUI's Delete connection where wires end on it,
  else Disconnect endpoint.
- `undo`/`redo` share the Editor's one chronological Project history, not an
  Agent or per-Cell stack; they cannot skip newer work on another Cell (the
  rejection names it). Structural history needs the current
  `expectedStructureRevision` (the client supplies it). Choose a `reset-cell`
  mode deliberately; routine layout uses move/transform/align.
- Colors use `set_instance_style_override`, `set_route_style_override`,
  `set_presentation_style` and annotation `textColor`.

## Inspect and verify

Mutation receipts include changed-object IDs, edit kinds, diagnostics and
deltas; do not rebuild the change from a partial Snapshot or count diagnostics
twice. On `STATE_CHANGED`, refresh and re-plan; never replay a changed payload.

`verify` gives fresh counts for milestones (`render` when visual review
matters). Beside `errors`, `warnings` and `total`, its `information` lists up
to ten findings a count would hide (`MOS_BODY_DEFAULT_SUPPLY`,
`MOS_BODY_OTHER_SUPPLY`; code, message, objectIds, and `documentId` when
another Cell's); `informationOmitted` counts the rest. Generated Net names stay
in `total`; diagnostics `inspect` lists everything.

`inspect` targets:

- `{kind:"document"}`: `detail:"full"` (often 100 KB; includes style
  overrides, `signalFlowParameters`, Cell interfaces, external Models) or
  `detail:"parts"`, a few KB listing every part (`id`, `name`, `symbol`,
  `position`, `rotation`/`mirror`) and Net (`id`, `name`, `powerDomain`).
- `{kind:"object"}` on a part also lists its labels as `annotations` (`id`,
  `kind`, `parameter`, `visible`, `resolvedText`, `position`); an older Editor
  answers `annotationsUnavailable`. Names match exactly: none is
  `OBJECT_NOT_FOUND`, several `NAME_AMBIGUOUS`, both as
  `error:{code,message,recovery}` with `candidates` (kind, id, name); a `net`
  target looks at Nets only. Ground is Net `0`; `GND`, `VSS`, `gnd`, `ground`
  find it (`matchedAs:"ground"`) unless something really has that name. A
  Cell's netlist names its ground pin VSS, or GND when VSS names another Net.
- `{kind:"pins",instanceIds}` also takes References and Cell Pin names:
  `resolvedNames` maps them to IDs; others stay in `missingInstanceIds` with
  `unresolved` reasons and candidates.
- `{kind:"geometry",objectIds}` reads up to 64 authored objects with revision
  and missing IDs, not pins or connectivity; `textBounds:true` adds each
  label's `text.position` (what `move-annotation` sets) and glyph `bounds`.
- `{kind:"activity"}`: recent local receipts and live relay records
  (failures, cache hits; lost on relay replacement). Not durable history or
  other people's edits.
- `{kind:"trace",netId}` returns the GUI's cross-Cell/global-Net trace; supply
  `hierarchyPath` for one occurrence of a reused Cell. Never infer cross-Cell
  connectivity from names.

`search` with `scope:"project"` searches authorized Cells.

### Comparing with a reference netlist

`verify` `expectedNetlist:{text:"<structural SPICE>",cell:"<reference root>"}`
(with `details:true`) compares the structural export by unique device
References and pin positions: formal ports, targets, literal parameters, scope
and endpoint membership (internal Net names ignored), recursing into matched
children (a child with the same port names pairs by name), never flattening or
guessing renames. Devices pair by card name, then Reference (`XM1` pairs `M1`);
card versus call for one name is a `binding` difference. `summary` (e.g.
`topology equal; 1 port-order, 8 binding-style differences`) precedes
`status` and `topology` (devices, targets, port sets, scopes, connections).
`compare` skips `{portOrder:false}`, `{bindings:false}`, `{parameters:false}`
or `{declarations:false}` (`.model` bodies, `.param`, preserved statements).

Parameters compare exact decimals after SPICE scaling; a reviewed SKY130 call
takes W/L in micrometres (`l=0.15` is `150n`), a model card metres; absent `m`
is 1 and absent reviewed counts (`nf`) their default. Details list at most 200
differences (literal strings, null when absent) with a truncation flag.
Literals over 4096 characters, parameterized hierarchy, expressions, model
bodies and unresolved statements are `inconclusive` (a type-only
`.model nch nmos` is compared). Port directions, model internals and
performance are not tested.

## Projects, files and Gallery

Tool descriptions cover each action; these are the extra rules.

- `disconnect` revokes the session; Project/Cell switches and Gallery
  navigation do not. `PROJECT_CONTEXT_STALE` needs refreshed context and a new
  plan, not a Claim; `NO_ACTIVE_PROJECT` means the browser is in Gallery. The
  client never redirects old writes. Closing a panel is not a disconnect.
- `project_cells` Cloud import copies one Cell's dependency closure (no live
  link); sign-in, stale-revision and library-compatibility failures are
  recoverable. `bind-workspace` targets a copy for this client's Circuit,
  Project, File and Simulation requests; `workspaceId:null` returns to the
  human's tab. A closed target fails `WORKSPACE_NOT_FOUND`: list and bind
  again, never redirect an edit. `new`/`rename` return the `workspaceId`;
  `rename` defaults to the bound copy.
- `gallery_circuits` `read` includes simulation folders only for your own
  circuits, any AI account's when signed in as one, and every circuit for the
  Owner's accounts. `insert` `position` is the GUI grab point (first placed
  Instance or clipboard anchor), not an offset; it is drawing insertion, not
  one hierarchy Instance. The Editor rechecks revisions and the bound Project;
  the receipt gives source/target IDs, revisions, object mapping and imported
  Cell/file IDs; an empty source is `COPY_EMPTY`.
- `publish`/`update` return `galleryEntryId`, `url` (`/g/<id>`) and
  `previewRevision` and bind the copy to the entry. The AI mark is changed only
  by its author in the Editor; AI accounts always keep it. A background tab is
  `WORKSPACE_NOT_SHOWN`: activate it. Older pairings lack `gallery.publish`
  and need a new connection. A `takeOver` redraw keeps the entry's status; a
  person's session gets `AI_ACCOUNT_REQUIRED` for `scope:"ai-seats"`.
  `SIGN_IN_REQUIRED`: sign in to the Editor; `SESSION_NOT_FOUND`: pair again.
- `project_code` and `netlist_code` reads return the requested export plus
  each Cell in `cells`, so one broken Cell cannot hide another.

`export_file` is not Cloud Save or publication. `import_file` staging is not
an import (Cadence globals: `action:"stage-spice", namingProfile:"cadence-bang"`);
`inspect` with `candidateId,documentId` reads a staged Cell as `documentCode`.
`import-cell` (`mode:"replace-body"|"append"`) needs `project.import` plus edit
scopes (no GUI approval); stale explicit revisions reject and the candidate is
consumed only on success. It keeps the target Cell ID, terminal IDs/order,
symbol layout and callers. An uncalled Cell without terminals adopts the
imported interface; otherwise names must match (append may use a subset) and
parameters be compatible. Append keeps interface owners, joins only matching
terminals or compatible globals, rejects local-name/Reference conflicts, keeps
the import-reference baseline (status becomes modified) and does not retarget
bulk (resolve missing bulk first). Geometry is not arranged.
`request-approval` is only for replacing the whole browser Project at the
human's wish. After a Project switch, refresh status and context.

## Timing and batch CLI

Results with HTTP activity carry `timing`: call duration and up to eight
recent attempts by requestId/resource/operation, with header wait, JSON
validation, retry delays and relay phases (restoration, pre-forward,
forwarding, completion; legacy `relayMs` is the last two) separate. Byte
streams stop at headers. `SLOW_RELAY` asks to inspect phases, not refresh
blindly. One-shot CLI adds `startupMs`. No payloads or credentials are logged.
HTTP 429 retries are bounded and honour `Retry-After` with identical body and
IDs; longer waits return to the caller. `analog-canvas-mcp --http batch` runs
one call per JSON line (`{"tool": "...", "args": {...}}`) on one session,
answering each with one line.

## User Components

The tool description lists actions and write fields; additionally:

- For the open GUI candidate use `authoring-read/update/save/apply`; send the
  returned `target` and `expectedCandidateRevision` on writes. Update takes a
  complete `candidate`; Apply takes `dryRun`. See the shared
  [authoring rules](../shared/authoring.md#external-model-sources).
- `browse` with `catalog:{version:1,type,authorId?,order}` filters/sorts the
  whole library before paging. `ifCatalogRevision` revalidates a complete
  cached query; `notModified` carries no entries. Cursors bind the query and
  catalog generation; a changed generation requires restarting the query.
- `browse` entries carry an optional diagnostic (component IDs, field paths,
  source spans, `edit-definition` recovery) to locate a strict read/insert
  refusal. `needs-repair` entries never block `nextCursor`. Older Editors have
  only strict `list`; both need only `circuit.snapshot`. Read before use.
- `fork` publishes the current revision as a new `newComponentId` you own.
  `insert` needs `expectedLibraryRevision`, target Project/Cell revisions and a
  position, in one undoable transaction. There is no history endpoint: reread
  a changed record. `publish` never becomes `update`.
- Identical same-author packages return `COMPONENT_ALREADY_PUBLISHED` with the
  ID (`error.component:{id,revision}` under `publicationVersion:1`).
- After an unknown outcome retry with identical inputs, the same
  `idempotencyKey` (kept seven days) and the original account, even after
  local edits. A pending association is already public: recover it, never
  republish. Project undo affects only the local association. Authentication
  failures mean sign in; stale revisions mean reread.
