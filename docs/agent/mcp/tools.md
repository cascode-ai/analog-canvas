# MCP editing tools and local inspection

Call tools with their listed schema. Action semantics are in
[authoring](../shared/authoring.md); this page covers MCP specifics.
`connect`'s `access.tools` names every tool, grouped `session`, `circuit`,
`project`, `gallery`, `components`, `simulation` and `files`
([availability](../mcp-quickstart.md#connect)).

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
`actionIndex` and `actionKind`; `ACTION_COMPILE_FAILED` also lists every
refused action in `issues`.

`apply_actions` takes one atomic edit batch, wire batch, planned command or
focus per call. Split create and wire phases so new pin geometry comes from
a Snapshot (`pins` read). Several `connect` actions share one call,
planned in order and committed once (one Undo); a failure leaves no wiring.
`wireIntent` takes one intent or an ordered array. Multiple taps on one original Route may use pre-batch Route/leg IDs;
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

For a local review writeback, read `review_delivery`, then call it with
`action:"changes"` and the returned `target` as `expected` and
`projectRevision`. The comparison covers the selected Cell and its descendants
and uses the original dependency bytes held in the delivered Project. It
names their `sourceVersion`. Difference locations point into those original
files. An added Instance has terminals and its Cell but no original line.
An equal comparison can report
`drawingChanged:true`.

Before writing files, call `verify` with
`expectedSource:{rootPath,entryPath,expected,projectRevision}` and check that
`comparison.sourceVersion` matches the change list. Review conflicts with the
user. Edit the original files, then repeat `verify` against the same draft.
A changed review target needs a fresh read. Confirm `comparison.status:"equal"`
before claiming structural agreement. When delivering with `open-local`,
check that its source version matches the verified version. Report incomplete
or truncated comparisons and keep the working copy available. A changed
Cell binding may need a separate check of the new definition. Model bodies
and library sections can require manual comparison.

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
  Cell/file IDs; an empty source is `COPY_EMPTY`. Missing expected revisions
  are read automatically.
- `publish`/`update` return `galleryEntryId`, `url` (`/g/<id>`) and
  `previewRevision` and bind the copy to the entry. The AI mark is changed only
  by its author in the Editor; AI accounts always keep it. A background tab is
  `WORKSPACE_NOT_SHOWN`: activate it. Older pairings lack `gallery.publish`
  and need a new connection. `SIGN_IN_REQUIRED`: sign in to the Editor, not
  another Claim; `SESSION_NOT_FOUND`: pair again.
- AI-account redraws: as an AI account, `list` with `scope:"ai-seats"`
  (`status:"rejected"` for the rejected ones) shows every AI account's
  circuits with status and `rejectReason`. Open or read one, fix what the
  reason names, then `update` with its `galleryEntryId` and `takeOver:true` to
  publish your redraw under your own name. The redraw keeps the entry's status:
  a rejected one stays rejected until the Owner restores it. A person's circuit
  is never listed there or taken over; a person's session listing them gets
  `AI_ACCOUNT_REQUIRED`.
- `project_code` and `netlist_code` reads return the requested export plus
  each Cell in `cells`, so one broken Cell cannot hide another.

`import_file` with `action:"open-local"`, `taskRef`, `rootPath` and
`entryPath` opens a local Project, SPICE, Spectre or RNL-annotated netlist in
Canvas Web. Choose the smallest local root containing the entry and its
referenced files. Preserve paths relative to that root. The adapter follows
local SPICE/Spectre includes and explicit RNL package paths. A transfer accepts
up to 24 files and 10 MB. An unresolved dependency, a relative one outside the
root, or an RNL package outside it stops delivery with its reference. An
include named by an absolute, drive or URL path (a foundry's library, such as
`include "/pdk/.../toplevel.scs" section=tt`) stays in the file as written and
is neither read nor sent (`SPICE_SOURCE_INCLUDE_EXTERNAL`). A model whose card
it holds keeps its name; give its device type in `modelTypes`
(`{"nch_mac":"nmos","pch_mac":"pmos"}`; `nmos`, `pmos`, `npn`, `pnp` or
`d`) instead of editing the files. A card the sources give decides, then an
RNL drawing's symbol; `LOCAL_MODEL_TYPES_GIVEN` lists the types used. A
Spectre MOS card the import does not convert (`bsim3v3`, `psp103`, …) draws
its parts by its `type=`, unconverted (`SPICE_CONVERSION_MODEL_EXTERNAL`). A
refusal keeps its error and recovery hint and also reports `timingMs` for the
stages it ran.

The load receipt names the task, session, workspace, Project and Cell. It
reports the structure and Cell revisions, original-byte SHA-256 of each file,
and the source version derived from the entry and sorted path/hash pairs.
Delivered netlists retain original hashes in Project source records, including
drawing packages. Converted fragments use `derived-sha256:` and stay out of
the version. A native Project delivery uses the bytes of the Project file.
Project Info → Imported source shows the same version in the tab. Compare
`source.drawing`, `source.electrical` and `source.diagnostics` separately.
`electrical:"verified"` records an RNL import equivalence check against the
structural source, independent of simulation. Parsed source positions refer
to the converted representation when a native source was converted.

RNL opens with Canvas appearance. Pass `rnlAppearance:"source"` to keep the
authored appearance. Repeat the call with the same appearance to locate a
matching open copy with its current edits. Both appearances report the same
source version for identical bytes. Project Info shows the appearance of
the open copy. To keep working in a tab opened before the appearance choice
was available, reuse its workspace with `open_canvas`.
`previousRevision:"recovered-snapshot"` refers to the browser's restored
snapshot, and `"unconfirmed"` to a fresh import whose earlier working
revision is unavailable. A foreground delivery binds the task to the returned
`workspaceId`. Bind explicitly for a background delivery. `timingMs.transfer` estimates transport and
staging overhead apart from the editor's measured import.

`export_file` downloads a local artifact; its `warnings`, when present, say
what the artifact leaves out (a PDF names characters no PDF font holds, which
SVG and PNG keep). `import_file` staging validates a
candidate (Cadence globals use `action:"stage-spice", namingProfile:"cadence-bang"`).
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

### From a netlist to a review

Decide how to draw separately from how to present. Reuse a usable Canvas
Project or the layout and routing from an existing RNL drawing. Check that
known Cell Pins and Ground use native symbols and MOS bulk branches are
dashed in Canvas appearance. Use source appearance when the user wants the
authored styling. An explicit redraw calls for a new layout. For a local
source, `open_canvas` and `import_file` `open-local` bring the exact entry and
dependencies into the task; the user need not prepare a tab. For a plain
netlist, inspect the imported Instances, models, terminals and Nets. Arrange
the parts and use [native routing](../shared/authoring.md): place tray
Instances or adjust the initial layout, then route the missing connections.
If the user asks for RNL or works in RNL files, author the drawing comments,
validate them with upstream RNL tooling, then deliver the annotated entry
with `open-local`. Keep the electrical lines and dependency files intact.

Check electrical correspondence and visual completeness separately. Compare
with the [reference netlist](#comparing-with-a-reference-netlist) where the
format is supported. Check the critical connections, labels and pin landings
in the drawing. Report unresolved mappings, missing geometry and any
inconclusive comparison. Do not substitute devices or change the circuit to
make an image render. A clean image is not an electrical check.

In the tab holding the delivered working copy, whether a Web task or a tab
paired by Claim, call `review_delivery` with `action:"read"` after opening
and selecting the requested Cell. Use the live receipt's `target` as
`expected` and pass `projectRevision` for subsequent review actions. After
checking the complete drawing, `mark-ready` records the first review-ready
Project as the original. A bare import stays pending until the drawing is
ready. `open-original` opens that frozen Project in a fresh tab and binds
the task to it. If the snapshot is unavailable, report the refusal and keep
the working copy. A repeat `open-local` with the same source and appearance
returns the existing working copy.

For an explicit local save, use `review_delivery` with `action:"save"` and a
new `.icproj.json` path. The receipt names the whole saved Project revision
and local file. `canvasSaved:false` means the file was written and the live
Canvas did not confirm that it still matches. Keep any newer changes in the
working copy. Project Info shows the embedded netlist source on reopen,
including its dependency hashes. That version is distinct from the input
version of the saved Project file.

To review an object, select one Instance or highlight a Net in the delivered
tab. Open **Project Info → Review feedback**, add the comment, and copy it
into the original Agent chat. The copied `Canvas review reference` gives
the arguments for `review_delivery` `action:"locate"`. The tool checks the
task's active workspace, source version, whole Project revision, Cell and
occurrence path before focusing the exact object. A version mismatch or
missing object needs an explicit report to the user. When the recorded
workspace is still open, activate it before retrying with the same reference.

- For a chat image, use `export_file` with `artifact:"png"`,
  `includeReview:true`, the Cell's `documentId` and a local `outputPath`,
  and show the resulting image. Use a new path for each revision and crop. Canvas
  may open behind this workflow to render it. For a detail, pass Canvas
  coordinates as `bounds:{x,y,width,height}`; get positions from `inspect`.
- Keep the export's `taskRef` and `review` receipt. The latter names the live
  Project, workspace, Cell, structure and Cell revisions, and, for a delivered
  local source, its version and whether the working copy was modified or
  recovered. `unsaved` describes the current working copy. `unplacedInstances`
  counts undrawn Instances; check visible routes separately. Pass the
  receipt's `projectId`, `workspaceId`, `workspaceGeneration`, `documentId`,
  `structureRevision`, `revision` and `sourceVersion` (when
  present) as `expected` to export the same revision.
- For Web, reuse `open_canvas({taskRef})` and wait for `projectRead:"ready"`.
  Activate the recorded workspace if needed, then use `circuit_view` to open
  the Cell and fit or select the requested objects. Confirm with
  `project_cells({taskRef,action:"workspace",request:{action:"list",includeReview:true}})`:
  compare the active workspace, its Project and structure revision, and
  its `review` generation, active Cell and source version with the picture
  receipt. Compare that Cell's revision in `cells`. If the list cannot confirm
  these fields, do not claim it shows the same revision. Switching presentation
  does not reimport or redraw.
- After a human edit, a request for the old image revision returns
  `REVIEW_TARGET_CHANGED`. Read the live revision, label the change and export
  the current image. A restored working copy has a new `workspaceGeneration`;
  read its current state and label the recovery. Do not present a cached
  image as current when the live Canvas cannot be confirmed.

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

- Authoring: update replaces the raw input with a complete `candidate`,
  invalid text included; save keeps a non-executable draft; Apply with
  `dryRun` validates through the GUI planner. See the shared
  [authoring rules](../shared/authoring.md#external-model-sources).
- `read` returns the complete package and its SHA-256; capabilities do not
  certify simulation. `inspect` returns a capture's origin and destination.
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
- Names may repeat. Identical same-author packages return
  `COMPONENT_ALREADY_PUBLISHED` with the ID (`error.component:{id,revision}`
  under `publicationVersion:1`); an identical update keeps the revision.
  `publicationVersion:1` returns `outcome`, `recovered`, `association` and
  duplicate references.
- Library `publish`/`update` act as the signed-in Editor account. After an
  unknown publication outcome retry with identical inputs, the same
  `idempotencyKey` (kept seven days) and the original account, even after
  local edits; reuse `requestId` for any uncertain write. A pending
  association is already public: recover it, never republish. Project undo
  affects only the local association. Authentication failures mean sign in;
  stale revisions mean reread.
