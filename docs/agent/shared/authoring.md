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
  `direction` applies to these markers only; native `terminalDirections` keys
  must identify new Cell markers. The first explicit supply in a placement batch
  initializes an absent bulk default; later supplies do not overwrite it.
  `set-port-direction` addresses one
  terminal or every declaration of a projected Port; `set-vdd-mode` explicitly
  switches VDD between Cell Pin and Global. Do not substitute a bare `add_instance`.
- For exact pin placement, `place-component` accepts `pinAnchor:{pinName,position}`
  instead of origin `position`; rotation/mirror still apply. It uses the shared
  routing landing (including variants and fine-pitch pins), not artwork contact,
  and rejects unreachable targets with a nearest reachable landing. Native
  `place-components` accepts `pinAnchors` by Instance ID; `place-cell` and
  `place-existing` accept `pinAnchor` to override their placement origin.
  `move` also accepts `pinAnchor` instead
  of `position` for a placed Instance, preserving its rotation/mirror and using
  the current resolved pin landing; tray Instances use `place-existing`. No
  electrical connection is inferred. For one-shot symmetry use these placements
  or the existing selection `transform` mirror with an explicit center; this
  neither copies connectivity nor installs a persistent symmetry constraint.
  For free drafting text, selection `transform` translation preserves fine
  offsets and formatting. Attached drafting objects follow a selected owner;
  moving one separately requires an explicit anchor edit. Locked targets reject
  the atomic request. Other drafting transforms retain their existing limits.
- `vdd-rail` is an authoring primitive, not a symbol. Use `add-power-rail`
  with optional `name`/`scope` (existing scope is retained, otherwise local).
  Explicit `global` is not the default. Like GUI supply placement it initializes
  the default PMOS bulk; geometry alone does not connect nearby pins in Agent
  placement. The complete typed `add_power_rail` remains available. Ground and
  power markers are not named devices.
- Set electrical values before their display. MOS sizes are physical quantities:
  `w:"10u", l:"1u"`, not `10/1` assuming micrometres. Use
  `set-instance-display` for Reference/Value/parameters, not detached text.
  Use `annotate` only for independent notes or authored notation. Its alignment
  and typography defaults match GUI Text insertion; explicit RichText keeps its
  authored look. `edit-text` strings change content without clearing existing
  spans. A same-text string on a bound display leaves its format alone; use
  explicit RichText to restyle it. Fractions/formulas need explicit RichText
  for a structural replacement, not a lossy plain-text projection.
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

`route-net` (in `apply_actions`, native `command`) fills missing visible connections for a
current Net ID/name, one member pin, an explicit list of pins to join, or a
frozen import-reference `sourceNetId`. An import ID is not a current Net ID.
It reuses the visible connectivity/MST and atomic wire planners, skipping already
connected components. Optional `trunk:{start,end}` specifies one straight
horizontal/vertical trunk; otherwise follow the shared guide tree. This is not
an obstacle autorouter: conflicting taps or excess expanded edits reject the
whole operation. Ordinary crossings without a Junction remain legal. It does
not move devices, infer bulk wiring or override import-reference shorts/scope
conflicts; place missing devices and fix those facts first.
Several `route-net` actions can share one atomic command batch; each resolves
against the preceding private result. The total expanded edit limit still
applies, and any invalid later target leaves the whole batch unapplied.
Its focused contract is `describe_tool({tool:"apply_actions",operations:["route-net"]})`;
use it when parameters are unfamiliar, not as a mandatory preflight. Ordinary
`circuit_wire` keeps its compact connect/disconnect declaration.

For cleanup, prefer move/mirror/group transforms and route edits. Geometry moves
do not perform GUI drag-to-connect snapping. `terminalConnectivityChanged` in
ordinary transaction receipts compares document-local terminal equivalence;
it does not assert unchanged parameters, bulk or hierarchy. Omitted means unknown.
Use reset-placement only for intentional redraw, with its documented effects.
`delete` uses the GUI selection-deletion planner, including owned displays and
formal interface declarations. `delete-selection` accepts multiple explicit
object IDs (including `noConnectIds`) in one transaction. Unknown or wrongly
classified IDs reject the entire Agent selection; free text created by
`annotate` belongs in `draftingIds`, not `annotationIds`. Selecting every object clears a Cell, while
unselected wires remain dangling. Reset modes retain their existing meanings
and must not be used as a synonym for deleting the entire Cell.
To remove a formal Cell Pin use `remove-cell-terminal` or selection deletion;
disconnecting its `P` alone would leave an invalid declared interface.

For an explicit label cleanup, `circuit_text` / `apply_actions` accepts
`{kind:"arrange-labels",instanceIds:["…"]}`. It compacts visible default label
slots and tries a fixed set of nearby collision-avoiding positions in one
undoable operation. Set `compact:false` or `avoidCollisions:false` to disable
either part; `referenceStyle:"first-letter-subscript"` optionally displays
`RBIAS` as an R with BIAS subscript without changing the Reference. Manual/free,
locked, hidden and custom-styled labels are preserved. This is not an autorouter
or a whole-drawing beautifier. Informational label-clearance/owner-distance
observations may remain and never gate editing. New Net labels use the GUI's
standard side/alignment; existing explicit label moves retain their semantics.

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
