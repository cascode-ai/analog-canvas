# Built-in authoring contract

## Authority split

- `razavi-authoring-catalog.json`: reviewed built-in Razavi asset IDs,
  canonical pin order, default variants, and the VDD authoring primitive.
- `snapshot`: every object that already exists in the browser Document,
  including real object IDs, page positions, current Net membership, locks,
  revision, and MOS bulk status.
- Selected transport's tool/resource schemas (MCP) or published OpenAPI
  (raw HTTP), plus `capabilities`: request shape, permitted edits, scopes and limits.

No dynamic catalog operation exists. A built-in absent from this catalog, a
custom/PDK asset, or a pin mapping not reported by Snapshot is a human-fact
boundary.

## Product primitives

- `vdd-rail` is a semantic authoring primitive. Submit the OpenAPI-defined
  `add_power_rail` edit with explicit `netName`, scope, and
  `powerDomain: "vdd"`; `vdd` is never
  a symbol ID.
- `ground`, `port`, and `port-filled` have catalog symbols and pins,
  but placing a formal Port also requires its owned Cell terminal and Net.
  Use the native placement command below, not a bare Port `add_instance`.
- A three-terminal MOS presentation hides only artwork. Its canonical `B`
  pin remains electrical. Supply defaults are explicit Snapshot/Edit-Engine
  facts, not an inference from MOS orientation or a visible rail.

## Two-phase construction

1. Create reviewed symbols using the native commands below.
2. Refresh Snapshot and wire only returned endpoints/route segments through
   `wireIntent` or advertised typed edits.
3. Render, inspect diagnostics, and refresh before handoff.

## Shared native authoring workflow (MCP and HTTP)

MCP wraps these operations in tools; HTTP sends the published Circuit
`transact` envelope with exactly one `command`, `wireIntent`, `edits`,
`structureEdits`, or `semanticIntent`. Read the selected transport's schemas
and current capabilities. Never send an MCP tool envelope to HTTP.

- Placement: use browser command `place-components` (MCP
  `apply_actions` / `place-component`). Native placement creates attached
  Reference and Value annotations. For `port` / `port-filled`,
  `reference` names the new Cell terminal; its Port, Net and bound terminal
  display are created atomically. Refresh Snapshot before using its actual ID
  and pin positions. Ground and power markers are not named devices.
  MOS dimensions are physical quantities: use `w:"10u", l:"1u"`, not bare
  `10`/`1` assuming micrometres. Model-specific unit conversion is generated.
- Displays: set electrical values first, then use `set-instance-display`
  with `showReference`, `showValue` or `showParameters`. Transformer keys
  are `k/lp/ls`; T-Coil keys are `k/l1/l2/cb`. Unsupported keys reject the
  action. Do not replace these projections with free text.
- Reviewed device targets: use the existing semantic `set-model` command with
  the exact reviewed target reported by the product. For reviewed SKY130 MOS
  devices this is the same path used by the GUI: it creates or reuses the
  external definition, preserves its terminal mapping and lets the netlist
  generator choose the required `X` invocation. Do not hand-author an instance
  binding for a reviewed target. Raw binding edits remain available for custom
  or unreviewed definitions.
- Net names: use browser command `set-net-label` (MCP `add-label` or
  Net Label `edit-text`). It creates the electrical name claim and attached
  annotation together. Supply `position` when creating a new label; use the
  published RichText `runs` shape (text runs use `value`, not `text`).
  A drafting text saying OUT does not name a Net.
- Batching: MCP accepts multiple `add-label`, `set-model`, and annotation
  `move` actions atomically. HTTP uses `command:{kind:"batch",commands:[...]}`
  with `set-net-label`, `set-model`, or `move-annotation` items. Planning is
  ordered; failure commits nothing, success has one undo. Keep unrelated
  command forms separate; placement and multiple wires already have batches.
- Annotation movement: `move` with an annotation target sets its absolute
  drawing position; `transform` with annotation IDs supports translation.
  Ownership/electrical binding is retained. Use explicit annotation edits for
  rotation/anchor changes; these are not silently ignored.
- Cell interface and symbol edits belong inside
  `structureEdits:[{kind:"transact_document",documentId,expectedRevision,edits:[...]}]`,
  not top-level `edits`. Use current Snapshot values. MCP's per-kind edit
  resource includes this envelope when required.
- Read, edit, refresh, render and inspect diagnostics. Use current revisions;
  on a conflict reconsider instead of overwriting human work.

## Local rearrangement and electrical facts

Prefer existing move, mirror, group transform and route edits for ordinary
layout cleanup. Agent geometry moves do not invoke GUI drag-to-connect snapping:
touching artwork is not electrical evidence. Ordinary document transaction
receipts include `terminalConnectivityChanged`, comparing document-local terminal
equivalence before and after (or the proposed preview). This does not assert
unchanged device parameters, bulk defaults or hierarchical connectivity; omitted
means unreported, not false. Use Snapshot for those facts. Keep raw typed edits
available; these are workflow guidance, not new permission gates.

Use reset-placement only for an intentional redraw; read its existing effects
and retained objects rather than assuming it only adjusts positions.

For MOS devices, read Snapshot `mosBulk` and `mosBulkDefaults` before authoring.
The resolved net and status distinguish explicit, default and instance override
bindings. Reuse defaults for ordinary devices; use the advertised bulk edits for
intentional changes. A hidden B pin needs no decorative wire. Explicit four-pin
presentation is separate from electrical binding.

Anonymous internal nets are valid. If simulation source refers to an exported
automatic net name, assign a deliberate stable name before relying on that
reference across structural edits; informational export names are not errors.

## Simulation tasks

Follow the [shared simulation workflow](simulation.md), then the selected
transport's call guide. Native source owns analyses; do not invent a second
configuration authority.
