# Circuit authoring

## Facts needed to draw

The built-in catalog owns asset IDs, canonical pins and variants. Live Snapshot
projections own existing IDs, placement, Net membership, revision and bulk.
Use live resolved facts for imported/custom/PDK assets; ask the human only when
a needed fact is unavailable. Never infer electrical connectivity from artwork.

Normal path: **place → read selected pins → wire → review the render**.
Accepted edit receipts provide current revisions and diagnostics; no confirmation
reread is required. Refresh affected facts after a human change or stale-revision
rejection. Read the full Snapshot only when the task needs broad context.

For new endpoints, MCP uses `inspect` target `pins` with `instanceIds` (up to 64);
HTTP uses Snapshot projection `pins`. It returns selected instances, resolved
pin geometry, Net IDs and bulk facts without full topology/diagnostic output.
Use returned endpoints and stable Route/leg IDs; a crossing is not a connection.
In MCP wiring, use `instance:{kind:"instance",id:"<returned-id>"}` for pin
targets to avoid full-Snapshot name resolution. Names remain supported when useful.

## Place, name and bind

- Place through native `place-components` (MCP `circuit_place` actions
  `place-component`), which creates attached Reference/Value displays.
  `port`/`port-filled` also create the formal Cell terminal and Net atomically;
  `reference` is the terminal name. Do not substitute a bare Port `add_instance`.
- `vdd-rail` is an authoring primitive, not a symbol. Use `add-power-rail`
  (typed `add_power_rail`) with explicit Net name/scope and `powerDomain:"vdd"`.
  Ground and power markers are not named devices.
- Set electrical values before their display. MOS sizes are physical quantities:
  `w:"10u", l:"1u"`, not `10/1` assuming micrometres. Use
  `set-instance-display` for Reference/Value/parameters, not detached text.
  Transformer parameter keys are `k/lp/ls`; T-Coil keys are `k/l1/l2/cb`.
- Use `set-model` with the product's reviewed target. SKY130 MOS targets reuse
  the GUI binding path, preserve terminal mapping and export the required `X`
  subcircuit invocation. Raw bindings remain available for custom definitions.
- Three-terminal MOS artwork still has an electrical B pin. Read `mosBulk` and
  `mosBulkDefaults`; ordinary devices reuse defaults. Use dedicated bulk edits
  for overrides. Hidden bulk needs no decorative wire; four-pin presentation
  is a separate visual choice.
- Name Nets with `add-label` / Net Label `edit-text` (native `set-net-label`).
  This creates the name claim and bound annotation together; free text does not.
  Supply `position` for a new label. RichText text runs use `value`, not `text`.
  Anonymous internal Nets are valid; deliberately name nodes referenced by
  simulation scripts so generated names cannot silently change their meaning.

## Edit locally and batch

Multiple placements, wires, labels, model assignments and annotation moves have
existing atomic batch paths. Failure commits nothing; success has one undo.
Keep unrelated command forms separate rather than assuming arbitrary mixtures
are atomic. Both ordinary and full typed editing remain available.

For cleanup, prefer move/mirror/group transforms and route edits. Geometry moves
do not perform GUI drag-to-connect snapping. `terminalConnectivityChanged` in
ordinary transaction receipts compares document-local terminal equivalence;
it does not assert unchanged parameters, bulk or hierarchy. Omitted means unknown.
Use reset-placement only for intentional redraw, with its documented effects.

Annotation `move` sets an absolute position; annotation `transform` supports
translation. These preserve ownership and electrical binding. Use explicit
annotation edits for rotation/anchor changes. Search uses resolved display text,
including bound Net and device labels.

Cell interface/symbol edits use `structureEdits` with a nested
`transact_document`, not top-level `edits`; the per-kind contract supplies that
envelope when needed. HTTP callers use their published transact schema, not an
MCP tool envelope. Current revision guards and locks always apply.

For simulation, go directly to the selected transport's call guide. The
[shared simulation workflow](simulation.md) is optional detail for unfamiliar
electrical/capture semantics, not another mandatory read.
