# Analog Canvas MCP quickstart

## Connect and inspect

Call `connect` with the browser Claim Code once; omit it to resume the saved
connector. The Helper owns HTTP endpoints, tokens, request IDs and revisions.
Closing the browser details panel does not revoke the connection.
Call `get_context` and read the built-in catalog before placing devices.
Use `inspect` and `search` for IDs and pins, not screenshot coordinates.

Production hides the Agent UI intentionally. Development/staging enables it
with `VITE_ICM_AGENT_UI=enabled`.

MCP 0.3.1 is a development release for the matching API 2.0 branch. Releasing
the adapter does not deploy editor/API fixes or enable the production Agent UI.
Set `ANALOG_CANVAS_API_URL` to your development endpoint before starting it.

## Create and edit (MCP 0.3 / Kit 4)

Use `apply_actions` for one atomic edit batch, wire, planned command or focus
operation per call. Split create and wire phases so new pin geometry comes
from Snapshot. The browser plans commands with the same planners as the GUI;
all resulting edits use the existing controller, revision and permission checks.

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
Drafting quarter-turns match the GUI's in-place rotation; other drafting
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

Colors use existing `set_instance_style_override`, `set_route_style_override`,
`set_presentation_style` and annotation `textColor` edits. Full inspection
returns these fields, `signalFlowParameters`, Cell interfaces, and external
Model definitions. Netlist parameter values are strings, for example `"1u"`.

`annotate` and `edit-text` accept plain text or canonical RichText:

`connect`/`disconnect` pin targets accept an Instance Reference string or
`instance:{kind:"instance",id:"…"}`; use the latter for imported formal Cell Pins.
`place-component` requires a Reference for devices, but omit it for `ground`
and `vdd-port`. To place an imported Instance, use `place-existing` with
`instanceId` and `placement` (or `move` from the tray); default labels use the GUI planner.
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
operations, simulation, waveforms, PVT and netlist export are outside this
Agent feature increment.
