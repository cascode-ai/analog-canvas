# Schematic Model

Status: `accepted`

Primary owner: `packages/model`

A Project contains Documents, each owning revisioned electrical, geometric and
presentation facts. The model is strict schema 58 with no compatibility shape;
the [file format](project-file-format.md) owns versions and migration. All
mutation goes through atomic [Edit Engine](edit-engine.md) transactions;
cross-Document edits use one Project transaction guarded by
`structureRevision`.

## Coordinate domains

- Instance placements, Junctions and Route bends are integer multiples of
  `presentation.grid`; annotation anchors and drafting geometry use 1-unit
  integers. These are validation rules
  ([schema](../../packages/model/src/schema/document.ts)), not snap
  preferences; invalid coordinates are rejected with their path, never
  rounded.
- Renderer bounds, text layout, resolved anchors, curves, diagnostics,
  pointer positions and symbol artwork may be floats; they are read-only or
  transient and converted before persistence. Route-anchor `t` and normal
  offset are not page Points.

## Electrical authority

- `Instance` selects one canonical symbol and optional variant.
  `Instance.reference` is its sole authored Reference, independent of `id` and
  binding, kept across process/model selection; the
  [netlist exporter](netlist-export.md#persisted-data-model) derives dialect
  names without rewriting it (`M1` may emit `XM1`). Its prefix must match the
  invocation kind and it is unique case-folded within the Cell. Cell Pins
  project `CellTerminal.name` instead.
- Parameters live in `Instance.netlist`, defined by the selected model
  contract (reviewed external binding, declared Cell/external parameters, or
  built-in Device Descriptor). Insert, Properties, validation, parameter display
  and export consume the same names and meanings.
  Import terminal order and symbol mapping live only in
  `Instance.importProvenance`; `Instance.properties` does not persist.
- A Base Net indexes physical membership; a terminal `{instanceId, pinName, memberId?}`
  belongs to at most one. [Portable connection facts](project-file-format.md#one-connection-source)
  are authoritative at the file boundary.
- `ConnectivityEvidence` records owner-addressed name claims, explicit SPICE
  globals, non-electrical source-name hints and SPICE source identity, one
  scalar Base Net each; explicit signal claims expand in declared member order.
  No generic persisted equivalence edge.
  [Connectivity](connectivity-and-routing.md#net-naming-and-lifecycle) owns
  name equivalence, scope and conflicts.
- A scalar `Route` owns one Net's geometry; a bus carries ordered scalar
  member mappings, as defined by [connectivity](connectivity-and-routing.md#ordered-signals-and-buses).
  Each electrical edge agrees with both ends; legs retain stable IDs and modes.
  `Junction` owns branch geometry. `NoConnect` targets one terminal and
  excludes Net membership.
- `Document.netlist.terminals` lists authored Cell Pins: stable ID, name,
  direction, Net ID and a singleton `interfaceInstanceIds` naming its one
  canvas Instance (pin `P`). Each formal terminal has exactly one interface
  owner; there is no free-Port collection. Equal folded names resolve to one
  Logical Net while declarations, directions and Base Nets stay separate. A
  Port name may differ from a visible internal Net Label without overwriting
  it.
- `port` is the hollow Cell Pin, `port-filled` the solid Bias Voltage Port
  (same storage). VDD Power owns a Cell-Pin declaration by default and can be
  switched to Global in Properties. A local Power Rail owns a formal terminal
  through its `power-label` annotation (no hidden Instance); a global one has
  only the claim.
- `projectCellInterface` groups declarations by case-insensitive Port Name
  (first declaration's order and spelling); never persisted, never merges
  objects, creates no connectivity (hierarchy trace omits a multi-member Port
  unless electrical facts already join its members).
- Ground, Global VDD, Net Label and Power Rail author the same `name-claim`,
  which owns scope and optional supply role. New VDD and Power Rail default
  local; Ground is global node `0`. `AVDD` and `DVDD` differ even with the same
  `vdd` role.
- GUI naming writes the owner's `name-claim` on an existing Base Net; never
  `merge_nets` or `Net.name`. Only physical contact merges Base Nets.
  Contacting equal-folded local and global Nets gives the group global scope
  while both claims stay. No normalization from legacy metadata or by text.
- Conflicting claims block export and the introducing transaction; so does a
  formal Cell Pin plus a Global declaration on one Logical Net, except Ground
  `0`.
- `electricalTopologyHash` covers Instances, Nets, membership, Routes,
  Junctions, NoConnects and formal terminals, not placement, annotations or
  drafting.
- Internal subcircuit bindings reference one child Document (Cell name
  derived); external bindings reference one project-level definition;
  unresolved imported bindings keep a target name.

## MOS bulk

`nmos`/`pmos` have D/G/S/B; `textbook-3terminal` is presentation only. B
resolves from explicit membership, then a configured cell-default Net, then
the one wired supply marker of its domain in the Cell (`ground` for NMOS,
`vdd-port` for PMOS) as read-only `supply-default`, never written. None or
several markers leave B unresolved; export then places it as
[netlist export](netlist-export.md#implicit-supplies-and-mos-bodies) states.
Persisted `supply-default` bindings stay readable. Cross-Document copy turns
an effective `cell-default` into `instance-override`. Imported MOS without a
fourth node stay unresolved; when all imported MOS of one polarity in a Cell
share a B Net, that Net becomes the Cell default (mixed sets none). A visible
`bulk-dashed` route is an explicit override that atomically removes the
implicit default binding.

## Instance lifecycle

Tray (`placement: null`), placed, or deleted. Returning to the Tray keeps all
electrical, netlist and annotation facts (annotations hidden and unhittable);
visible Route endpoints detach to a Junction at the grid landing. Deletion is
a separate atomic composition clearing membership, NoConnect, owned
annotations and unlocked layout references.

## Presentation authority

- Every visible editable label is a `SchematicAnnotation`: bounded RichText
  `content` and one `VisualAnchor` (free, object- or route-relative) with a
  fallback position used only when the target dangles. The resolved position
  is the one baseline for rendering, hit geometry, export bounds and
  diagnostics.
- `instance-reference` resolves only `Instance.reference`; it, `net-name` and
  `cell-terminal-name` may carry a same-text `formatOverride`;
  `instance-value` resolves authored parameters through the selected model's
  contract. Show Value keeps scalar values and MOS W/L typography; geometry
  R/C uses `W=… L=…` and the model's non-unit multiplier. Individual parameter
  labels bind declared names. Missing definitions/values paint no stale text;
  placeholders never supply a value. Opening a Project creates no labels.
  Display toggles preserve anchors, styles and existing visibility semantics.
  Editing an `instance-label`'s
  text makes it literal (drops `binding` and `formatOverride`) until explicit
  reset. Literal and custom attached text has no identity or export
  authority. Renderers never derive text from IDs, bindings, provenance or
  copied properties. Drafting objects never create connectivity.
- Optional `textColor` is presentation only; absent, instance labels/values
  inherit the Instance foreground and other kinds the Document profile.
- RichText is either styled runs or one formula run (bounded LaTeX plus
  inline/display); generated SVG, paths, bounds and caches never persist.
- Rectangle/circle drafting may override border and fill; `layer` is
  background (below circuit) or foreground (default); `zIndex` orders within
  a plane.
- `presentation.cellSymbol` (optional): legacy minimum size, optional explicit
  `bodyBounds`, and unique `terminalId`-keyed side/offset placements (existing
  terminals, one per slot). Explicit edges use the 10-unit grid, span at least
  20 units per axis and contain every pin at least 10 units from a corner;
  offsets are relative to the fixed Symbol origin. Explicit bodies do not fit
  themselves to text. Absent bounds retain the previous derived geometry.
  The resolver derives block and anchors. While no parent has placed
  the Cell, new supply Pins (VDD Power, or named like VDD/VCC/VSS/GND) get a
  top/bottom placement and unplaced Pins sit on the side their Port is drawn
  (top-to-bottom order; middle stays automatic), sized so names clear; the
  first placement persists these, and a placed Cell's block never changes by
  this rule.

## Project-owned external model sources

- An external definition binds one `modelSources` owner (SPICE files, entry,
  pinned dependencies, applied revision, optional draft; shareable by several
  entries) and a native subcircuit entry, or declares a placeholder; no
  binding keeps the legacy/reviewed-library contract.
- The native declaration owns target, terminal order and defaults; the saved
  interface is a checked projection; terminal IDs survive reorder and explicit
  rename; a matching library name grants no reviewed semantics; reviewed
  interfaces stay fixed.
- `apply_model_source` (GUI and Agent, one Project transaction) checks
  declarations, include closure and migration without simulating; connected
  removal needs explicit remap/disconnect (wires become Junction stubs);
  source, interfaces and callers commit atomically.
  `save_model_source_draft` stores unapplied bytes under a revision guard;
  `upsert_model_source` may only add an owner. Project Code ignores authored
  concurrency tokens and advances the applied revision when files, entry or
  dependencies change; an unchanged draft needs explicit rebase. Stale or
  inconsistent edits refuse.
- Custom artwork follows [Symbol DSL](symbol-dsl.md#source-backed-custom-artwork);
  a property supply cannot also have a route or No Connect.
- Simulation source folders are [simulation](simulation.md)'s; output labels
  never name or join Nets.
