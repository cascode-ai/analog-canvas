# MCP editing and recovery tools

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
| `circuit_transform`  | Individual move/rotate/mirror, arrange and detach-move            |
| `circuit_selection`  | Selection transform, copy and align                               |
| `circuit_text`       | Labels, annotations, text changes and annotation movement         |
| `circuit_properties` | References, parameters, model selection and display flags         |

Each is a projection and forwarding entry, not a separate edit engine. Existing
batch compatibility and transaction boundaries still apply; membership in one
tool does not make every combination atomic or supported. `apply_actions`
retains all actions, including mixed families, Cell structure, reset and history.
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

`copy` follows GUI copy for internal wires and references. `detach-move` leaves
wires behind; `unplace` retains electrical facts in the Placement Tray.
`undo`/`redo` share Editor history, not a private Agent stack. Routine layout
work should use move/transform/align rather than reset; choose a `reset-cell`
mode deliberately when discarding drawing state.

For reviewed targets, `set-model` uses the GUI's semantic planner and leaves
binding and invocation generation to the netlist generator; an empty model
target clears the binding. Use raw binding
edits only for custom or unreviewed definitions.

`selection` accepts `instanceIds`, `routeIds`, `junctionIds`,
`annotationIds` and `draftingIds`; omitted lists are empty.
Drafting rotations in 45-degree steps match the GUI's in-place rotation; other drafting
transforms use canonical `upsert_drafting_object` geometry rather than silently
partially transforming a mixed selection.

`connect` supports `via`, `routingMode:orthogonal/octilinear/free` and
`cornerOrder`. A `route-segment` target uses the Route's stable `legId`
and a `point`; the server owns splitting and Junction creation.
Name Nets through labels/markers, never raw Base-Net fields.

`advanced_transact` is the full transaction escape hatch for typed edits not
covered by common actions, not a separate permission tier. It uses the same
validation and revision guards. Its listed schema/help describes the exclusive
payload forms; the Helper supplies IDs and Document/Project revisions.
Nested `transact_document` entries use their target Document revisions.
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
Cloud Project; `save` (or `asNew:true`); `copy` a selection or whole Cell into
an explicit live target and offset. Copy follows the same atomic, undoable GUI
planner including dependencies. Live tab contents include unsaved work; the
existing Cloud list/inspect/import actions read saved versions.

Use `gallery_circuits` to traverse the complete public Gallery. `list` is
cursor-paged; continue with `nextCursor` until it is `null`. `read` returns one
entry's complete canonical Project Code and, by default, its generated SPICE
netlist. `read-many` accepts up to 12 listed IDs and reads them concurrently;
continue any returned `remainingEntryIds` when the response-size guard stops a
batch early. Select Spectre explicitly or pass `netlistFormat:null` when only
the Project Code is needed. This reads the same public Gallery records as the
UI; it does not copy them into the active Project.

Use `project_code` to read or replace the complete open Project. A replacement
is parsed and committed through the same revision-guarded, undoable Project
Code path as the Editor panel, so adding, updating or removing Cells and
objects has one source of truth. Use `netlist_code` to read generated SPICE or
Spectre and to replace the text-editable device names, model targets and
parameter values. Topology, ports and connectivity remain Project Code or
structured-edit operations; the Netlist tool does not maintain a second
netlist-import interpretation of the circuit.

Colors use existing `set_instance_style_override`, `set_route_style_override`,
`set_presentation_style` and annotation `textColor` edits. Full inspection
returns these fields, `signalFlowParameters`, Cell interfaces, and external
Model definitions. Netlist parameter values are strings, for example `"1u"`.

`annotate` and `edit-text` accept plain text or canonical RichText.

`connect`/`disconnect` pin targets accept an Instance Reference string or
`instance:{kind:"instance",id:"…"}`; use the latter for imported formal Cell Pins.
`place-component` requires a Reference for devices, but omit it for `ground`
and `vdd-port`. For `port` and `port-filled`, `reference` supplies the new
Cell terminal's name, with passive direction by default. Placement creates its
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

## Verify and recover

Mutation receipts already include authoritative changed objects, edit kinds,
diagnostics and diagnostic deltas. Do not reconstruct the change from a partial
Snapshot or count the same diagnostics twice. Use `verify` for a fresh check
when needed and `render` when visual review matters. On `STATE_CHANGED`,
refresh and re-plan; never blindly replay a changed payload.

`inspect` with `detail:"full"` returns complete Document facts.
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

`export_file` writes Project/SVG/PNG/PDF to an explicit local path.
`import_file` stages a Project or structural SPICE bundle; inspect it and
request browser approval. Staging is not a completed import.
For Cadence globals, use `action:"stage-spice", namingProfile:"cadence-bang"`.

Exporting a Project file is not Cloud Save or Gallery publication. Account
operations remain separate work. Simulation sweeps use the Simulation resource.
