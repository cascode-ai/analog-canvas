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

Arguments that fail validation return `INVALID_TOOL_INPUT` with
`recovery:"fix-input"`. Each issue gives its `path` and `code` and says what
would pass: unknown `keys` beside the `allowed` keys of the branch its
`kind`/`action`/`operation` selects, the accepted `values`, a `minimum` or
`maximum` with `inclusive`, or the `expected` type. A missing or unknown
`kind`/`action`/`operation` lists the `values` this tool takes at that path.
Submitted values are never echoed back.

Focused circuit tools retain the `{documentId?, actions:[...]}` call envelope:

| Tool                 | Scope                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `circuit_place`      | Built-in symbol, Cell and existing-instance placement; power rail; the Cell's MOS body default              |
| `circuit_wire`       | Connect, disconnect, and mark unused pins No Connect                                                        |
| `circuit_transform`  | Individual move/rotate/mirror/set-orientation, arrange, detach-move and rail span; a Cell block's Pin sides |
| `circuit_selection`  | Selection transform, copy and align                                                                         |
| `circuit_view`       | What a person watching sees: `focus` fits the view (fit-document), selects or highlights; never edits       |
| `circuit_text`       | Labels, annotations, text changes and annotation movement                                                   |
| `circuit_properties` | References, parameters, formulas, model selection, display flags and aliases, block supplies                |

Each is a projection and forwarding entry, not a separate edit engine. Existing
transaction boundaries still apply: actions of one focused tool that cannot
share one transaction (an edit batch beside a command) are sent as consecutive
calls in the order the compiler names, and the result says so under `split`
(each call's actions, outcome and revision). Each call is atomic; the first
that fails stops the rest, and the calls before it stay applied. `apply_actions`
refuses such a mix instead (`ACTION_BATCH_NOT_ATOMIC`, naming the calls) and
retains all actions, including mixed families, Cell structure, reset and history.
A refusal names the action it refused: `actions[i] (kind): …`, with
`actionIndex` and `actionKind`. The editor plans every list; an editor page
loaded before it could answers `EDITOR_OUTDATED`: reload the page and retry.

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
operation per call. A `focus` may also end any list: it changes only the view,
once the list commits, and never needs a call of its own. Split create and
wire phases so new pin geometry comes from Snapshot. The browser plans each
call's actions, and commands with the same planners as the GUI; all resulting
edits use the existing controller, revision and permission checks.

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
draft, nearest the via point beside it when `via` is given, else nearest the
other end. Ordinary `point` remains a free endpoint. A tap at a different-Net
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
`cornerOrder`. Without `routingMode`, a 45° step between `via` points, or from
an end to the first or last, is refused: name `octilinear` for the diagonal or
`orthogonal` for a corner. The wire passes through every `via` point: points listed
from `to` back to `from` are followed in that reverse order, and points no
order can follow without doubling back are refused with a reason rather than
committed as another path. A wire from a pin or Junction, whether to another,
to a `net`, to a tap on a wire or to an open `point`, also keeps clear of other
Nets' pins and wires and of parts' bodies: without `via` it detours, with
`via` that would meet one it is refused, naming the obstacle and the two
points of the path between which it meets it, then the clear path the editor
finds as `via` points to send next (or to leave `via` out), or why leaving the
route to the editor fails too. With no clear path at all it is refused like
`route-net`. A wire drawn between points alone is drawn as asked, and may end
on another wire to join it. A transaction that would put a Junction on another
Net's wire is refused too.
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
cursor-paged; continue with `nextCursor` until it is `null`. Each listed or read
entry states its saved AI mark as `aiGenerated`. `read` returns one
entry's complete canonical Project Code and, by default, its generated SPICE
netlist. Its simulation folders (the testbench) come only with the signed-in
account's own circuits, with any AI account's when signed in as one, and with
every circuit for the Owner's own accounts; reads, opens and inserts of
anyone else's carry none. `read-many` accepts up to 12 listed IDs and reads
them concurrently; continue any returned `remainingEntryIds` when the
response-size guard stops a batch early. Select Spectre explicitly or pass `netlistFormat:null` when only
the Project Code is needed. `read` with `render:"svg"` or `"png"` also returns
the top Cell's figure as an image, drawn by the same exporter as `export_file`.
`open` opens an entry as a new working copy in one call (`background:true`
leaves the human's tab selected) and returns its `workspaceId`; no local file
is involved. Reading copies nothing into the active Project.

`insert` copies the top Cell's drawing, or `sourceDocumentId`, into
`targetDocumentId` at `position:{x,y}`. Position is the GUI's grab point (the
first placed Instance, or the existing clipboard anchor for drawing-only Cells),
not an offset from the source coordinates. It imports required child Cells and
source/model files through the same copy planner and commits one undoable edit.
It does not open a tab, activate a workspace, replace the target or edit the
Gallery publication. Use the existing `project_cells` workspace binding to
select another target Project. This is drawing insertion, not placement of a
single hierarchy Instance; Cloud `import-cell` remains a separate operation.
Supply `expectedRevision` and `expectedStructureRevision` from inspected state,
or omit them for the MCP client's fresh target read. The Editor rechecks both
and the bound Project after download. The receipt contains source/target Cell
IDs, target revisions, copied object mapping and imported Cell/file IDs.
An empty source rejects with `COPY_EMPTY`, never opens it instead.

`publish` publishes the working copy its tab shows as a new entry, and
`update` replaces an entry with it, as the Editor's Publish to Gallery does:
under the signed-in Editor account, the whole Project, with the dialog's
fields `name` (default: the Project's name), `description` and `tags`. What an
Agent publishes or updates carries the AI mark; only its author changes that,
in the Editor, and an AI account's entries always keep it. `update` defaults
to the entry the working copy was published as or opened from in the Editor,
and keeps every field it does not name; a
copy `open` made carries no such link, so pass its `galleryEntryId`. Both
return `galleryEntryId`,
`url` (`/g/<id>`) and `previewRevision`, and leave the working copy bound to
the entry, with the Editor's published notice. A working copy in a background
tab is refused with `WORKSPACE_NOT_SHOWN`: activate it first. Publishing needs
the session scope `gallery.publish`; a session paired before it existed needs
a new connection.

Signed in as an AI account, `list` with `scope:"ai-seats"` lists every AI
account's circuits, newest first, rejected and withdrawn ones included, each
with its `status` and the Owner's `rejectReason`; `status:"rejected"` keeps
only the rejected ones. `read` and `open` work on them as on public ones. To
fix one: `open` it, edit it, then `update` with its `galleryEntryId` and
`takeOver:true` (none for your own). It becomes yours and keeps its status, so
a rejected circuit stays off the wall until the Owner restores it. A person's
circuit is never listed there or taken over; a person's session gets
`AI_ACCOUNT_REQUIRED`.
Gallery login is the Editor's login: `SIGN_IN_REQUIRED` asks to sign in;
`SESSION_NOT_FOUND` asks to pair again. A stale target needs new context and a
new plan, not a new Claim. Existing `project.import` and geometry/connectivity/
presentation edit scopes apply; there is no extra Gallery privilege.

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
one, as a GUI insert does (R1, X1), and a block that emits nothing gets none.
The receipt's `placed` lists each part the list's `place-component` actions
placed, in order: `{id, reference, symbol}`, the editor's name included, so
wiring needs no read to learn IDs (a ground has no name). Omit it for
`ground` and `vdd-port`. For `port` and `port-filled`, `reference` supplies the new
Cell terminal's name, with passive direction by default. Without `parameters`
or `control` the editor fills the netlist as the GUI does, with catalog defaults
and the Process's model.
A formula block (catalog `formula: true`: integrator, unit delay, discrete-time
integrator, transconductance) takes `signalFlow:{formula?, coefficient?,
bodyWidth?, bodyHeight?}` on `place-component`, and `set-signal-flow` changes
them later (`null` clears one; a new formula drops the old formula's look, as
the Properties formula does). A formula is compact text, not TeX: `^` raises
and a single `_` lowers the next term, a longer script groups in parentheses
or braces (`g_m`, `g_(m1)`, `g_{m1}`, `z^-1`), and one top-level `/` makes a
fraction (`1/s`). These are drawing text, never netlist parameters:
`set-property` on a part without netlist parameters names `set-signal-flow`.
The adder's inputs add by default. To subtract one, as a residue
V_hold − V_DAC, a ΣΔ loop error or a phase detector does, set its sign with
`parameters:{signB:"-"}` on `place-component` or `set-property {target,
set:{signB:"-"}}` (`signA` for input A; `+` or `-`, and a Unicode minus `−`
is stored as `-`). The drawing then marks each input + or −, and the netlist
calls `adder_minus_b` (or `adder_minus_a`, `adder_minus_ab`), whose source for
B has gain −1. Do not add a −1 gain block for a subtraction the figure does
not draw. A logic gate's input count is likewise a Properties choice, not a
netlist parameter: `set-property {target, set:{inputs:"3"}}` switches an AND,
NAND, OR, NOR, XOR or XNOR gate between 2, 3 and 4 inputs, and
`place-component` places `nor-gate-3`, `xor-gate-4` and the like directly.
`set-display-alias {target, text}` draws a part's name label as other text
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
Several `place-cell` actions share one call and one Undo, named in turn. A
`place-cell` may leave out `instanceId` and the placement's `rotation` and
`mirror`, as `place-component` does: the Helper makes the ID and turns the
Cell upright. `set-model` and `set-display-alias` take a `target`
(`{kind:"instance", reference}` or `id`), as `set-property` does; their native
`instanceId` is still accepted. Placement creates its
owned Port, Net and bound terminal-name display atomically; use the returned
Instance ID for subsequent wiring. To place an imported Instance, use `place-existing` with
`instanceId` and `placement` (or `move` from the tray); default labels use the GUI planner.
A placed Cell shows its Cell name; its instance name (`X1`) is hidden, as
in the GUI. `set-instance-display` with `showReference:true` shows it above
the Cell name, as the Properties Visual annotation switch does, for instance
to tell which block is `x1` when probing `v(xdut.x1.net0)`.

`set-cell-symbol-pins` (in `circuit_transform`) arranges the Pins on the block
of the call's Cell, its `documentId`, by name:
`{kind:"set-cell-symbol-pins",pins:[{name:"bl",side:"east"},{name:"blb",side:"west",offset:0}]}`.
Sides are `north`, `east`, `south` and `west`; `offset` runs along the side
from its middle in multiples of 10. A Pin not named stays where its callers
were drawn with it (for a Cell no parent has placed yet, where its first
placement would put it). A named Pin without `offset` stays put if its side
does not change, and otherwise takes the first free slot on its new side (0,
-20, 20, …, a full row from the Pins there). An unknown name is refused with
the Cell's Pin names, two Pins on one slot with that side's free slots.
Callers keep their Nets and the wiring the change stretches is redrawn clear;
the receipt's `projectStructure.changedDocumentIds` names the Cell and each
Cell whose callers were redrawn, and `changedObjectIds` those callers (a
caller with a wire on a Pin that moved) and their wires.
No terminal IDs or whole `pinPlacements` list are needed, as the low-level
`set_cell_symbol_presentation` edit takes them.

`place-component` batches use the browser's native display factory: references,
and values placed with `showValue:true`, are object-attached; power markers own electrical
power claims. Use `set-instance-display` with `instanceIds`, `showReference`
and/or `showValue` to change visibility without creating duplicate annotations.
For transformer (`xfmr`) parameters use `showParameters:{k:true,lp:true,ls:false}`;
for T-Coil use `k`, `l1`, `l2`, `cb`; for Center-Tap Inductor `k`, `l1`, `l2`.
Keys are lowercase, omitted keys stay
unchanged, and unsupported keys for any selected device reject the whole action.
Set the electrical parameter values before showing them. Hide/show reuses the
same attached labels and preserves their authored placement and style.
`showValue` controls only aggregate Value, never these named parameter labels.
The `binding.parameter` field is supported by Snapshot reads and advanced
annotation edits, including hidden labels.
Do not substitute free drafting text for these projections. `add-label` attaches
new labels to their Net's routed geometry when available. Its target is a Net,
or a pin: the label then names that pin's Net on the wire leaving the pin.
`add-label` and Net Label `edit-text` author the electrical name claim and bound
text together. Deleting the label removes its owned claim, not the physical wires.

`connection_status` probes the current session; closing a panel is not a disconnect.

Results with HTTP activity carry `timing`: tool/call duration and up to eight
recent request attempts, correlated by requestId/resource/operation. Header wait
and consumed JSON/validation are measured separately; the request total includes
both. Retry delays are separate. Relay phases cover restoration (within pre-forward),
pre-forward, forwarding and completion; legacy `relayMs` includes forwarding and
completion, not pure socket time. Byte streams stop this timing at headers.
Editor work and visibility are observations; hidden is not a latency diagnosis.
`SLOW_RELAY` asks to inspect phases, not to refresh blindly. A one-shot CLI adds
`startupMs`. `connection_status` lists recent local attempts; activity inspection
adds up to 32 records from the current live relay instance, not persistent audit
history. No payloads or credentials are logged.
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

No verb is implemented twice. The client sends each call's actions as they
are; the editor resolves their names, turns each into exactly one
transaction form and plans it with the code the GUI runs.

| Tool                 | Action                                                                                       | Becomes                                                  | Planned by                                                                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `circuit_place`      | `place-component`                                                                            | `place-components` command                               | GUI insertion: catalog defaults, Process model, naming, default labels                                                                                                                                                                                           |
|                      | `place-cell`, `place-existing`                                                               | command (several `place-cell` batch)                     | GUI Cell and tray placement                                                                                                                                                                                                                                      |
|                      | `add-power-rail`                                                                             | command (several rails batch)                            | GUI power rail planner                                                                                                                                                                                                                                           |
|                      | `set-mos-bulk-default`                                                                       | command                                                  | Cell settings in Properties: bodies on the old default move to the Net, wired bodies stay                                                                                                                                                                        |
| `circuit_wire`       | `connect`                                                                                    | wire intent                                              | GUI routing planner                                                                                                                                                                                                                                              |
|                      | `disconnect`                                                                                 | `disconnect-pin` command; a wire's is `delete-selection` | GUI pin menu: Delete connection where wires end on the pin, Disconnect endpoint where none does; GUI deletion                                                                                                                                                    |
|                      | `disconnect` with `noConnect`, a No Connect mark                                             | typed edits                                              | Edit Engine, as the GUI's No Connect toggle                                                                                                                                                                                                                      |
| `circuit_transform`  | `move`                                                                                       | `set-properties` command, or a move command              | Properties position field: a moved part joins a pin it lands on, as a drag does, a wire it stretches across a part or another Net's pin is drawn clear as `connect` draws it, and labels newly drawn over move clear; GUI tray, annotation and Junction planners |
|                      | `rotate`, `mirror`, `set-orientation`                                                        | `set-properties` command                                 | Properties rotation and mirror fields; labels newly drawn over move clear                                                                                                                                                                                        |
|                      | `arrange`                                                                                    | `arrange-instances` command                              | Origins on one coordinate, stretched wires drawn clear and labels newly drawn over moved clear; the GUI's own Align is `circuit_selection` `align`                                                                                                               |
|                      | `detach-move`, `extend-power-rail`                                                           | command (`extend-power-rail` batches)                    | GUI move and rail planners                                                                                                                                                                                                                                       |
|                      | `set-cell-symbol-pins`                                                                       | command                                                  | Cell symbol presentation planner: every Pin's current place kept, the named ones moved; callers keep their Nets, their stretched wiring is redrawn clear, and labels it newly runs through move clear                                                            |
| `circuit_selection`  | `transform`, `copy`, `align`                                                                 | command                                                  | GUI selection transform, copy and alignment                                                                                                                                                                                                                      |
| `circuit_view`       | `focus`                                                                                      | semantic intent, after the rest of the list commits      | `fit-document` fits the view like the F key (the Cell on show keeps its selection); also `activate-document`, `select`, `highlight-net`, `clear-focus`. No revision; scope `editor.semantic-control`                                                          |
| `circuit_text`       | `add-label`, Net Label `edit-text`, `set-net-label`                                          | `set-net-label` command                                  | GUI Net Label planner                                                                                                                                                                                                                                            |
|                      | `edit-text`                                                                                  | `set-text` command                                       | GUI text commit: a name label renames its part, a value label sets its value; the same characters in a new look only restyle                                                                                                                                     |
|                      | `annotate`                                                                                   | `add-text` command                                       | GUI Text tool                                                                                                                                                                                                                                                    |
|                      | `move-annotation`, `arrange-labels`                                                          | command                                                  | GUI annotation and label planners                                                                                                                                                                                                                                |
|                      | `apply-label-preset`                                                                         | command                                                  | GUI display planner hides each MOS W/L, then the label planner arranges the parts' labels in their role look, on a private copy: one undo                                                                                                                        |
| `circuit_properties` | `set-reference`, `set-property`, `set-signal-flow`, `set-block-supply`, `set-source-control` | `set-properties` command                                 | Apply in Properties, after an Agent-only check of parameter names against the model                                                                                                                                                                              |
|                      | `set-model`                                                                                  | command                                                  | GUI Process-aware model planner                                                                                                                                                                                                                                  |
|                      | `set-instance-display`, `set-display-alias`                                                  | command                                                  | GUI display and display-alias planners                                                                                                                                                                                                                           |

Commands in one call that can share a transaction go as one batch, planned in
order on a private copy, so a later action sees the earlier ones. An
`undo` or `redo` goes alone.

## Verify and recover

Mutation receipts already include authoritative changed-object IDs, edit kinds,
diagnostics and diagnostic deltas. Do not reconstruct the change from a partial
Snapshot or count the same diagnostics twice. Use `verify` for a fresh check
when needed and `render` when visual review matters. Beside its `errors`,
`warnings` and `total`, `verify` names in `information` the findings a count
would hide: a MOS body given a supply nobody wired, as a Cell Pin nobody drew
(`MOS_BODY_DEFAULT_SUPPLY`) or on another supply than its source
(`MOS_BODY_OTHER_SUPPLY`). Each has code, message and objectIds, and
`documentId` when it is another Cell's. It lists at most ten;
`informationOmitted` counts the rest. Generated Net names stay counted in
`total`; `inspect` of diagnostics lists everything. On `STATE_CHANGED`,
refresh and re-plan; never blindly replay a changed payload.

`inspect` with `target:{kind:"document"},detail:"full"` returns complete
Document facts; `detail:"parts"` lists only every part (`id`, `name`,
`symbol`, `position`, and `rotation`/`mirror` when set) and every Net (`id`,
`name`, `powerDomain` when a supply), a few KB where the full read is often
100 KB.
`inspect` with `target:{kind:"object"}` on a part also lists its name, value
and parameter labels as `annotations` (`id`, `kind`, `parameter`, `visible`,
`resolvedText` and `position`, the point `move-annotation` sets), read with
one targeted request, so a label is found and moved without a full Document
read. An Editor without the list answers `annotationsUnavailable` instead.
Names match exactly, as actions match them. A name nothing has is refused
as `OBJECT_NOT_FOUND`, one several parts share as `NAME_AMBIGUOUS`, both in
the `error:{code,message,recovery}` shape with the `candidates` (kind, id,
name) it could mean; a `net` target looks at Nets only. Ground is Net `0`
in the Snapshot; `GND`, `VSS`, `gnd` or `ground` find it too, marked
`matchedAs:"ground"`, unless a Net or part really has that name (a Port VSS,
say). A Cell's netlist names its ground pin VSS, or GND when VSS names
another Net.
`inspect` with `target:{kind:"pins",instanceIds:[…]}` also takes a part's
Reference, or a Cell Pin's name: `resolvedNames` maps each to its ID, and an
entry naming no single part stays in `missingInstanceIds` and is explained
in `unresolved` (reason and candidate IDs).
`inspect` with `target:{kind:"geometry",objectIds:["…"]}` reads up to 64
specific authored objects (placement, routes, junctions, annotation anchors,
drafting and no-connect objects). It returns current revision and missing IDs
without resolving the full circuit. With `textBounds:true` each drawn label
also carries `text`: `position`, where its alignment end stands (what
`move-annotation` sets), and `bounds`, the box its glyphs fill, so a label's
width is read rather than rendered. Use it after local movement; use the full
inspection for pins, Nets and connectivity. `get_context` and
`target:{kind:"diagnostics"}` use lightweight server reads for revision/counts
and diagnostic items. `simulation_folder` list reads folder metadata without
source bodies; get/edit still load the required Project. An older Editor may
fall back to the full read while the deployment rolls out.
`target:{kind:"activity"}` returns recent local receipts and relay records;
the relay list can include failures/cache hits and can disappear on instance
replacement. Neither list is durable history or other people's edits.
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
