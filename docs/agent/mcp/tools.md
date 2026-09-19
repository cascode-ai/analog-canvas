# MCP editing and recovery tools

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

| Action                                        | Key arguments                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `set-model`                                   | `instanceId`, `model` (empty clears it)                                       |
| `copy`                                        | `selection`, `offset:{x,y}`; internal wires and references follow GUI copy    |
| `transform`                                   | `selection`, `transform:{kind:"rotate",degrees:90}`, mirror or translate      |
| `align`                                       | `selection`, `mode:left/right/top/bottom/center-x/center-y`                   |
| `detach-move`                                 | `instanceIds`, `delta`; wires stay behind                                     |
| `unplace`                                     | `instanceIds`; retain electrical facts in Placement Tray                      |
| `reset-cell`                                  | `mode:clear-drawing/reset-placement/reset-body`                               |
| `create-cell` / `rename-cell` / `delete-cell` | Cell `id`, plus `name` for create/rename                                      |
| `undo` / `redo`                               | Shared editor history, not a private Agent stack                              |
| `focus`                                       | `intent`: select, highlight-net, activate-document, fit-document, clear-focus |

`selection` accepts `instanceIds`, `routeIds`, `junctionIds`,
`annotationIds` and `draftingIds`; omitted lists are empty.
Drafting rotations in 45-degree steps match the GUI's in-place rotation; other drafting
transforms use canonical `upsert_drafting_object` geometry rather than silently
partially transforming a mixed selection.

`connect` supports `via`, `routingMode:orthogonal/octilinear/free` and
`cornerOrder`. A `route-segment` target uses the Route's stable `legId`
and a `point`; the server owns splitting and Junction creation.
Name Nets through labels/markers, never raw Base-Net fields.

`advanced_transact` accepts exactly one of `edits`, `structureEdits`,
`wireIntent`, `semanticIntent`, or `command`. The Helper supplies IDs and
Document/Project revisions. Read `analog-canvas://contract/edits/{kind}`
for one edit schema (for example `set_instance_style_override`), avoiding the
large `analog-canvas://contract/advanced-edits` resource meant for offline tooling.
Reading is advisory, not a permission gate.
Nested `transact_document` entries use their target Document revisions.

Use `project_cells` to list the signed-in user's Cloud Projects, inspect their
Cell interfaces, and import one Cell into the open Project. Import copies the
complete local dependency closure through the same atomic planner as the GUI;
it does not create a live cross-Project link. The helper refreshes the Project
structure revision when the caller omits it. Sign-in, stale-revision, and
library-compatibility failures are recoverable and do not revoke the session.

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

`disconnect` revokes the session. A Project replacement invalidates the old
binding. Newly created/deleted Cells are synchronized by the trusted browser,
without requiring another claim exchange.

## Files and boundaries

`export_file` writes Project/SVG/PNG/PDF to an explicit local path.
`import_file` stages a Project or structural SPICE bundle; inspect it and
request browser approval. Staging is not a completed import.
For Cadence globals, use `action:"stage-spice", namingProfile:"cadence-bang"`.

Exporting a Project file is not Cloud Save or Gallery publication. Account
operations remain separate work. Simulation sweeps use the Simulation resource.
