# Circuit authoring

The built-in catalog owns asset IDs, canonical pins and variants; the live
Snapshot owns existing IDs, placement, Net membership, revision and bulk. Use
live resolved facts for imported/custom/PDK assets; ask the human only when a
needed fact is unavailable. Never infer connectivity from artwork.

## Pin geometry and the normal path

A catalog pin's `at` is its offset from the origin at rotation 0, y down;
`landing`, where given, is where a wire attaches. Variants may hide pins
(`hiddenPinNames`), add `auxiliaryPins` and have their own `bounds`, the ink a
wire must not cross (`null` for a formula block that grows with its text).

Orientation rotates the offset clockwise, then mirrors it, about the origin:
(x, y) → (-y, x) at 90, (-x, -y) at 180, (y, -x) at 270, so at `rotation:90`
nmos D at (10, -20) lands at origin + (20, 10). A resistor lies horizontal
with pin 1 left at 270; a diode points down at 90. `mirror:"horizontal"` then
negates x, `"vertical"` y, `"both"` both.

Normal path: **place → read selected pins → wire → review the render → fit the
view**. Accepted receipts carry current revisions and diagnostics; refresh only
after a human change or stale-revision rejection, and read the full Snapshot
only for broad context. New endpoints come from MCP `inspect` target `pins`
with `instanceIds` (up to 64) or HTTP Snapshot projection `pins`: pin
geometry, Net IDs and bulk without full topology. A Cell Pin marker (`port`,
`port-filled`, `vdd-port`) has `reference: null` and its name in
`cellTerminal: {id, name, direction}`. A crossing is not a connection: leave
it plain, with no hop. Drafting never fakes or hides circuit geometry: no hops,
masks or lines over wires or parts. A white (sheet-colored) drafting stroke or
fill is refused (`EDIT_PRECONDITION`), and the Gallery refuses a Project
holding one (`drafting-cover`).

`place-component` takes an optional `id` of your choosing (refused if taken).
Give one to a ground, each VDD marker and any part you will wire: later actions
of the list may name it by that ID or its Reference. In MCP wiring
`instance:{kind:"instance",id}` avoids full-Snapshot name resolution (use it
for imported Cell Pins). A name several parts share (every VDD marker's `VDD`)
is refused with their IDs, never resolved to the first.

## Place and name

- Place with native `place-components` (MCP `circuit_place`
  `place-component`), which creates attached Reference/Value displays; never a
  bare `add_instance`. Without `parameters` a part gets catalog defaults and a
  transistor the Netlist panel Process's model (a SKY130 BJT the reviewed
  wrapper, keeping `m`). The receipt's `placed` lists `{id, reference, symbol}`
  per part in order, so wiring needs no read.
- References follow the GUI: a device's starts with its prefix (R, C, M, …), a
  `place-cell` instance's with X; omitted, the next free name is taken (`R1`,
  `X2`; a block that emits nothing gets none). A wrong prefix or a used name is
  rejected with a free name and nothing is placed. To draw another name (op-amp
  `X1` as A1) use `set-display-alias {target, text}` (`text:null` restores);
  it survives Project Code and Copy.
- A device shows its name alone. `showValue:true` on `place-component` shows
  its value; `showReference:false` hides the name (native `displays` keyed by
  new Instance ID); Cell markers and ground take neither. Later,
  `set-instance-display` (`instanceIds`, `showReference`, `showValue`,
  `showParameters`) toggles the same attached labels, keeping placement and
  style; never imitate them with free text. Parameter keys are lowercase
  (transformer `k/lp/ls`, T-Coil `k/l1/l2/cb`, Center-Tap Inductor `k/l1/l2`);
  omitted keys stay, an unsupported key rejects the action, and `showValue`
  never controls them. `showParameters:{m:true}` shows a MOS or BJT "×8" bound
  to `m`; for a MOS only while its W/L (which prints ×m) is hidden.
- A placed Cell shows its Cell name and hides `X1`; `set-instance-display`
  `showReference:true` shows `X1` above it (to tell which block is `x1` in
  `v(xdut.x1.net0)`).
- Several `place-cell` actions share one call and Undo; each may omit
  `instanceId`, `rotation` and `mirror` (the helper makes the ID and turns the
  Cell upright) and creates its owned Port, Net and terminal-name display.
  Place a tray Instance with `place-existing` (`instanceId`, `placement`) or
  `move` it from the tray.
- `pinAnchor:{pinName,position}` replaces the origin on `place-component`
  (native `pinAnchors` by Instance ID), `place-cell`, `place-existing` (then
  `placement` may be omitted) and `move` (keeping rotation/mirror). It uses the
  routing landing, not artwork contact; an unreachable target is refused with
  the nearest reachable landing.
- `mirrorOf:{instance, x}` (or `y`) places the exact mirror image of a placed
  part about that line (origin reflected, mirror toggled, rotation kept, Ports
  and names included; off-grid images are refused). `mirror` with `axis`
  reflects a part in place (`y` left-right, `x` top-bottom); `set-orientation`
  sets absolute rotation and mirror. No mirror copies connectivity or adds a
  symmetry constraint.
- A Port's lead leaves its circle eastward. Place a right-edge output with
  `mirror:"horizontal"`, or the wire hooks round the circle
  (`VISUAL_TERMINAL_DEPARTURE`).
- A person may be watching: after each placement batch, after wiring or moves
  that reach new ground, and when done, fit the view with `circuit_view`
  `{kind:"focus",intent:{kind:"fit-document"}}` (the F key). It may end an
  `apply_actions` list without splitting it and changes only the view (no
  revision or undo entry; selection and dialogs kept).

## Values and models

- Set values before showing them. Values are strings; MOS sizes are quantities
  (`w:"10u", l:"1u"`, not `10/1`). `place-component` and `set-property` refuse
  an unknown parameter (naming the likely one), a value outside a choice list,
  and a quantity that is not a SPICE number (`1k`, `9kΩ`), a braced expression
  (`{vdd/2}`) or an accepted word (`vhigh:"VDD"`). Write micro `u` and mega
  `Meg`: `1MΩ` (milli to SPICE) is refused naming both readings; stored values
  get the same checks and the `MILLI_SCALE_VALUE` netlist warning.
- `set-model` (with `target`; native `instanceId` still accepted) uses the
  GUI's Process-aware planner; an empty model clears the binding. Reviewed
  targets use the full library name (`sky130_fd_pr__nfet_01v8`; the Netlist
  panel's `nfet_01v8` is the same device in a SKY130 Project), keep terminal
  mapping and export the `X` call. Any other name is a raw binding for custom
  definitions and leaves the Process Custom.
- A Library logic gate (`inverter`, `buffer`, `nand-gate`, … `xnor-gate-4`)
  keeps its symbol, pins and VDD/VSS Nets (Auto as unbound) when `set-model`
  binds it to:
  - a standard cell of its function and input count: SKY130 HD
    (`sky130_fd_sc_hd__nand2_1`), IHP SG13G2 (`sg13g2_nand2_1`) or TSMC 28 HPC+
    12-track (`ND2D1BWP12T30P140`, `…LVT`), any drive or variant, called in
    library pin order and defined by the library's `.include`. Hosted ngspice
    simulates SKY130 HD; a Profile without the library refuses
    (`STANDARD_CELL_LIBRARY_UNAVAILABLE`); another pin order or no matching
    gate is `STANDARD_CELL_UNSUPPORTED`; another function is refused with the
    cells that fit. A SPICE-imported cell stays an external block.
  - a Project Cell drawn at transistor level (name, any case, or ID) whose
    Pins are the gate's (`A`, `B`, `Y`) plus `VDD`/`VSS` unless its supplies
    are global; others are refused by name. The call goes to its subcircuit by
    Pin name, its parameters win, a VDD/VSS Net it lacks a Pin for is cleared,
    the gate's own Cell is refused, and used Pins cannot be renamed or removed.

  An empty model returns the ideal body and default parameters.
- A D flip-flop (`d-flip-flop`, `d-flip-flop-q`, `d-flip-flop-reset`) binds to
  a Project Cell the same way, keeping its symbol: the Cell's Pins are `D`,
  `CK`, `Q`, `QBAR` where the symbol has it and `RST` for the reset form, plus
  `VDD`/`VSS` unless its supplies are global. It takes no standard cell; an
  empty model returns its ideal body.
- A fully differential amplifier is `opamp-differential-crossed` (compact) or
  `opamp-differential-wide-crossed` by default: each row pairs + with − (IN−
  with OUT+ above, IN+ with OUT− below), so feedback from an output to the
  input on its row runs straight. `opamp-differential` / `-wide` put OUT+ in
  line with IN+; use them where that keeps wires from crossing. A placed one
  switches with `set_instance_symbol` (same pin names, Nets kept).
- AND/NAND/OR/NOR/XOR/XNOR have 2–4 inputs: place `nor-gate-3`, `xor-gate-4`,
  or `set-property {target, set:{inputs:"3"}}` (symbol and default target
  change; shared inputs keep wires). Removing a wired input is refused, as is a
  gate bound to a cell or Cell until its model is cleared.
- Generic models, reported as netlist information: diodes in Abstract, SKY130,
  IHP SG13G2 or Custom bind `DIODE`, one `.model DIODE D(IS=1e-14 N=1)` per Cell
  (`GENERIC_DIODE_MODEL`); BJTs in Abstract or Custom, or `set-model`
  `NPN`/`PNP`, get `.model NPN NPN(IS=1e-16 BF=100 VAF=100)` /
  `.model PNP PNP(IS=1e-16 BF=50 VAF=50)` (`GENERIC_BJT_MODEL`); generic
  `NMOS`/`PMOS` and the switch's `SW` get none (`GENERIC_MODEL_UNDEFINED`). A
  same-name `.model` in a simulation folder's files replaces or supplies it for
  that folder. For a real device, `set-model` it.
- Adder: `signA`/`signB` `"-"` (default `"+"`; `−` stored as `-`) subtracts that
  input, drawn ±, netlisted `adder_minus_b` (`_a`, `_ab`). V_hold − V_DAC is one
  adder with `signB:"-"`, never an undrawn −1 gain block.
- `set-block-supply` binds a block's VDD/VSS Net (`net:null` is Auto; fixes
  `MISSING_BLOCK_SUPPLY`). No limit below takes braces.
- Comparator: V(OUT) = `vlow` + (high − `vlow`)·½(1 + tanh(V(IN+,IN−)/`vtransition`)),
  `vhigh` `"VDD"` (default: its bound VDD, else the one drawn positive supply,
  else a default VDD Cell Pin) or volts, `vlow` (`"0"`), `vtransition` (`"1m"`).
  Keep `"VDD"` when driving logic: a fixed `"1"` never switches it at VDD ≥ 2 V.
- Op-amp: `gain`·V(IN+,IN−) (`"1e6"`) clipped at `vlow`/`vhigh`, volts or
  `"VSS"`/`"VDD"` (defaults) read from its own supply once a VDD powers it, else
  ±5 V; several candidates warn `IDEAL_OPAMP_SUPPLY_AMBIGUOUS` (bind VDD or
  VSS). Set a figure's stated swing (`vhigh:"12"`, `vlow:"-12"`) so oscillators
  and Schmitt triggers saturate as drawn. The fully differential op-amp is
  unlimited.
- Formula blocks (catalog `formula: true`: integrator, unit delay,
  discrete-time integrator, transconductance) take
  `signalFlow:{formula?, coefficient?, bodyWidth?, bodyHeight?}`;
  `set-signal-flow` changes them (`null` clears; a new formula drops the old
  look). Compact text, not TeX: `^`/`_` raise/lower the next term, `()` or `{}`
  group (`g_(m1)`, `z^-1`), one top-level `/` is a fraction. It is drawing text;
  `set-property` on such a part names `set-signal-flow`.
- `tcoil` is a bridged T-coil (k plus bridge capacitor CB). A plain
  centre-tapped inductor (an LC tank fed at its tap) is `center-tap-inductor`:
  two series halves meeting at pin 3, uncoupled unless k is given.

### Controlled sources

`vcvs`, `vccs`, `cccs`, `ccvs` take `control` on `place-component`;
`set-source-control` (Instance `target`, `null` clears) changes it, keeping
parameters and binding (the drawn formula is only an Annotation):
VCVS/VCCS `{kind:"voltage",positiveNetId,negativeNetId}` with stable Net IDs;
CCCS/CCVS `{kind:"terminal-current",instanceId,pinName,direction:"into"}`
(current entering that pin; `out` reverses; export reuses a voltage-source
sensor or inserts a zero-volt probe); or `{kind:"current",sensorInstanceId}`.
Snapshots return `instance.netlist.control`; an incomplete one is not
simulation-ready. A voltage control follows merged Nets; a deleted sensed Net
is `INVALID_CONTROL_NET`. Parameters are `gain`, `gm` (S), `rm` (ohms). Raw
HTTP uses `instances[].netlist.control` or `set_instance_netlist`, which
replaces all netlist facts.

### Switch clock phases

An Open or Closed switch (`ideal-switch`, `closed-switch`) is clocked by the
phase its name label shows (a new `S1` by `S1`). Share a clock with
`set-display-alias {target, text:"Φ_1"}` on each switch (netlist
`S1 a b PHI1 VSS ideal_switch`), driven by a Net named `Φ1` or a Cell Pin
`Φ1`; an undriven phase becomes a Cell input (`.subckt … PHI1`) passed up
through callers. `text:"EN_bar"` (drawn E̅N̅) is its own signal: draw the
inverter if the circuit makes it, else the testbench drives both. Free text
clocks nothing. `externally-controlled-switch` uses its CTRL pin.

### Coupled inductors

`circuit_selection` `couple-inductors` couples two inductors of one Cell:
`{kind:"couple-inductors",inductors:[{kind:"instance",reference:"L1"},{kind:"instance",reference:"L2"}],k:"0.9"}`.
A new pair gets the next `TFn`, `k:"1"`, dots where other couplings put them
(else the first pin) and the arrow; `name`, `k` (SPICE text, -1 to 1), `dots`
(per inductor, `null` keeps) and `arrow` override, and a coupled pair changes
only given fields. Netlist `KTF1 L1 L2 0.9` (Spectre `mutual_inductor`), cards
starting at the dotted pin. Snapshot `document.inductorCouplings` lists `id`,
`name`, `members` (`instanceId`, `reference`, `dotPin`), `k`, `arrow:false`
when hidden. Uncouple with `apply_actions` `delete`
`target:{kind:"inductor-coupling",name:"TF1"}`; deleting an inductor removes
its couplings. SPICE `K` cards import as couplings.

## MOS bodies

Three-terminal MOS artwork still has an electrical B pin; read `mosBulk` and
`mosBulkDefaults`. An unresolved body takes the conventional VDD or ground; a
Cell that draws none gains it as a Cell Pin (`MOS_BODY_DEFAULT_SUPPLY`,
information). Hidden bulk needs no decorative wire.

- One device: `connect` its B pin (dashed, as the GUI's Draw bulk connection)
  with an explicit `via`, never automatic routing. B lands inside the channel
  and leaves along `outward` (both in selected pins). For an upright part with
  B at (X,Y), `via:[{x:X+20,y:Y}]` with `to:{kind:"net",net:"VB"}` meets VB at
  its nearest point; add corners if refused, or target a `wire-at` point or
  Junction. Body to own source:
  `{kind:"connect",from:{kind:"pin",instance:"MP",pin:"B"},to:{kind:"pin",instance:"MP",pin:"S"},via:[{x:X+20,y:Y},{x:X+20,y:SY}]}`
  (SY the source landing's y).
- Cell default: `{kind:"set-mos-bulk-default",mos:"pmos"|"nmos",net:"VB"}`
  (`circuit_place`; Net name or ID; `null` clears), as Cell Properties: bodies
  on the old default move, wired bodies stay (raw `set_mos_bulk_defaults` /
  `reconcile_mos_bulk` leave them). The NMOS default also places PDK substrate
  pins ([PDK models and symbols](../knowledge/pdk-and-symbols.md)).
- `MOS_BODY_OTHER_SUPPLY` (information) names a body on another supply than its
  source's (following the default, or unwired with none). MCP `verify` lists
  both body findings in `information`.

## Cell Pins and supplies

- `port`/`port-filled`/`vdd-port` placement also creates the Cell terminal and
  Net. `reference` names a Port (required); `vdd-port` defaults to `VDD`;
  `ground` takes none. Optional `direction` (default passive) applies to these
  markers only (native `terminalDirections` keys must be new markers). The
  first explicit supply in a batch initializes an absent bulk default. A
  `vdd-port`'s name stands beside its bar; `arrange-labels` `side:"top"`
  centres it (house style).
- `set-port-direction` sets one terminal or a whole Port; `set-vdd-mode`
  switches VDD between Cell Pin and Global. Remove a Pin with
  `remove-cell-terminal` or selection deletion, never by disconnecting `P`.
- `add-power-rail` draws a `vdd-rail` (a primitive, not a symbol) with optional
  `name`/`scope` (existing scope kept, else local; `global` only explicitly).
  It initializes the PMOS bulk default; geometry alone joins no pin. Markers
  are not named devices. A rail along a same-supply rail, overlapping or
  touching, extends it. `extend-power-rail {routeId,start,end}` moves a
  straight rail's ends along its line: taps and the other end stay, the label
  follows its end, no pin is joined; dropping a tap or moving a tapped end is
  refused with the tap's ID.
- `set-cell-symbol-pins` (`circuit_transform`, the Cell's `documentId`)
  arranges a block's Pins by name:
  `{kind:"set-cell-symbol-pins",pins:[{name:"bl",side:"east"},{name:"blb",side:"west",offset:0}]}`.
  Sides `north|east|south|west`; `offset` from the side's middle in multiples
  of 10. Unnamed Pins stay (on an unplaced Cell, where the first placement puts
  them); a named Pin without `offset` stays on an unchanged side, else takes
  the first free slot (0, -20, 20, …). Unknown names and shared slots are
  refused with the names or free slots. Callers keep their Nets; stretched
  wiring is redrawn and labels it crosses move clear;
  `projectStructure.changedDocumentIds` and `changedObjectIds` name what moved.
- Other interface/symbol edits use `structureEdits` with a nested
  `transact_document` (not top-level `edits`), e.g. `set_cell_symbol_presentation`
  with all `pinPlacements` by terminal ID. HTTP callers use their published
  transact schema; its `actions` form takes `apply_actions`' actions.

## Wiring

Wires are drawn as a person draws them: never over another Net's pin, through
a part (its own included) or along its leads, or onto another Net's wire; a
Junction on another Net's wire is refused. A first or last leg that would run
along its own Net's wire ends on it with a dot (a body tied to its source taps
the source wire). Plain crossings stay legal.

`route-net` (`apply_actions`, native `command`) fills missing visible
connections for a current Net ID/name, one member pin, a pin list, or a frozen
import `sourceNetId` (not a current Net ID), skipping connected components.
`trunk:{start,end}` gives one straight trunk; otherwise it draws a trunk
between two aligned pins with nothing between, then joins each component
where cheapest (a joined pin, Junction, or straight onto a wire) in T
junctions, each wire the cheapest clear path (L, short lead, or detour along a
free row/column). When none is clear the whole operation is refused naming the
obstacle and the two points between which it meets it: move parts or give a
trunk. A given trunk is checked the same way, never bent. It is not an
autorouter: it moves no device, infers no bulk wiring, and does not override
import-reference shorts/scope conflicts. Several `route-net` actions share a
batch, each planned on the previous result. Contract:
`describe_tool({tool:"apply_actions",operations:["route-net"]})`.

Where a Net cannot cross the drawing (a cascode bias to both halves), name it
at each end: `connect` the pin to an open `{kind:"point"}` a grid step or two
out, then `add-label` with the Net's name and target
`{kind:"pin",instance:"M4",pin:"G"}`; same-name Nets in a Cell are one Net. A
label not clear on the stub stands at its open end or slides along a longer
run to the nearest clear spot; else it stays and `VISUAL_LABEL_CLEARANCE` says
so.

A pin unused on purpose (QBAR) needs No Connect or the netlist blocks with
`MISSING_PIN_NET`:
`{kind:"disconnect",target:{kind:"pin",instance:"X1",pin:"QBAR"},noConnect:true}`
(disconnect a wired pin first; exports as `NC0001`, information;
`noConnect:false` removes it).

## Batches and limits

Placements, wires, labels, models and annotation moves batch atomically:
failure commits nothing, success is one undo. A transaction takes at most 64
expanded edits (a part about two, three with `showValue:true`; a Cell Pin about
five). A `circuit_place` batch (up to 64 parts) over the limit is placed in
successive transactions with one receipt and one undo; a refusal leaves none.
A dry run checks one transaction, so over the limit it fails `LIMIT_EXCEEDED`
(as native `place-components` does) with `expandedEdits`, `maxTransactionEdits`
and `fittingPlacements`. An over-limit `delete-selection` adds per-class
`selected…` counts and the fitting leading part (`fittingInstances`, …):
delete it, refresh, delete the rest. Other commands name themselves and their
`expandedEdits`.

Display flags, Port directions, VDD mode, terminal removal and power rails
share a command batch (a VDD and a VSS rail: one call). Pure presentation
batches keep the structure revision. A list needing several transactions
commits nothing: `ACTION_BATCH_NOT_ATOMIC`'s `calls` gives action indexes per
call, in order (placements apart from their wires; a `focus` with the last).

## Move, delete and reset

Clean up with move/mirror/group transforms and route edits. Geometry moves do
not perform GUI drag-to-connect snapping; a moved part joins only a pin it
lands on. An unturned, unmirrored `move` carries grounds, supply markers
and Cell Pins standing unwired on the part's pins (`MARKERS_MOVED_ALONG`);
wired, shared or locked ones stay, joined by a wire. A selection `transform`
mirror without a center reflects the whole selection about its own axis as the
editor's Mirror does, connections unchanged (a wire held by an unselected part
stays); with an explicit center, labels and drafting are rejected. Translation
keeps text offsets and formatting; attached drafting follows its owner. Locked
targets reject the request. Receipt `terminalConnectivityChanged` compares
document-local terminal equivalence only (omitted means unknown).

`delete` uses the GUI deletion planner, including owned displays and interface
declarations. `delete-selection` nests explicit IDs by type, omitted lists
empty: `{"kind":"delete-selection","selection":{"instanceIds":["M1"],"routeIds":["route-3"]}}`
(`instanceIds`, `routeIds`, `junctionIds`, `annotationIds`, `draftingIds`,
`noConnectIds`; `annotate` text is drafting). Unknown or misclassified IDs
reject it all. Deleting a part deletes wires that only tapped it; a wire
running on to another pin, or carrying a label, stays open there so a
replacement reconnects (`ERC_DANGLING_WIRE` names open ends).

`reset-placement` (intentional redraw) and `clear-drawing` remove every wire:
labels on wires stay free with their names, markers on wires go, a rail's
label stays; the receipt lists moved labels. `reset-cell` `reset-body` removes
all but the formal interface (Pins, markers, a local rail's label). A rail
redrawn for a kept label takes it and its Pin over; a VDD Pin marker placed
instead takes the Net and the kept label, Pin and Junction go. A reset never
means deleting the Cell.

## Labels and text

- Name Nets with `add-label` / Net Label `edit-text` (native `set-net-label`),
  which create the name claim and bound text together (free text does not).
  Give `position` for a new label; its target is a Net or a pin (that pin's
  Net, on its wire). Plain text is a name drawn in its standard look (`VB1` as
  V over B1); RichText (runs use `value`) sets its own look. Deleting a label
  removes its claim, not wires. Name nodes that scripts reference.
- `annotate` is for independent notes, with GUI Text defaults. `annotate` and
  `edit-text` take plain text (keeps existing spans) or RichText (replaces
  formatting; needed for fractions/formulas). `edit-text` is the GUI text commit:
  on a bound label new text renames the part or Net or sets the value, the same
  characters in RichText only restyle, and a Cell Pin label is refused.
- `arrange-labels {instanceIds}` compacts default label slots and moves crowded
  labels to nearby clear spots in one undo, so no label reads as another
  part's. `side` (`left|right|top|bottom`) tries that side first; `"outside"`
  faces labels away from the centre line so differential halves mirror.
  `place-component` arranges labels that would land crowded. Where parts sit
  too close the value is left touching a wire: hide values or move parts. A
  requested Port name now covered moves to its first clear side.
  `compact:false` / `avoidCollisions:false` disable either part;
  `referenceStyle:"first-letter-subscript"` draws `RBIAS` as R_BIAS (and an
  unstyled Port name in its placed look, `vrfp` as V_rfp) without renaming.
  Manual, locked, hidden and restyled labels stay and are named
  (`LABELS_LEFT_IN_PLACE`); `includeManual:true` re-places hand-moved ones.
  Clearance observations never gate editing.
- `{kind:"apply-label-preset",preset:"textbook"}` (`circuit_text`) for the Cell
  or `targets` (`[{kind:"instance",reference:"M1"}]` or `id`; native
  `instanceIds`), one undo: hides every MOS W/L, shows ×m where `m` ≠ 1, leaves
  other values as they are, then arranges with `first-letter-subscript` (R_L,
  I_SS, M_1), counting the W/L space as free. Labels arrange-labels leaves alone
  keep place and look. Over the limit nothing changes (`LIMIT_EXCEEDED`,
  `fittingParts`).
- A full or `pins` Snapshot with `instanceLabels:true` (MCP object `inspect`)
  lists each instance's `annotations` (ids, text, `position`).
  `move-annotation` sets that position, `alignment` (`start|middle|end`)
  choosing which end stands there; geometry `inspect` `textBounds:true` reads a
  label's box. Legacy `move` has the same semantics without `alignment`;
  `transform` translates; both keep ownership and binding. A Net label moved
  within 20 units of its own wire segment stays attached; further away it is
  free but still names its Net. Rotation/anchor changes need annotation edits.

## External model sources

`advanced_transact` `structureEdits` `apply_model_source` defines a
Project-owned SPICE or Spectre source (files, entry, pinned dependencies) and
`definitions:[{definitionId,entry,portMap?}]`; optional
`transform:{language:"spectre",process:"sg13g2"}` runs the GUI's
Format/Process converter first. The native header derives target, port order
and defaults (zero ports valid); bound definitions update atomically.
`portMap` maps connected removed/renamed ports to new names, or `null` to
disconnect keeping wires; reorder keeps identity.

For a User Component each definition target takes a transient `authoring`:
`{symbolMode:"automatic"}` or
`{symbolMode:"custom",artworkText:"<ComponentDefinition JSON>"}` (required to
create Custom; omitted on edit keeps the capture), optional `terminalDirections`
by formal port name (input/output/inout/passive), and an optional complete
`pinMap` from formal names to `{pinName}` or `{supply:"VSS"|"VDD"}` (identical
names map automatically when artwork has no binding). Never combine it with
compiled `symbol` or ID-keyed directions on one target; the edit schema covers
`artworkOrigin` and caller migrations. Validate with `dryRun:true`, then commit
at the same revisions.

Only reviewed core SKY130 1.8 V and IHP SG13G2 low-voltage MOS conversions
exist; others refuse without partial change; converted spans cannot be reverse
edited. Only the SPICE projection runs (on qualified ngspice), whatever the
source language. Invalid raw text belongs in `save_model_source_draft`;
export, clipboard and simulation use the applied revision and owned helpers.
Raw upsert may add an imported owner, never replace an applied one; fork by
applying a new owner and definition ID with nonconflicting names. Never
duplicate a Project model in an experiment. Apply neither runs SPICE nor
certifies behaviour. `user_components` `browse`/`read` discover public
components; publishing is a separate guarded operation.
