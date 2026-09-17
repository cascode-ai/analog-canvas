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
- Displays: set electrical values first, then use `set-instance-display`
  with `showReference`, `showValue` or `showParameters`. Transformer keys
  are `k/lp/ls`; T-Coil keys are `k/l1/l2/cb`. Unsupported keys reject the
  action. Do not replace these projections with free text.
- Net names: use browser command `set-net-label` (MCP `add-label` or
  Net Label `edit-text`). It creates the electrical name claim and attached
  annotation together. Supply `position` when creating a new label; use the
  published RichText `runs` shape (text runs use `value`, not `text`).
  A drafting text saying OUT does not name a Net.
- Read, edit, refresh, render and inspect diagnostics. Use current revisions;
  on a conflict reconsider instead of overwriting human work.

## Simulation tasks

Follow the [shared simulation workflow](simulation.md), then the selected
transport's call guide. Native source owns analyses; do not invent a second
configuration authority.
