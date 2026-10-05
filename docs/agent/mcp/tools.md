# MCP editing tools and local inspection

Use the listed tool schema directly. `describe_tool` offers offline, versioned
discovery from the same canonical definitions: no selectors lists tools and
operations; `tool` + `operations` selects complete call envelopes; adding `field`
returns argument fields and parent context. Array elements use `*`, for example
`{"tool":"circuit_wire","operations":["connect"],"field":"/actions/*/from"}`.
`editKind` selects a low-level edit, not a high-level action. Resource alternatives
remain `analog-canvas://contract/edits/{kind}` and
`analog-canvas://contract/tools/{name}`; the latter also accepts `operations`
(comma-separated) and `field` query parameters. These are optional lookups, not
steps required before calls. Unknown selectors fail explicitly; overly broad
queries return a narrower-selection hint, never a silently truncated schema.

Focused circuit tools retain the `{documentId?, actions:[...]}` call envelope:

| Tool                 | Scope                                                             |
| -------------------- | ----------------------------------------------------------------- |
| `circuit_place`      | Built-in symbol, Cell and existing-instance placement; power rail |
| `circuit_wire`       | Connect and disconnect                                            |
| `circuit_transform`  | Individual move/rotate/mirror/set-orientation, arrange, detach-move and rail span |
| `circuit_selection`  | Selection transform, copy and align                               |
| `circuit_text`       | Labels, annotations, text changes and annotation movement         |
| `circuit_properties` | References, parameters, formulas, model selection, display flags and aliases, block supplies |

Each is a projection and forwarding entry, not a separate edit engine. Existing
transaction boundaries still apply: actions of one focused tool that cannot
share one transaction (an edit batch beside a command) are sent as consecutive
calls in the order the compiler names, and the result says so under `split`
(each call's actions, outcome and revision). Each call is atomic; the first
that fails stops the rest, and the calls before it stay applied. `apply_actions`
refuses such a mix instead (`ACTION_BATCH_NOT_ATOMIC`, naming the calls) and
retains all actions, including mixed families, Cell structure, reset and history.
A refusal names the action it refused: `actions[i] (kind): …`, with
`actionIndex` and `actionKind`.

Simulation tools take their arguments flat (`{action, …}`) or in `request`,
whichever the call uses. `detail` goes where its value belongs: `summary` or
`full` shapes the response, `text` or `mapped` a source file's projection.
`advanced_transact` retains full editing authority. Neither is hidden dynamically.
The focused text declaration keeps common fields and plain strings directly
callable; recursive RichText details remain in its exact operation/field contract.
Runtime validation is always complete, including constraints not expressible in
JSON Schema. Native host conversion can still vary; an offline contract response
is data, not another automatically converted tool declaration.

## Create and edit

Use `apply_actions` for one atomic edit batch, wire batch, planned command or focus
operation per call. Split create and wire phases so new pin geometry comes
from Snapshot. The browser plans commands with the same planners as the GUI;
all resulting edits use the existing controller, revision and permission checks.

Several `connect` actions may share one call. They are planned in order on
private state and committed once, with one Undo; a failure leaves no partial
wiring. The existing `wireIntent` transaction field accepts one intent or an
ordered array (up to 64); the combined generated edits still obey the session's
edit limit. Mixed placement/wire/command calls still need separate phases.
Multiple taps on one original Route may use the same pre-batch Route/leg IDs;
the planner follows the split children within that batch.
For a new trunk created earlier in the same batch, use
`{kind:"wire-at",point:{x,y},member:{instanceId,pinName}}` (or optional `net`)
instead of fetching its generated Route IDs. Existing Junctions are reused.
`{kind:"net",net:"name-or-id"}` resolves the nearest conductor on that same
draft. Ordinary `point` remains a free endpoint. A tap at a different-Net
crossing is rejected even with a qualifier: a Junction there would short Nets.

`copy` follows GUI copy for internal wires and references. `detach-move` leaves
wires behind; `unplace` retains electrical facts in the Placement Tray.
`undo`/`redo` share one chronological Editor Project history, not a private Agent
or per-Cell stack. They cannot skip newer work on another Cell; the rejection
names the Cell to inspect. Structural history also requires current
`expectedStructureRevision` (the shared client supplies it). Routine layout
work should use move/transform/align rather than reset; choose a `reset-cell`
mode deliberately when discarding drawing state.

For reviewed targets, `set-model` uses the GUI's semantic planner and leaves
binding and invocation generation to the netlist generator; an empty model
target clears the binding. Use raw binding
edits only for custom or unreviewed definitions.

`selection` accepts `instanceIds`, `routeIds`, `junctionIds`,
`annotationIds` and `draftingIds`; omitted lists are empty.
`move` with a Junction target (or a Junction selection translation) plans its
incident routes atomically and preserves electrical connectivity. Locked/trunk
geometry is protected; a requested Junction position that conductor normalization
cannot retain is rejected, not reported as a successful move. The HTTP command
is `move-junction`; raw `move_junction` remains a low-level edit requiring the
caller to supply consistent incident route geometry.
Drafting rotations in 45-degree steps match the GUI's in-place rotation; other drafting
transforms use canonical `upsert_drafting_object` geometry rather than silently
partially transforming a mixed selection.

`connect` supports `via`, `routingMode:orthogonal/octilinear/free` and
`cornerOrder`. The wire passes through every `via` point: points listed
from `to` back to `from` are followed in that reverse order, and points no
order can follow without doubling back are refused with a reason rather than
committed as another path. A wire from a pin or Junction, whether to another,
to a `net`, to a tap on a wire or to an open `point`, also keeps clear of other
Nets' pins and wires and of parts' bodies: without `via` it detours, with
`via` that would meet one it is refused with the obstacle named, and with no
clear path at all it is refused like `route-net`. A wire drawn between points
alone is drawn as asked, and may end on another wire to join it. A
transaction that would put a Junction on another Net's wire is refused too.
A `route-segment` target uses the Route's stable `legId` and a `point`; the
server owns splitting and Junction creation.
Name Nets through labels/markers, never raw Base-Net fields.

`advanced_transact` is the full transaction escape hatch for typed edits not
covered by common actions, not a separate permission tier. It uses the same
validation and revision guards. Its listed schema/help describes the exclusive
payload forms; the Helper supplies IDs and Document/Project revisions.
Nested `transact_document` entries use their target Document revisions; one
left without `expectedRevision` takes that Document's current revision. A
payload the schema refuses names the field, such as
`structureEdits[0].edits[1].kind`.
The complete `analog-canvas://contract/advanced-edits` resource is the HTTP
request envelope for offline tooling, not the MCP tool's argument schema.
Do not load it merely to perform one edit.

Use `project_cells` to list the signed-in user's Cloud Projects, inspect their
Cell interfaces, and import one Cell into the open Project. Import copies the
complete local dependency closure through the same atomic planner as the GUI;
it does not create a live cross-Project link. The helper refreshes the Project
structure revision when the caller omits it. Sign-in, stale-revision, and
library-compatibility failures are recoverable and do not revoke the session.

`project_cells` with `action:"workspace"` exposes `request.action`:
`list` live Project tabs and Cell revisions; `activate` a tab; `open` a saved
Cloud Project (use `background:true` to leave the human's tab selected);
`save` (or `asNew:true`); `new` a blank working copy, as the tab strip's **+**
opens one, with an optional `name` and `background:true`; `rename` a working
copy's Project (`name`, and `workspaceId`, defaulting to the bound copy) so
`list` tells copies apart; `copy` a selection or whole Cell into
an explicit live target and offset. Copy follows the same atomic, undoable GUI
planner including dependencies. `new` and `rename` answer with the
`workspaceId` they acted on. Live tab contents include unsaved work; the
existing Cloud list/inspect/import actions read saved versions.

To work on another open Project without selecting its tab, call `project_cells`
with `action:"bind-workspace",workspaceId` from `list` or `open`. The binding
belongs to this MCP client and applies to Circuit, Project, File and Simulation
requests. Pass `workspaceId:null` to return to the human's active tab. A closed
target fails with `WORKSPACE_NOT_FOUND`; list and bind another copy rather than
silently redirecting an edit. `workspace.activate` remains an explicit request
to show a Project in the editor.

Use `gallery_circuits` to traverse the complete public Gallery. `list` is
cursor-paged; continue with `nextCursor` until it is `null`. `read` returns one
entry's complete canonical Project Code and, by default, its generated SPICE
netlist. `read-many` accepts up to 12 listed IDs and reads them concurrently;
continue any returned `remainingEntryIds` when the response-size guard stops a
batch early. Select Spectre explicitly or pass `netlistFormat:null` when only
the Project Code is needed. `read` with `render:"svg"` or `"png"` also returns
the top Cell's figure as an image, drawn by the same exporter as `export_file`.
`open` opens an entry as a new working copy in one call (`background:true`
leaves the human's tab selected) and returns its `workspaceId`; no local file
is involved. Reading copies nothing into the active Project.

Use `project_code` to read or replace the complete open Project. A replacement
is parsed and committed through the same revision-guarded, undoable Project
Code path as the Editor panel, so adding, updating or removing Cells and
objects has one source of truth. Use `netlist_code` to read generated SPICE or
Spectre and to replace the text-editable device names, model targets and
parameter values. Pass `documentId` to scope a read or replacement to a Cell;
the read response keeps the requested export in `netlist` and also reports each
Cell independently in `cells`, so an unrelated Cell cannot hide an available
netlist. `rootDocumentId` remains accepted for compatibility. Topology, ports
and connectivity remain Project Code or structured-edit operations; the Netlist
tool does not maintain a second netlist-import interpretation of the circuit.

Colors use existing `set_instance_style_override`, `set_route_style_override`,
`set_presentation_style` and annotation `textColor` edits. Full inspection
returns these fields, `signalFlowParameters`, Cell interfaces, and external
Model definitions. Netlist parameter values are strings, for example `"1u"`.

`annotate` and `edit-text` accept plain text or canonical RichText.
New notes share GUI Text defaults. Plain-string editing preserves existing spans;
explicit RichText replaces formatting. Structural formulas require RichText.
For bound Cell Pin and Value labels, `edit-text` changes the look only and
requires the same displayed characters; a same-text string is a no-op. A Value look follows later parameter
changes; the electrical parameter remains authoritative.

`connect`/`disconnect` pin targets accept an Instance Reference string or
`instance:{kind:"instance",id:"…"}`; use the latter for imported formal Cell Pins.
`place-component` may omit a device's Reference: the editor takes the next free
one, as a GUI insert does (R1, X1), and a block that emits nothing gets none;
read the name from the receipt's created objects or Snapshot. Omit it for
`ground` and `vdd-port`. For `port` and `port-filled`, `reference` supplies the new
Cell terminal's name, with passive direction by default. Without `parameters`
or `control` the editor fills the netlist as the GUI does, with catalog defaults
and the Process's model.
A formula block (catalog `formula: true`: integrator, unit delay, discrete-time
integrator, transconductance) takes `signalFlow:{formula?, coefficient?,
bodyWidth?, bodyHeight?}` on `place-component`, and `set-signal-flow` changes
them later (`null` clears one; a new formula drops the old formula's look, as
the Properties formula does). These are drawing text, never netlist parameters:
`set-property` on a part without netlist parameters names `set-signal-flow`.
`set-display-alias {instanceId, text}` draws a part's name label as other text
while its Reference (or Pin name) stays in the netlist, as the Properties
display alias does: an op-amp stays `X1` and shows `A1`; `text:null` shows its
own name again. It survives Project Code and Copy as the label's text. A
rejected Reference prefix names the alias that would draw it.
For a symmetric layout, `mirrorOf:{instance, x}` (or `y`) places the mirror
image of a placed part about that vertical (horizontal) line: origin reflected,
mirror toggled, rotation kept, so the drawing reflects exactly; an axis whose
image is off the grid is refused. `move` by `pinAnchor` names the nearest
reachable landing when a pin cannot land where asked, and `place-existing`
with a `pinAnchor` needs no `placement`. `mirror` with `axis` reflects a part
in place as the selection `transform` does (`y` flips it left-right, `x`
top-bottom); `set-orientation` sets an absolute rotation and mirror.
Several `place-cell` actions share one call and one Undo, named in turn. Placement creates its
owned Port, Net and bound terminal-name display atomically; use the returned
Instance ID for subsequent wiring. To place an imported Instance, use `place-existing` with
`instanceId` and `placement` (or `move` from the tray); default labels use the GUI planner.
`place-component` batches use the browser's native display factory: references
and displayable values are object-attached, and power markers own electrical
power claims. Use `set-instance-display` with `instanceIds`, `showReference`
and/or `showValue` to change visibility without creating duplicate annotations.
For transformer (`xfmr`) parameters use `showParameters:{k:true,lp:true,ls:false}`;
for T-Coil use `k`, `l1`, `l2`, `cb`. Keys are lowercase, omitted keys stay
unchanged, and unsupported keys for any selected device reject the whole action.
Set the electrical parameter values before showing them. Hide/show reuses the
same attached labels and preserves their authored placement and style.
`showValue` controls only aggregate Value, never these named parameter labels.
The `binding.parameter` field is supported by Snapshot reads and advanced
annotation edits, including hidden labels.
Do not substitute free drafting text for these projections. `add-label` attaches
new labels to their Net's routed geometry when available.
`add-label` and Net Label `edit-text` author the electrical name claim and bound
text together. Deleting the label removes its owned claim, not the physical wires.

`connection_status` probes the current session; closing a panel is not a disconnect.

Every result that reached the relay carries `timing`: the whole call, and for
each request its round trip, the relay's forward to the editor (`relayMs`), the
editor's own work (`editorMs`) and its tab's visibility; a one-shot CLI process
adds `startupMs`, its time before the first request, which a busy machine
stretches. An editor tab in the background, or a forward over 5 s, adds
`timing.warning` `EDITOR_BACKGROUND` with the fix, and the Agent panel says
requests waited in the background. `connection_status` lists this process's
last requests the same way, and `inspect {target:{kind:"activity"}}` returns
the session's last 32 requests from any process, as the relay recorded them.
`analog-canvas-mcp --http batch` runs one call per JSON line
(`{"tool": "...", "args": {...}}`), each as it arrives, on one session (one
connector resume, one Snapshot cache), and answers each with one line.
HTTP 429 retries are bounded and honor `Retry-After` using the identical request
body and IDs. A longer server wait is returned to the caller instead of retried early.

For example, a formula annotation:

```json
{
  "kind": "annotate",
  "position": { "x": 200, "y": 100 },
  "text": {
    "runs": [{ "kind": "math", "latex": "\\frac{g_m}{C}", "display": "inline" }]
  }
}
```

### How each focused action is planned

No verb is implemented twice: each action becomes exactly one transaction form,
planned once.

| Tool                 | Action                                       | Sent as                                   | Planned by                                                            |
| -------------------- | -------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `circuit_place`      | `place-component`                            | `place-components` command                | GUI insertion: catalog defaults, Process model, naming, default labels |
|                      | `place-cell`, `place-existing`               | command (several `place-cell` batch)      | GUI Cell and tray placement                                            |
|                      | `add-power-rail`                             | command                                   | GUI power rail planner                                                 |
| `circuit_wire`       | `connect`                                    | wire intent                               | GUI routing planner                                                    |
|                      | `disconnect`                                 | typed edits                               | Edit Engine                                                            |
| `circuit_transform`  | `move`                                       | `move_instance`, or a move command        | Edit Engine; GUI tray, annotation and Junction planners                |
|                      | `rotate`, `mirror`, `set-orientation`        | `rotate_instance` / `mirror_instance`     | Edit Engine (labels follow as in the GUI)                              |
|                      | `arrange`                                    | typed edits                               | Edit Engine                                                            |
|                      | `detach-move`, `extend-power-rail`           | command                                   | GUI move and rail planners                                             |
| `circuit_selection`  | `transform`, `copy`, `align`                 | command                                   | GUI selection transform, copy and alignment                            |
| `circuit_text`       | `add-label`, Net Label `edit-text`, `set-net-label` | `set-net-label` command            | GUI Net Label planner                                                  |
|                      | `edit-text`, `annotate`                      | typed annotation edits                    | Edit Engine                                                            |
|                      | `move-annotation`, `arrange-labels`          | command                                   | GUI annotation and label planners                                      |
| `circuit_properties` | `set-reference`, `set-property`, `set-signal-flow`, `set-block-supply`, `set-source-control` | typed edits | Edit Engine, checked against the device contract |
|                      | `set-model`                                  | command                                   | GUI Process-aware model planner                                        |
|                      | `set-instance-display`, `set-display-alias`  | command                                   | GUI display and display-alias planners                                 |

## Verify and recover

Mutation receipts already include authoritative changed-object IDs, edit kinds,
diagnostics and diagnostic deltas. Do not reconstruct the change from a partial
Snapshot or count the same diagnostics twice. Use `verify` for a fresh check
when needed and `render` when visual review matters. On `STATE_CHANGED`,
refresh and re-plan; never blindly replay a changed payload.

`inspect` with `target:{kind:"document"},detail:"full"` returns complete
Document facts.
`inspect` with `target:{kind:"geometry",objectIds:["…"]}` reads up to 64
specific authored objects (placement, routes, junctions, annotation anchors,
drafting and no-connect objects). It returns current revision and missing IDs
without resolving the full circuit. Use it after local movement; use the full
inspection for pins, Nets and connectivity. `get_context` and
`target:{kind:"diagnostics"}` use lightweight server reads for revision/counts
and diagnostic items. `simulation_folder` list reads folder metadata without
source bodies; get/edit still load the required Project. An older Editor may
fall back to the full read while the deployment rolls out.
`target:{kind:"activity"}` returns recent successful receipts in the current
MCP process, not persistent history or other people's edits.
`search` with `scope:"project"` searches currently authorized Cells.
`inspect` with `target:{kind:"trace",netId:"…"}` returns the GUI's canonical
cross-Cell/global-Net trace. Supply `hierarchyPath` for a particular reused
Cell occurrence; do not infer cross-Cell connectivity from names yourself.

`disconnect` revokes the workspace session. Project/Cell switching and Gallery
navigation do not. `PROJECT_CONTEXT_STALE` requires refreshed context and a new
plan, not another Claim; `NO_ACTIVE_PROJECT` means the browser is in Gallery.
The client carries context stamps automatically and never redirects old writes.

## Files and boundaries

For a read-only milestone, `verify` optionally accepts
`expectedNetlist:{text:"<structural SPICE>",cell:"<reference root>"}` and
`details:true`. Omit it to retain the ordinary Snapshot-only check. Comparison
reads the existing structural netlist, pairs unique device References and pin
positions, and compares formal ports, targets, literal parameters, scope and
endpoint membership; internal auto Net names do not matter. It recursively
checks matched child definitions, and reaches a child Cell with the same port
names on both sides by name, so a reordered Cell does not rewire its callers.
It never flattens or guesses renamed devices.

Devices pair by card name first, then by Instance reference: an export writes a
Reference bound to a subcircuit as a call, so `XM1` pairs with `M1`. When both
bind the same model or subcircuit name, one as a card and one as a call, that
is a `binding` difference, not a missing and an extra device.

The result starts with a one-line `summary`, such as
`topology equal; 1 port-order, 8 binding-style differences`, then `status`
and `topology`. `topology` covers devices, targets, port sets, scopes and
connections alone; `port-order`, `binding` and `parameter` differences leave it
`equal`. `expectedNetlist.compare` skips checks besides topology:
`{portOrder:false}` compares the port set only, `{bindings:false}` accepts
either binding style, `{parameters:false}` skips values, and
`{declarations:false}` ignores `.model` bodies, `.param` and preserved
statements instead of reporting `inconclusive`.

Literal parameters compare exact decimal values after SPICE unit scaling, not
floating-point approximations or a tolerance. A reviewed SKY130 subcircuit call
takes W and L as plain micrometres (`l=0.15` is `150n`); a model card takes
metres. An absent `m` is 1, and an absent reviewed count such as `nf` is its
default. Parameter differences preserve the original literal strings (or null
for an absent value). A literal exceeding 4096 characters is uncheckable and
yields `inconclusive`, not guessed equality. Counts are default; details
includes at most 200 differences with an explicit truncation flag. A difference
may affect several endpoint memberships. Parameterized hierarchy, expressions,
model bodies, unresolved or preserved statements yield `inconclusive`, possibly
alongside known differences; a `.model` card that only declares its type, such
as `.model nch nmos`, is compared, not uncheckable.
SPICE has no Port direction metadata: this comparison does not test directions,
library model internals or simulated performance. Snapshot diagnostics and the
subsequent structural export are separate reads, not an atomic revision snapshot.
No import reference is rewritten and no verification call is required before edits.

`export_file` writes Project/SVG/PNG/PDF to an explicit local path.
`import_file` stages a Project or structural SPICE bundle. Inspect the candidate,
then use `action:"open"` to open it in a new Project tab without replacing the
current work. Staging alone is not a completed import. Use
`action:"inspect",candidateId,documentId` to read one staged Cell as
`documentCode`; stage summaries list Cell IDs. `action:"import-cell"` with
`sourceDocumentId,targetDocumentId,mode:"replace-body"|"append"` commits into
an existing Cell, including its dependency closure, in one undoable Project
edit. The shared client supplies missing `expectedRevision` and
`expectedStructureRevision`; explicit stale values reject. The candidate is
consumed only on success. This operation requires `project.import` and the
existing geometry/connectivity/presentation edit scopes, not a GUI approval.
It preserves the target Cell ID, formal terminal IDs/order, symbol pin layout
and parent callers. An uncalled Cell with no terminals can adopt the imported
interface. Otherwise named terminals must match (append may use a subset), and
parameters must already be compatible. Append retains existing interface
owners, joins only declared matching terminals or compatible global Nets,
and rejects local-name/Reference conflicts rather than guessing a rename.
Resolve missing MOS bulk first; append does not retarget existing bulk.
Append retains the destination's frozen import-reference baseline and source
status becomes modified; it does not silently redefine a verification target.
Geometry is not auto-arranged. Use whole-Project
`action:"request-approval"` only when the human wants to replace the current
Project in the browser. After either Project switch, refresh connection status
and read the new Document context; the existing pairing remains valid.
For Cadence globals, use `action:"stage-spice", namingProfile:"cadence-bang"`.

Exporting a Project file is not Cloud Save or Gallery publication. Account
operations remain separate work. Simulation sweeps use the Simulation resource.
