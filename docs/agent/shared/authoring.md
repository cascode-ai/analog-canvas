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
A Cell Pin marker (`port`, `port-filled`, `vdd-port`) has `reference: null`;
its name is its terminal's, in `cellTerminal: {id, name, direction}`.
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
- Parts are named as the GUI names them. A device's `reference` starts with
  its prefix (R, C, M, …), and a `place-cell` instance's with X. Leave it out,
  on `place-component` or `place-cell`, and the next free name is taken (`R1`,
  `X1`, `X2`, …). A name with another prefix, or one already in use, is
  rejected with a free name, because it would block the netlist; nothing is
  placed. To draw another name, as textbooks label an op-amp A1, place it under
  its own name and use `set-display-alias`.
- For exact pin placement, `place-component` accepts `pinAnchor:{pinName,position}`
  instead of origin `position`; rotation/mirror still apply. It uses the shared
  routing landing (including variants and fine-pitch pins), not artwork contact,
  and rejects unreachable targets with a nearest reachable landing. Native
  `place-components` accepts `pinAnchors` by Instance ID; `place-cell` and
  `place-existing` accept `pinAnchor` to override their placement origin.
  `move` also accepts `pinAnchor` instead
  of `position` for a placed Instance, preserving its rotation/mirror and using
  the current resolved pin landing, and names the nearest reachable landing
  when a pin cannot land where asked; tray Instances use `place-existing`
  (with a `pinAnchor`, its `placement` may be left out). No electrical
  connection is inferred. For a symmetric half, place each part with
  `mirrorOf:{instance, x}` (or `y`): the mirror image of a placed part about
  that line, exact, Ports and their names included. Or use the selection
  `transform` mirror with an explicit center. Neither copies connectivity nor
  installs a persistent symmetry constraint.
- A Port's lead leaves its circle to the east, as an input at the left edge
  is drawn. Place an output at the right edge with `mirror:"horizontal"` so
  its circle ends the wire; otherwise the wire has to hook round the circle
  to reach the pin (`VISUAL_TERMINAL_DEPARTURE`, "from the side").
  For free drafting text, selection `transform` translation preserves fine
  offsets and formatting. Attached drafting objects follow a selected owner;
  moving one separately requires an explicit anchor edit. Locked targets reject
  the atomic request. A selection `transform` mirror without a center reflects
  the whole selection about its own axis, as the editor's Mirror does: parts,
  wires alone or with them, Junctions, labels and drafting objects, with every
  connection unchanged; a wire held by an unselected part stays with it. With
  an explicit center, labels and drafting objects are rejected. Other drafting
  transforms retain their existing limits.
- `vdd-rail` is an authoring primitive, not a symbol. Use `add-power-rail`
  with optional `name`/`scope` (existing scope is retained, otherwise local).
  Explicit `global` is not the default. Like GUI supply placement it initializes
  the default PMOS bulk; geometry alone does not connect nearby pins in Agent
  placement. The complete typed `add_power_rail` remains available. Ground and
  power markers are not named devices.
- A rail grows, it is not doubled. `add-power-rail` along the line of an
  existing rail of the same supply, overlapping or touching it, extends that
  rail to cover both spans, with one label. `extend-power-rail`
  `{routeId,start,end}` sets a straight rail's two ends on its own line:
  - taps stay where they are;
  - the label goes with its end;
  - no pin is joined;
  - a span that would drop a tap, or move an end that carries a tap, is
    refused with the tap's ID.
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
- Use `set-model` with the product's reviewed target, the full library name
  such as `sky130_fd_pr__nfet_01v8`. In a SKY130 Project the short name the
  Netlist panel shows (`nfet_01v8`) means the same device. SKY130 MOS targets
  reuse the GUI binding path, preserve terminal mapping and export the
  required `X` subcircuit invocation. Any other name is a raw model binding,
  for custom definitions; it leaves the Project's Process as Custom.
- `place-component` without `parameters` places a part as the GUI library
  does: each parameter's catalog default, and for a transistor the model of
  the Process the Netlist panel shows. A BJT in a SKY130 Project arrives as
  the reviewed SKY130 wrapper, keeping its `m`. Given `parameters` win, and
  only a value given is shown in a Value label.
- `place-component` and `set-property` refuse a parameter the part does not
  take (naming the one it most likely meant), a value outside a choice list,
  and a quantity that is neither a SPICE number (`1k`, `2.5n`, `9kΩ`) nor an
  expression in braces (`{vdd/2}`). Write micro as `u`. The same checks run
  on stored values, as Cell diagnostics.
- Three-terminal MOS artwork still has an electrical B pin. Read `mosBulk` and
  `mosBulkDefaults`; ordinary devices reuse defaults. To give one device
  another body, `connect` its B pin to that Net, as the GUI's Draw action
  does: the body leaves the Cell default for a dashed body wire. In a Cell
  with two supplies, check the PMOS on the one that is not the default.
  Hidden bulk needs no decorative wire; four-pin presentation is a separate
  visual choice.
- Name Nets with `add-label` / Net Label `edit-text` (native `set-net-label`).
  This creates the name claim and bound annotation together; free text does not.
  Supply `position` for a new label. RichText text runs use `value`, not `text`.
  Anonymous internal Nets are valid; deliberately name nodes referenced by
  simulation scripts so generated names cannot silently change their meaning.

## Edit locally and batch

### Controlled sources

The catalog IDs `vcvs`, `vccs`, `cccs`, `ccvs` reuse the ordinary source artwork.
MCP `circuit_place` / `place-component` accepts `control` beside `parameters`.
Change or clear it with `circuit_properties` action `set-source-control`, an
Instance `target`, and `control` (null clears the selection). This preserves
parameters and binding. The editable visual formula is an existing Annotation,
not a control expression or a second `displayExpression` property.

- VCVS/VCCS: `control:{kind:"voltage",positiveNetId:"<id>",negativeNetId:"<id>"}`.
  Read stable Net IDs from the live Snapshot, not displayed names or numbers.
- CCCS/CCVS: `control:{kind:"terminal-current",instanceId:"<id>",pinName:"<pin>",direction:"into"}`.
  Inspect the target's pins first. `into` means current entering that device
  terminal; `out` reverses it. Selecting two Nets does not define branch current.
  Export reuses an eligible voltage-source sensor or inserts a shared series
  zero-volt probe; it does not change the drawing.
- Explicit existing voltage-source sensing is also supported with
  `control:{kind:"current",sensorInstanceId:"<id>"}`.

Full Snapshot and selected-pin projections return the authored
`instance.netlist.control`, including incomplete selections. Missing targets or
incomplete controls are not simulation-ready; review netlist diagnostics.
Use catalog parameter names/units (`gain`, `gm` in S, `rm` in ohms),
not the visual formula as a simulator expression. Raw HTTP uses native
`place-components` with `instances[].netlist.control` or the typed
`set_instance_netlist` edit. That edit replaces all netlist facts: preserve
existing binding and parameters when changing only control. MCP and HTTP use
the same model and exporter; no alternate electrical protocol is needed.

### Switch clock phases

An Open or Closed switch (`ideal-switch`, `closed-switch`) is clocked by the
phase its name label shows; a freshly placed `S1` is clocked by a phase called
`S1`. To share one clock, write the phase on each switch's label with
`circuit_properties` `set-display-alias {target, text:"Φ_1"}`: the netlist
then writes `S1 a b PHI1 VSS ideal_switch`, and every switch showing Φ₁ follows
the same clock. Drive it with a Net named `Φ1` (a Net Label, or the Net of a
pulse source) or a Cell Pin `Φ1`; until then `SWITCH_PHASE_NOT_DRIVEN` warns.
Free text beside a switch is drawing only and clocks nothing. A Ctrl SW
(`externally-controlled-switch`) takes its control from its CTRL pin instead.

Multiple placements, wires, labels, model assignments and annotation moves have
existing atomic batch paths. Failure commits nothing; success has one undo.
One transaction takes at most 64 expanded edits. A placed part expands to about
three (the part and its name and value labels) and a Cell Pin to about five, so
one `circuit_place` call fits about 20 parts. A placement batch over the limit
commits nothing and fails with `LIMIT_EXCEEDED`; its diagnostic gives
`expandedEdits`, `maxTransactionEdits` and `fittingPlacements`, the number of
leading placements that fit in one call. An over-limit `delete-selection`
gives the same two counts, the selected count per class
(`selectedInstances`, `selectedRoutes`, …) and the leading part that fits,
taken in class order (`fittingInstances`, `fittingRoutes`, …). Delete that
part, then refresh and delete what remains, since deleting a part also deletes
wires that only tapped it. Any other command over the limit names itself and
its `expandedEdits`.
Display flags, Port directions, VDD mode and terminal removal can share the
existing command batch. Pure Document presentation batches do not advance the
Project structure revision. Failures identify the originating action where known.
Keep unrelated command forms separate rather than assuming arbitrary mixtures
are atomic. A list that would need several transactions commits nothing and
fails with `ACTION_BATCH_NOT_ATOMIC`; its `calls` list says which action
indexes go in which call, in order (a power rail, for example, is a command of
its own, apart from a placement batch). Both ordinary and full typed editing
remain available.

`route-net` (in `apply_actions`, native `command`) fills missing visible connections for a
current Net ID/name, one member pin, an explicit list of pins to join, or a
frozen import-reference `sourceNetId`. An import ID is not a current Net ID.
It reuses the visible connectivity and atomic wire planners, skipping already
connected components. Optional `trunk:{start,end}` specifies one straight
horizontal/vertical trunk. Without one, a node is drawn as a person draws it:
first a straight trunk between two of its pins that line up with nothing in the
way, then each other component joined where it is cheapest, at a pin or
Junction already joined or straight onto a wire already drawn, so branches meet
the line in T junctions rather than chaining pin to pin. A wire never
passes over another Net's pin, through a part (its own included) or along its
drawn leads, or onto another Net's wire, since each would read as a connection
the netlist does not have. Each guide wire takes the cheapest of a few simple
paths that avoids them: the plain L, a short lead out of a pin, or a detour
along a free row or column. When none does, or a pin already sits on another
Net's wire, the whole operation is refused and the message names the pin, part
or Route in the way; move parts apart or give a trunk. Where a Net cannot
cross the drawing, such as a cascode bias line reaching both halves of an
amplifier, name it at each end instead: `connect` the pin to an open
`{kind:"point"}` a grid step or two out, then `add-label` with the Net's name
and the pin as its target, `{kind:"pin",instance:"M4",pin:"G"}`, which puts the
label on that stub; Nets of one name in a Cell are one Net. A name too wide to
sit clear over the stub stands at its open end, reading outward; where that
end is crowded too, the label stays on the stub and `VISUAL_LABEL_CLEARANCE`
says so, so move the parts apart. A trunk and its branches
are checked the same way and refused, not bent. This is not a general
autorouter: conflicting taps or excess expanded edits also reject the whole
operation. Ordinary crossings without a Junction remain legal. It does not move
devices, infer bulk wiring or override import-reference shorts/scope conflicts;
place missing devices and fix those facts first. A structural SPICE import lays
its Cell Pins around the devices, each lead facing them: supplies (`VDD`,
`VCC` and the like) above, grounds (`VSS`, `GND`, `0`) below, outputs (`out`,
`vout`, or a Net only drains and collectors drive) right, the rest left.
Several `route-net` actions can share one atomic command batch; each resolves
against the preceding private result. The total expanded edit limit still
applies, and any invalid later target leaves the whole batch unapplied.
Its focused contract is `describe_tool({tool:"apply_actions",operations:["route-net"]})`;
use it when parameters are unfamiliar, not as a mandatory preflight. Ordinary
`circuit_wire` keeps its compact connect/disconnect declaration.

A pin left unused on purpose, such as a flip-flop's QBAR or one side of a
differential output, needs a No Connect mark, or the netlist blocks with
`MISSING_PIN_NET`: `{kind:"disconnect",target:{kind:"pin",instance:"X1",pin:"QBAR"},noConnect:true}`.
A wired pin is disconnected first. The pin exports as its own floating node
(`NC0001`), reported as information. `noConnect:false` removes the mark.

For cleanup, prefer move/mirror/group transforms and route edits. Geometry moves
do not perform GUI drag-to-connect snapping. `terminalConnectivityChanged` in
ordinary transaction receipts compares document-local terminal equivalence;
it does not assert unchanged parameters, bulk or hierarchy. Omitted means unknown.
Use reset-placement only for intentional redraw, with its documented effects.
`clear-drawing` and `reset-placement` both remove every wire. A Net or supply
label drawn on a wire stays where it was drawn, now free, so the netlist keeps
its name; a current or voltage marker drawn on a wire goes with the wire. A
supply rail's own label stays as well: it carries the supply's name and, for a
local rail, the Cell's supply Pin. The receipt lists every label it moved.
`delete` uses the GUI selection-deletion planner, including owned displays and
formal interface declarations. `delete-selection` deletes multiple explicit
object IDs in one transaction. They are nested in `selection`, one list per
object type, and a list left out is empty:
`{"kind":"delete-selection","selection":{"instanceIds":["M1"],"routeIds":["route-3"]}}`.
The lists are `instanceIds`, `routeIds`, `junctionIds`, `annotationIds`,
`draftingIds` and `noConnectIds`. Unknown or wrongly
classified IDs reject the entire Agent selection; free text created by
`annotate` belongs in `draftingIds`, not `annotationIds`. Selecting every object clears a Cell.
Deleting a part also deletes a wire that only tapped it into other wiring, a
stub from its pin to a junction on another wire or to nowhere, through plain
bends. A wire that runs on to another part's pin stays, open where the part was,
so a replacement placed there reconnects. Wires carrying a label stay too. A
wire left ending in the open is reported as `ERC_DANGLING_WIRE`, with its
Route and Junction IDs. Reset modes retain their existing meanings
and must not be used as a synonym for deleting the entire Cell.
To remove a formal Cell Pin use `remove-cell-terminal` or selection deletion;
disconnecting its `P` alone would leave an invalid declared interface.

For an explicit label cleanup, `circuit_text` / `apply_actions` accepts
`{kind:"arrange-labels",instanceIds:["…"]}`. It compacts visible default label
slots and tries a fixed set of nearby collision-avoiding positions in one
undoable operation, keeping each Reference clear before its value. A part's
labels may slide along its side to fit between two rows of wiring; they keep
a word's space from other labels and stay on their part's side of any wire
but its own. Where parts
sit too close for both, the value is the one left touching a wire; hide values
with `set-instance-display` or move the parts apart. A requested Port's name
that a part or wire now covers moves to the first clear one of its sides. Set `compact:false` or `avoidCollisions:false` to disable
either part; `referenceStyle:"first-letter-subscript"` optionally displays
`RBIAS` as an R with BIAS subscript without changing the Reference. Manual/free,
locked, hidden and custom-styled labels are preserved. This is not an autorouter
or a whole-drawing beautifier. Informational label-clearance/owner-distance
observations may remain and never gate editing. New Net labels use the GUI's
standard side/alignment; existing explicit label moves retain their semantics.

The focused `circuit_text` action `move-annotation` sets an absolute position;
the legacy `apply_actions` annotation `move` uses the same semantics, while
`transform` supports translation. These preserve ownership and electrical
binding. A Net label moved beside its own wire, along a segment and within 20
units of it, stays attached to that wire where it was put and follows it;
moved further it becomes free and still names its Net. New Net labels stand
just above a horizontal wire, as close as their text allows. Use explicit
annotation edits for rotation/anchor changes. Search uses
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
