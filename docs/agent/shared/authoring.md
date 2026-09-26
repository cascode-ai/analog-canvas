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
  `port`/`port-filled`/`vdd-port` also create the formal Cell terminal and Net
  atomically; `reference` is the terminal name (VDD defaults to `VDD`). Optional
  `direction` applies to these markers only. `set-port-direction` addresses one
  terminal or every declaration of a projected Port; `set-vdd-mode` explicitly
  switches VDD between Cell Pin and Global. Do not substitute a bare `add_instance`.
- For exact pin placement, `place-component` accepts `pinAnchor:{pinName,position}`
  instead of origin `position`; rotation/mirror still apply. It uses the shared
  routing landing (including variants and fine-pitch pins), not artwork contact,
  and rejects unreachable targets with a nearest reachable landing. Native
  `place-components` accepts `pinAnchors` by Instance ID; `place-cell` and
  `place-existing` accept `pinAnchor` to override their placement origin. No
  electrical connection is inferred. For one-shot symmetry use these placements
  or the existing selection `transform` mirror with an explicit center; this
  neither copies connectivity nor installs a persistent symmetry constraint.
- `vdd-rail` is an authoring primitive, not a symbol. Use `add-power-rail`
  with optional `name`/`scope` (existing scope is retained, otherwise local).
  Explicit `global` is not the default. Like GUI supply placement it initializes
  the default PMOS bulk; geometry alone does not connect nearby pins in Agent
  placement. The complete typed `add_power_rail` remains available. Ground and
  power markers are not named devices.
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
Display flags, Port directions, VDD mode and terminal removal can share the
existing command batch. Pure Document presentation batches do not advance the
Project structure revision. Failures identify the originating action where known.
Keep unrelated command forms separate rather than assuming arbitrary mixtures
are atomic. Both ordinary and full typed editing remain available.

For cleanup, prefer move/mirror/group transforms and route edits. Geometry moves
do not perform GUI drag-to-connect snapping. `terminalConnectivityChanged` in
ordinary transaction receipts compares document-local terminal equivalence;
it does not assert unchanged parameters, bulk or hierarchy. Omitted means unknown.
Use reset-placement only for intentional redraw, with its documented effects.
`delete` uses the GUI selection-deletion planner, including owned displays and
formal interface declarations. `delete-selection` accepts multiple explicit
object IDs in one transaction; selecting every object clears a Cell, while
unselected wires remain dangling. Reset modes retain their existing meanings
and must not be used as a synonym for deleting the entire Cell.

The focused `circuit_text` action `move-annotation` sets an absolute position;
the legacy `apply_actions` annotation `move` uses the same semantics, while
`transform` supports translation. These preserve ownership and electrical
binding. Use explicit annotation edits for rotation/anchor changes. Search uses
resolved display text, including bound Net and device labels. `edit-text` on a
bound Pin, Reference, Net, or Value label restyles the same visible characters;
change the owning terminal, name claim, Reference, or parameter to change them.

Cell interface/symbol edits use `structureEdits` with a nested
`transact_document`, not top-level `edits`; the per-kind contract supplies that
envelope when needed. HTTP callers use their published transact schema, not an
MCP tool envelope. Current revision guards and locks always apply.

For simulation, go directly to the selected transport's call guide. The
[shared simulation workflow](simulation.md) is optional detail for unfamiliar
electrical/capture semantics, not another mandatory read.
