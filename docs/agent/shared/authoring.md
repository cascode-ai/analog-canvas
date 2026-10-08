# Circuit authoring

## External model sources

Use `advanced_transact.structureEdits` with `apply_model_source` to define a
Project-owned SPICE or Spectre source, files, entry and pinned dependencies.
Optional `transform: {language: "spectre", process: "sg13g2"}` uses the same
bounded converter as the GUI Format/Process row before the ordinary atomic
Apply. Read the canonical edit schema with `describe_tool` when needed. Ports
and formal defaults derive from the applied declaration; zero ports are valid.
No second implementation or independent process label is stored.

Only reviewed core SKY130 1.8 V / IHP SG13G2 low-voltage MOS replacements are
currently mapped. Unknown variants, parameters or library identities refuse
without partial changes. Repair the native source and real dependencies.
`save_model_source_draft` may retain its own language without replacing applied
bytes. Export, clipboard and simulation use the applied revision and full owned
helper closure. Converted spans identify the owner but cannot be reverse edited;
edit the native model instead. Another native language does not select a new
simulator: only the supported SPICE projection runs on qualified ngspice.

## Facts needed to draw

The built-in catalog owns asset IDs, canonical pins and variants. Live Snapshot
projections own existing IDs, placement, Net membership, revision and bulk.
Use live resolved facts for imported/custom/PDK assets; ask the human only when
a needed fact is unavailable. Never infer electrical connectivity from artwork.

Normal path: **place → read selected pins → wire → review the render → fit the view**.
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
- A placed device shows its name alone, as a GUI insert does, whatever
  `parameters` give: a MOS's W/L, a resistance or a source's level stays
  hidden. `showValue:true` on `place-component` shows the value from the
  start, the given one or else the catalog default; `showReference:false`
  hides the name (native `displays`, keyed by new Instance ID). Cell markers
  and ground take neither. Nothing appears only to be hidden a call later.
- A person may be watching the canvas. After each placement batch, after
  wiring or moves that reach new ground, and when a drawing is done, fit the
  view to it: `circuit_view` action `{kind:"focus",intent:{kind:"fit-document"}}`
  (in `apply_actions`, a call of its own), the GUI's F key. For the Cell on
  show it changes only the view: no revision, no undo entry, and the person's
  selection or open dialog stays.
- Parts are named as the GUI names them. A device's `reference` starts with
  its prefix (R, C, M, …), and a `place-cell` instance's with X. Leave it out,
  on `place-component` or `place-cell`, and the next free name is taken (`R1`,
  `X1`, `X2`, …). A name with another prefix, or one already in use, is
  rejected with a free name, because it would block the netlist; nothing is
  placed. To draw another name, as textbooks label an op-amp A1, place it under
  its own name and use `set-display-alias`.
- A placed Cell shows its Cell name; its instance name (`X1`, `X2`, …), which
  the netlist calls it by, is hidden. To show it, for instance to tell which
  block is `x1` when probing `v(xdut.x1.net0)`, use `set-instance-display`
  with `instanceIds` and `showReference:true`: `X1` reads first with the
  Cell name a row under it, as the Properties Visual annotation switch does
  (above a turned block the Cell name keeps the row nearest the block and
  `X1` stands over it). `showReference:false` hides it again.
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
  A MOS or BJT shows its multiplier with `showParameters:{m:true}`: "×8"
  with its name, bound to `m`, as bandgap and mirror figures print it. A
  MOS's shown W/L already prints its ×m, so the label appears only while
  the W/L is hidden, a text row under the name (above the part, in the
  W/L's place); `arrange-labels` keeps it there, shown or hidden, when it
  moves the name.
- Use `set-model` with the product's reviewed target, the full library name
  such as `sky130_fd_pr__nfet_01v8`. In a SKY130 Project the short name the
  Netlist panel shows (`nfet_01v8`) means the same device. SKY130 MOS targets
  reuse the GUI binding path, preserve terminal mapping and export the
  required `X` subcircuit invocation. Any other name is a raw model binding,
  for custom definitions; it leaves the Project's Process as Custom.
- A Library logic gate (`inverter`, `buffer`, `nand-gate`, … `xnor-gate-4`)
  takes a standard cell of its function and input count through `set-model`:
  SKY130 HD (`sky130_fd_sc_hd__nand2_1`), IHP SG13G2 (`sg13g2_nand2_1`) or
  TSMC 28 HPC+ 12-track (`ND2D1BWP12T30P140`, `…LVT`), at any drive strength
  or variant of the library, clock and delay buffers and inverters included.
  The gate keeps its symbol and pins; the SPICE netlist calls the cell in the
  library's pin order with the gate's VDD/VSS Nets on its rails (Auto
  resolves as for an unbound gate), and the library's own `.include` defines
  it: a hosted run refuses the cell (`MODEL_IMPLEMENTATION_MISSING`) unless
  the folder's files define it. A name of another function is refused with
  the cells that fit; an empty model returns the gate to its ideal body with
  its default parameters. A cell imported from a SPICE file stays an external
  block with its own rail pins.
- The AND, NAND, OR, NOR, XOR and XNOR gates come with 2, 3 or 4 inputs.
  `place-component` places the 3- and 4-input forms by their own IDs
  (`nor-gate-3`, `xor-gate-4`), and `set-property {target, set:{inputs:"3"}}`
  switches a placed gate between 2, 3 and 4 inputs, as the Properties Inputs
  choice does: the symbol and its default netlist target change together and
  the shared inputs keep their wires. An input that would go is refused while
  it is wired (disconnect it first), and a gate bound to a standard cell is
  refused until its model is cleared.
- `place-component` without `parameters` places a part as the GUI library
  does: each parameter's catalog default, and for a transistor the model of
  the Process the Netlist panel shows. A BJT in a SKY130 Project arrives as
  the reviewed SKY130 wrapper, keeping its `m`. Given `parameters` win; a
  Value label shows only with `showValue:true`.
- A diode placed in Abstract, SKY130, IHP SG13G2 or Custom is bound to the
  generic model `DIODE`. The SPICE netlist defines it with one
  `.model DIODE D(IS=1e-14 N=1)` card in each Cell that uses it and says so as
  information, `GENERIC_DIODE_MODEL`, naming the diodes. A `.model DIODE` in
  a simulation folder's own files replaces the card in that folder's runs.
  For a real device, `set-model` the diode to its own model.
- A BJT placed in Abstract or Custom, or `set-model` to `NPN` or `PNP`, takes
  the generic `NPN` or `PNP` in the same way: one
  `.model NPN NPN(IS=1e-16 BF=100 VAF=100)` or
  `.model PNP PNP(IS=1e-16 BF=50 VAF=50)` card per Cell, reported as
  information, `GENERIC_BJT_MODEL`, and replaced by a `.model NPN` or
  `.model PNP` in a folder's own files. For a real device, `set-model` the
  transistor to its own model.
- A MOS bound to the generic `NMOS` or `PMOS` (Abstract, Custom), and a
  voltage-controlled switch bound to the generic `SW`, get no card. The
  SPICE netlist reports them as information, `GENERIC_MODEL_UNDEFINED`,
  until a `.model NMOS …`, `.model PMOS …` or `.model SW SW(…)` in the
  simulation folder's files defines it; or `set-model` the part to a real
  model.
- `place-component` and `set-property` refuse a parameter the part does not
  take (naming the one it most likely meant), a value outside a choice list,
  and a quantity that is neither a SPICE number (`1k`, `2.5n`, `9kΩ`) nor an
  expression in braces (`{vdd/2}`), nor a word it takes, such as a
  comparator's `vhigh:"VDD"`. Write micro as `u`, and mega as `Meg`: SPICE
  reads `M` as milli in either case, so an upper-case `M` before a unit
  (`1MΩ`, `10MHz`) is refused, naming both readings (`1MegΩ`, `1mΩ`). The
  same checks run on stored values, as Cell diagnostics, and the netlist
  warns of such a value as `MILLI_SCALE_VALUE`.
- An adder input subtracts by its sign, a choice: `signA`/`signB` `"-"`
  (default `"+"`), so V_hold − V_DAC is one adder with `signB:"-"`, drawn
  with its + and − marks, not an adder after a −1 gain block.
- A comparator is the ideal comparator, V(OUT) = `vlow` + (high − `vlow`) ·
  ½(1 + tanh(V(IN+, IN−)/`vtransition`)) from ground. `vhigh` is `"VDD"` (the
  default, any case), the comparator's own VDD resolved as a logic block's
  (bound with `set-block-supply`, else the one drawn positive supply, else a
  default VDD Cell Pin), or a number in volts; `vlow` is a number (default
  `"0"`); `vtransition` is the positive tanh width (default `"1m"`). None
  takes an expression in braces. Keep `vhigh:"VDD"` when the output drives
  a gate or flip-flop, which reads a high above half its supply: a fixed
  `vhigh:"1"`, what comparators placed before `VDD` existed store, never
  switches logic at VDD ≥ 2 V. A number exports the numeric body with all
  three parameters; `VDD` calls the body that reads VDD, and the call carries
  no `vhigh`.
- An op-amp's output is `gain`·V(IN+, IN−) from ground (default `"1e6"`),
  exact between its limits `vlow` and `vhigh`. Each limit is a number in
  volts or its supply, `"VSS"` and `"VDD"` (the defaults, any case), and
  neither takes braces. A supply limit reads the op-amp's own supply once a
  VDD powers it (bound with `set-block-supply`, else the Cell's one drawn
  positive supply); with none, it reads +5 V or −5 V and no supply is added.
  With several drawn, `IDEAL_OPAMP_SUPPLY_AMBIGUOUS` warns: bind its VDD, or
  its VSS where several grounds or negative supplies compete.
  So an astable, Wien-bridge or phase-shift oscillator or a Schmitt trigger
  drawn with an op-amp saturates as drawn: set the limits to the swing the
  figure means (`vhigh:"12"`, `vlow:"-12"`) when it states one. The fully
  differential op-amp is not limited.
- Three-terminal MOS artwork still has an electrical B pin. Read `mosBulk` and
  `mosBulkDefaults`; ordinary devices reuse defaults. A body on no Net
  (`mosBulk.status: "unresolved"`) takes the conventional VDD or ground; a
  Cell that draws no such supply gains it as a Cell Pin, and the netlist says
  so as information, `MOS_BODY_DEFAULT_SUPPLY`, naming the parts. To give one
  device another body, `connect` its B pin to that Net, as the GUI's Draw
  action does: the body leaves the Cell default for a dashed body wire. A
  body tied to its own source is one call,
  `{kind:"connect",from:{kind:"pin",instance:"MP",pin:"B"},to:{kind:"pin",instance:"MP",pin:"S"}}`,
  or a `wire-at` tap on the source wire. A default for the whole Cell is an
  `advanced_transact` of two edits, as the GUI sends them:
  `{kind:"set_mos_bulk_defaults",pmosNetId:"<Net ID>"}` (`nmosNetId` for
  NMOS), then `{kind:"reconcile_mos_bulk"}`. In a Cell with two supplies,
  check the PMOS on the one that is not the default: `MOS_BODY_OTHER_SUPPLY`
  (information) names a body that follows the default onto another supply
  than its source's. With no default set, such a Cell's unwired bodies are
  unresolved and take the conventional VDD or ground; the same finding names
  one whose source is on another supply. MCP `verify` lists both findings by
  name in `information`, beside its counts. Hidden bulk needs no decorative
  wire; four-pin presentation is a separate visual choice.
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
A voltage control follows its Nets when they merge, as when a wire is redrawn
and the Net takes another ID. A sensed Net that is deleted outright is reported
as `INVALID_CONTROL_NET`, naming the source and its side (+ or −); select that
source's control Nets again.
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
pulse source) or a Cell Pin `Φ1`. A phase nothing in the Cell drives becomes
the Cell's input pin in its netlist (`.subckt … PHI1`), passed up through any
Cell that calls it, so the testbench drives it. For a complementary phase write
`text:"EN_bar"` (drawn E̅N̅): it is its own signal `EN_bar` on the same plain
switch, never an inverted one. Draw the inverter if the circuit makes
`EN_bar` from `EN` (or the reverse); otherwise the testbench drives both.
Free text beside a switch is drawing only and clocks nothing. A Ctrl SW
(`externally-controlled-switch`) takes its control from its CTRL pin instead.

Multiple placements, wires, labels, model assignments and annotation moves have
existing atomic batch paths. Failure commits nothing; success has one undo.
One transaction takes at most 64 expanded edits. A placed part expands to about
two (the part and its name label; three with `showValue:true`) and a Cell Pin to
about five, so one `circuit_place` call fits about 20 to 30 parts. A placement batch over the limit
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
label on that stub; Nets of one name in a Cell are one Net. A name that is not
clear halfway along the stub stands at its open end, reading outward from a
horizontal stub and beside a vertical one. A label on a longer wire that is not
clear where the pin target puts it, such as where another Net's wire crosses,
slides along that straight run of the wire to the nearest clear spot. Where
nothing is clear, the
label stays and `VISUAL_LABEL_CLEARANCE` says so, so move the parts apart. A
wire whose last leg into a pin, or first leg out of one, would run along a
wire of its own Net there ends where it meets that wire, with a dot: to tie a
MOS body to its source, connect B to S, and where the output already leaves
the source the body wire taps it instead of running along it. A trunk and its branches
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
To redraw a Cell in one call, `reset-cell` with `reset-body` removes every
part, wire, rail, Junction and label except the Cell's formal interface: its
Pins, their markers and a local rail's supply label stay, so callers keep
their pins. A rail drawn again for a supply whose label was kept, after either
reset, takes that label and its Pin over instead of adding a second label; a
VDD Pin marker placed for it instead takes the supply's Net, and the kept
label, its Pin and their Junction go.
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
a word's space from other labels, a little space from junction dots, and
stay on their part's side of any wire but its own. While another place is
clear, a value does not stand just under or after another part's name, where
it would read as that part's, and no label stands within about a character
(10 units) of another part's label on its row, where the two read as one run.
A two-terminal part drawn along a horizontal wire, such as a ladder's series
inductor, takes the clear side above the wire when its labels below would
stand in a row with those of a part wired to it. Where parts
sit too close for both, the value is the one left touching a wire; hide values
with `set-instance-display` or move the parts apart. A requested Port's name
that a part or wire now covers moves to the first clear one of its sides. Set `compact:false` or `avoidCollisions:false` to disable
either part; `referenceStyle:"first-letter-subscript"` optionally displays
`RBIAS` as an R with BIAS subscript without changing the Reference, and gives
a requested Port's name that has no look of its own the look a Port placed
with that name gets (`vrfp` as V_rfp). Manual/free,
locked, hidden and custom-styled labels are preserved, and the receipt names
each visible one left in place and why (`LABELS_LEFT_IN_PLACE`, information);
`includeManual:true` re-places labels moved by hand too. This is not an autorouter
or a whole-drawing beautifier. Informational label-clearance/owner-distance
observations may remain and never gate editing. New Net labels use the GUI's
standard side/alignment; existing explicit label moves retain their semantics.

To give a drawing a textbook figure's labels in one step, `circuit_text` /
`apply_actions` accepts `{kind:"apply-label-preset",preset:"textbook"}`:

- every MOS transistor hides its W/L, as `set-instance-display` with
  `showValue:false` hides it (three- and four-terminal and DMOS alike);
- resistor, capacitor, inductor and source values stay as they are, and
  nothing else hidden is shown;
- a MOS or BJT whose multiplier `m` is not 1 shows it as ×m with its name,
  bound to `m`, since the W/L that carried it is hidden;
- then the labels are arranged as `arrange-labels` with
  `referenceStyle:"first-letter-subscript"` arranges them, names in their role
  look (R_L, I_SS, M_1, V_in); the space the hidden W/L took counts as free.

It applies to every placed part of the Cell, or to the parts given as
`targets` (`[{kind:"instance",reference:"M1"}]`, or `id`; native
`instanceIds`), in one transaction and one undo. Labels `arrange-labels`
leaves alone, moved by hand or by an earlier pass, locked or restyled, keep
their place and look. Parts placed later show their names alone unless
placed with `showValue:true`. Over the edit
limit, nothing changes and `LIMIT_EXCEEDED` names the leading parts that fit
(`fittingParts`); apply it to those, then to the rest.

The focused `circuit_text` action `move-annotation` sets an absolute position,
and with `alignment` (`start`, `middle` or `end`) which end of the text
stands there, so a label moved to a part's other side needs no width
(geometry `inspect` with `textBounds:true` reads a drawn label's box when it
matters); the legacy `apply_actions` annotation `move` uses the same semantics, without
`alignment`, while
`transform` supports translation. These preserve ownership and electrical
binding. A Net label moved beside its own wire, along a segment and within 20
units of it, stays attached to that wire where it was put and follows it;
moved further it becomes free and still names its Net. New Net labels stand
just above a horizontal wire, as close as their text allows. Use explicit
annotation edits for rotation/anchor changes. Search uses
resolved display text, including bound Net and device labels. `edit-text` on a
bound Pin, Reference, Net, or Value label restyles the same visible characters;
change the owning terminal, name claim, Reference, or parameter to change them.

To arrange the Pins on a Cell's block, address the Cell (the call's
`documentId`) with `set-cell-symbol-pins` (MCP `circuit_transform`), by name:
`{kind:"set-cell-symbol-pins",pins:[{name:"bl",side:"east"},{name:"blb",side:"west",offset:0}]}`.
Pins not named keep their place, a named Pin without `offset` takes the first
free slot on a new side, and callers keep their Nets while the wiring the
change stretches is redrawn; a caller's label the redrawn wiring newly runs
through, such as the Cell's name under its block, moves clear as
`arrange-labels` would place it. An unknown name or a shared slot is refused
with the names or free slots. Other Cell interface/symbol edits use
`structureEdits` with a nested `transact_document`, not top-level `edits`,
such as the low-level `set_cell_symbol_presentation`, which takes the whole
`pinPlacements` list by terminal ID; the per-kind contract supplies that
envelope when needed. HTTP callers use their published transact schema, not an
MCP tool envelope; its `actions` form takes the actions `apply_actions` takes.
Current revision guards and locks always apply.

For simulation, go directly to the selected transport's call guide. The
[shared simulation workflow](simulation.md) is optional detail for unfamiliar
electrical/capture semantics, not another mandatory read.
