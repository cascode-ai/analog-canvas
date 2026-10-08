# Deterministic Netlist Export

Status: `accepted`

Primary owner: `packages/netlist`

Related ADR: [`hierarchy-netlist.md`](../adr/hierarchy-netlist.md)

## Purpose

Define the deterministic boundary that converts persisted schematic electrical
facts into structural SPICE `.spi` and Spectre `.scs` design netlists. Export
is ordinary program logic. It never asks an AI, inspects drawing geometry, or
searches the host for a PDK.

The release exports a reusable circuit structure, not a complete simulation
deck. A design netlist contains cells, ordered interfaces, devices, ordered
nodes, model/subcircuit targets, global Nets, and raw instance parameters. A
simulation deck additionally requires explicitly configured libraries,
corners, stimuli, analyses, options, temperature, and saved outputs; those are
outside this contract.

## Consumers

- `packages/model`: persisted cell and instance electrical facts
- `packages/devices`: reviewed device descriptors (class, prefix, pin order,
  target policy, parameters, dialects, and capabilities)
- `packages/symbols`: artwork, pin anchors, and Symbol variants validated
  against the device registry
- `packages/netlist`: extraction, validation, IR, and dialect printers
- `apps/editor`: authoring, diagnostics, live output, and clipboard copy
- `packages/spice`: structural reparse validation for generated `.spi`

## Terminology

| Term               | Meaning                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Design netlist     | Structural hierarchy and device connectivity, without simulator setup                                       |
| Simulation deck    | Design netlist plus libraries, process selection, stimuli, analyses, and outputs                            |
| Explicit name      | User/import-authored electrical identifier persisted in the Project                                         |
| Generated Net name | Deterministic transient identifier assigned to one unnamed local Net                                        |
| Device definition  | Reviewed mapping from one Symbol to device class, prefix, pin order, target policy, and required parameters |
| Export IR          | Transient dialect-neutral normalized structure consumed by pure printers                                    |

## Authorities

Every emitted token has exactly one authority:

| Fact                       | Authority                                                         | Never inferred from                                    |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| Cell name                  | `Document.netlist.name`                                           | Document title or filename                             |
| Cell interface order       | first occurrence in `projectCellInterface`                        | coordinates or alphabetical order                      |
| Connectivity               | Base-Net membership and the shared Logical-Net/interface resolver | SVG geometry, loose label text, or uncommitted overlap |
| Logical Net name/scope     | resolved owner-addressed marker claims                            | legacy Base fields or text appearance                  |
| Instance reference         | `Instance.reference`                                              | object ID or annotation text                           |
| Device class and pin order | reviewed device definition or child interface                     | `symbolId` string conventions or orientation           |
| Model/subcircuit target    | typed instance binding                                            | symbol name or PDK search                              |
| Parameters                 | typed raw parameter record                                        | rendered text or numeric evaluation                    |
| Dialect syntax             | requested printer                                                 | persisted source lines                                 |

Retired `spice.name`, `spice.target`, `spice.pin.Pn`, and `spice.param.*`
properties are invalid. Export extraction and printers do not read them.

Portable definitions use the same structural interface validation as canonical
component authoring. A malformed definition blocks both strict export and
authoring analysis with `INVALID_COMPONENT_INTERFACE`, including when a caller
bypasses Project loading. Subcircuit ports map every Symbol pin exactly once,
with unique formal names and one pin-or-supply source per port; primitive pin
order covers each pin once. Geometry cannot supply a missing mapping.

When a portable descriptor calls a generated built-in model, its positional
pin/supply mapping must match that model's interface. A structurally valid but
incompatible mapping blocks export with `COMPONENT_MODEL_INTERFACE_MISMATCH`.
Declared custom masters retain their explicitly ordered interfaces and supply
names. Cell hierarchy retains its existing child-interface ownership and
identity-based call projection.

## Persisted data model

The Project model supplies these normalized facts:

The [model schema](../../packages/model/src/schema.ts) owns persisted Cell
interfaces and Instance bindings. Export reads ordered terminal declarations,
raw formal defaults, typed targets and raw Instance parameters; it defines no
parallel persisted shape.

Cell names, references, target names, parameter names, and raw values are
length-bounded. The shared first-release identifier subset is ASCII letters,
digits, and `_`, with the first character restricted to a letter or `_`.
Emitted identifiers are compared case-insensitively for uniqueness; authored
Cell-Pin names may repeat because projection folds them into one Formal Port.
Persistence permits
bounded source identifiers outside the shared subset so an imported Project can
still open; explicit invalid names block export and printers do not silently
rename them.

`terminals` stores independently authored interface declarations. Canvas
`port` is the hollow Cell Pin and `port-filled` is the solid Bias Voltage Port;
each owns exactly one singleton
declaration through `terminals[].interfaceInstanceIds` and neither emits an
instance line. Cell Pins are available in top and child Documents. A hierarchy
instance uses its bound child Document and the read-only formal projection of
that child's declarations. Ports receive no visible Instance Reference. A Cell Pin uses its
`CellTerminal.name`, such as `Vout`, as its Port Name.
Its bound Annotation may retain same-text RichText formatting, which never
changes emitted names. At extraction, names are grouped case-insensitively;
first occurrence fixes order and spelling, and every member Net maps to that
one emitted formal node. This projection does not merge Base Nets or mutate the
Project. Repeated internal Net naming still uses Net Labels. Only an Agent that
explicitly asks the copy/export projection below for a letter case changes the
case of formal names; the editor never does.

Every manually inserted device receives an explicit reference. References are
unique per cell and have the prefix required by their device definition. Model-
backed devices carry an explicit target. Raw parameters remain strings such as
`2u`, `60n`, or `{WBASE*2}` and are never evaluated by export.

Internal Cell formal parameters with raw defaults are emitted in their stored
order. A required-only formal has no portable representation in the released
SPICE/Spectre structural dialects, so preflight blocks it rather than inventing
a default. SPICE import restores `.subckt` parameter defaults into the Cell
interface.

An external-subcircuit binding is a project-local external master declaration,
not a simulator model lookup. Its `definitionId` selects one project-level
external definition, whose ordered terminals select the emitted `X` nodes and
whose `name` is the emitted master token. The instance owns raw overrides. An
`unresolved-subcircuit` binding retains only a master name. For the default
opamp, differential opamp, voltage amplifier, transconductance amplifier, and
differential transconductance amplifier targets, export supplies one idealized
E- or G-source subcircuit definition per used target. An explicitly authored
Cell or project external definition of the same name takes precedence, and
retargeting an instance to another master keeps it external. Other built-in
Analog Blocks remain black-box calls. Artwork cannot change external
invocation into a primitive or model binding.

Reviewed native-device mappings may source those ordered target terminals from
stable local pins with different names. The released SKY130 resistor maps
`R0/R1/B` from native `1/2/B`; B is a real `Net.terminals` membership edited
only in Properties and never a Symbol pin, Route endpoint, or NoConnect. The
reviewed MIM capacitor maps `C0/C1` from the frozen capacitor pins `1/2`.
A reviewed mapping names the pins of one symbol and is offered only on it: the
SKY130 varactor `sky130_fd_pr__cap_var_lvt` also maps `C0/C1` from `1/2` and
its substrate `B` from Properties, so it is a model of the plain capacitor. The
variable capacitor (Var Cap, pins `P1/P2`) stands for any tunable capacitance
— a switched MOM or MIM bank, MOS capacitors, or a varactor — and stays an
ideal capacitor with no reviewed model; a model target on it is refused.

`Instance.reference` is the authored schematic name. Selecting or clearing a
reviewed external target preserves it. SPICE extraction adds the invocation
prefix only in derived IR (`M1/R1/C1` become `XM1/XR1/XC1` for subcircuit
bindings); Spectre uses the authored spelling. Existing legal SPICE names are
reserved first; projected collisions receive `_2`, `_3`, etc. Export and
simulation consume this same IR, including native signal paths. The code editor
maps an ordinary rename back to the authored portion (`XM1` to `XM2`
updates `M1` to `M2`); explicitly authored X-style names remain supported.
Imported X names remain valid and are never rewritten by a process switch. All
authored References remain case-insensitively unique per Cell. Reviewed SKY130 `l/w` values are stored canonically as metre-valued SPICE strings and
projected to plain micrometre numbers by extraction for both SPICE and Spectre
output.
Editable design-netlist geometry maps those printed numbers and expressions
back to canonical Project lengths before committing. Ordinary Netlist also
retains SI-suffixed literal input; generated simulation Circuit keeps its
existing plain-micrometre input policy. Printed parameter keys map back to the
authored key case, and untouched fields keep their original Project spelling.

External-master parameters are deliberately open: declared formal parameters
provide authoring metadata, requiredness, and defaults, while additional raw
instance keys are retained and emitted. This permits a project to carry
library-specific settings such as `l`, `w`, and `nf` without bundling the
library model or PDK.

## Device definition

Each exportable electrical device Symbol has one reviewed `DeviceDescriptor`
in `packages/devices`. Built-in Analog Blocks have a subcircuit descriptor: a
master name and ordered ports, including fixed supply ports. Five amplifier
targets now have built-in, frequency-independent ideal E/G-source masters;
their VDD/VSS ports remain in the interface but do not power or clamp the
model. The default opamp gain is 1e6, voltage-amplifier gain is 1, and
transconductance is 1m siemens; these are raw instance overrides named `gain`
or `gm`, not a foundry model. Outputs may exceed supply rails. The logic
Symbols — gates, buffer, inverter, adder, multiplier and the
D flip-flops — are Blocks on that same contract: the drawing says what the
block is and which nodes it meets. Their ports follow the Symbol's own pins, a
clock or reset counting as an input and a complement as an output, and they
declare the same fixed supplies so every Block writes a card of the same shape.

In SPICE, the gates, buffer, inverter and D flip-flops have built-in ideal
bodies. Each body is printed once, ahead of the Cells, so a drawing with logic
exports complete and simulates in ngspice without anyone drawing transistors.

- An input is high above half its block's supply, V(VDD,VSS)/2. Its level
  comes from a smooth `tanh` step `vt` wide (10 mV).
- An output swings from VSS to VDD through a one-pole delay `td` (10 ps). The
  delay keeps gates fed back on themselves, such as latches and ring
  oscillators, well defined.
- A flip-flop takes D on the rising edge of CK. RST, where the Symbol has it,
  is active high and clears it.

The signal-flow and converter blocks have bodies too
([amplifiers and adder](../../packages/netlist/src/ideal-analog-block-models.ts),
[multiplier and converters](../../packages/netlist/src/ideal-signal-block-models.ts)):

- The adder is two E-sources stacked through an internal node, V(Y) = V(A) +
  V(B) from ground. It is linear, so SPICE and Spectre both print it.
- Each adder input has a sign, `signA` and `signB`, `+` (the default) or `-`,
  edited in Properties as a choice. The Unicode minus `−` (U+2212), as
  typeset text spells it, counts as `-` wherever a sign is typed, checked or
  read; Properties and an Agent's `place-component` and `set-property` store
  it as `-`. A sign is not a SPICE parameter: it chooses the body, and the
  call carries none. Each pattern of signs has its own body, named after the
  inputs it subtracts, whose source gains follow the signs: `adder` (+ +),
  `adder_minus_a` (− +), `adder_minus_b` (+ −) and `adder_minus_ab` (− −).
  The V_hold − V_DAC of a pipelined ADC stage therefore calls
  `adder_minus_b`, whose `ESUMB nsum 0 B 0 {-1}` subtracts B. An adder whose
  inputs both add calls `adder` and exports byte for byte as before signs
  existed, whether it stores `+` or no sign at all. Any other sign blocks
  export with `INVALID_ADDER_SIGN`. An adder bound to another subcircuit
  calls that subcircuit. In a Project that defines `adder` itself, in any
  case, every adder keeps calling it whatever its signs: an external
  definition replaces every built-in adder body, and a Cell of that name is
  refused as a shared master name (`MASTER_NAME_COLLISION`), as it is beside
  an adder that adds. When an adder that calls such a subcircuit subtracts,
  export warns with `ADDER_SIGN_NOT_EXPORTED` that the subcircuit must
  subtract as drawn. One table in
  [`@icm/devices`](../../packages/devices/src/adder.ts) names the adder's
  target, its sign parameters and its bodies for export, Properties and the
  drawing. The drawing marks the signs: see the
  [Razavi contract](razavi-visual-contract.md#signal-flow-adder-signs).
- The multiplier is V(Y) = gain·V(A)·V(B) from ground. `gain` defaults to 1/V
  and is edited in Properties.
- The ADC and the DAC each map their input onto 2^`bits` levels between VSS
  and VDD, without a clock. The output is VSS + LSB·code, the code being the
  input's whole number of LSBs clamped to 0 … 2^bits − 1. One analog pin
  carries the code as that voltage, so an ADC into a DAC reproduces the
  quantized input. `bits` defaults to 8 and is edited in Properties.

The ideal comparator, which every placed comparator is bound to
(`icm_ideal_comparator`), is V(VOUT) = vlow + (high − vlow)·½(1 +
tanh(V(VIP, VIN)/`vtransition`)) from ground
([`@icm/devices`](../../packages/devices/src/ideal-comparator.ts),
[body](../../packages/netlist/src/generated-models.ts)). Properties and an
Agent edit three parameters:

- `vhigh`, the high level: `VDD`, the default, in any case, or a number in
  volts. `VDD` is the comparator's own VDD terminal, resolved as a logic
  block's supply is (below): explicit binding, then the one drawn positive
  supply, then the Cell's default VDD pin, with `MISSING_BLOCK_SUPPLY` when
  two compete. The logic a comparator drives reads a high above half its
  supply, which a fixed 1 V never reaches at a VDD of 2 V or more (#1306).
  A comparator with no `vhigh` has the default, as Properties shows it.
- `vlow`, the low level, a number in volts from ground; the default is `0`.
- `vtransition`, the width of the tanh step, a positive number; the default
  is `1m`.

The high level chooses the body at the call, as an adder's signs choose its
body; one equation serves both and every backend (SPICE, Spectre, VACASK).
`VDD` calls `icm_ideal_comparator_vdd`, whose interface is `VDD VIP VIN VOUT`
and whose call carries `vlow` and `vtransition` but no `vhigh`; it reads VDD
and never VSS, so a Cell that draws no supply, and a Cell calling it, gain a
VDD pin and no ground pin for it. A number calls `icm_ideal_comparator`
(`VIP VIN VOUT`) with the parameters as stored, byte for byte as before `VDD`
existed: comparators placed before it store `vhigh=1`, and they are not
migrated. Any other
`vhigh`, a `vlow` that is not a number, or a `vtransition` that is not a
positive number blocks export with `INVALID_IDEAL_COMPARATOR_PARAMETER`. A
level that is no number at all, a word other than `VDD` or an expression in
braces, is also an ERC diagnostic of the Cell that names the forms it takes,
and an Agent's `set-property` refuses it at once.

An authored Cell or a declared external definition with the same name replaces
the ordinary built-in body. The ideal comparator's two bodies still reject
authored shadowing: a Cell or an external definition named after either one
beside an ideal comparator is `IDEAL_COMPARATOR_NAME_COLLISION`. SPICE and
native VACASK include all reviewed built-in models.
Spectre also includes Comparator and every combinational gate, projecting their
shared equations into `bsource` and the same RC output delay. DFF, multiplier
and converter Spectre exports retain their existing call-only behavior and
`SPECTRE_MODEL_NOT_INCLUDED` warning: the reader's external library must define
them. Explicit external and custom bindings are never replaced by an ideal body.

[DeviceDescriptor](../../packages/devices/src/contract.ts) owns canonical pin
order, invocation policy, parameter metadata and supported dialects. The
[registry](../../packages/devices/src/registry.ts) supplies reviewed entries.

The effective Instance binding is authoritative before the Symbol's default:
an explicitly selected external master or child Cell is never replaced by a
built-in model. [Instance parameter contracts](../../packages/devices/src/instance-parameters.ts)
serve Properties, Agent validation, ERC and editable generated Circuit source.
[Built-in model contracts](../../packages/devices/src/built-in-model-contracts.ts)
own explicit implementation selectors, family, backend availability and complete
parameter metadata/defaults. Their ordered interfaces come from the canonical
component subcircuit definitions; family factories consume them rather than
redeclaring port arrays or target inventories. Artwork aliases share the same
master interface. The ideal comparator's numeric body selects only the
canonical signal ports and its VDD body adds VDD, without changing the
historical five-port external comparator. Internal
switch control ports and magnetic lowering remain separate electrical interfaces,
not inferred from visible Symbol pins. Family factories own equations, and
backend printers own syntax. Known model parameters are editable in Circuit
source and write back to the same `Instance.netlist.parameters`. Custom and
unreviewed external/Cell parameter sets remain open. No new persisted schema,
global supply declaration or parallel legacy implementation is introduced.

Generated masters have compiler ownership, not Canvas Document ownership.
One `generatedDefinitions` inventory transports comparator, logic, signal and
magnetic bodies through structural printing and simulation preparation. Each
definition is emitted once across bound files, with normal collision and
shadowing diagnostics. Generated internal primitives are not editable Instances.
Model factories produce small typed electrical recipes (ports, defaults, nodes,
elements and expressions), not SPICE cards for another backend to reverse-parse.
Each printer owns syntax projection only. Native VACASK prints the reviewed
nonlinear equations as behavioral sources, requiring its OpenVAF compiler;
it does not convert arbitrary user SPICE source. Backend availability is a fact
of the shared model contract, not a runtime/PDK permission gate on structural
export. Licensed Spectre execution remains a separate qualification obligation.

`DeviceParameterDefinition` is the same descriptor-owned field metadata used
by Insert and Properties (key, label, requiredness, editor kind, optional unit
hint/example/help, and display role). Required export fields are derived from
`parameters`; there is no separate `requiredParameters` registry.

Pin order names canonical Symbol pins. Hidden or implicit pins remain present.
Canonical MOS ordering is D/G/S/B. Ground is a Net marker that verifies the
explicit global Logical Net `0` and emits no instance line. Newly authored VDD
Power is a non-emitting formal Cell Pin with derived `powerDomain: vdd`; its
Properties connection mode may instead replace that formal terminal with an
explicit Global marker claim. A local Power Rail has no Instance but its visible
power-label annotation owns a formal Cell terminal, so its authored name appears
in the `.subckt` interface. An explicitly global Power Rail has no formal
terminal and is emitted through the dialect's global declaration.
A drawn switch is an ngspice voltage-controlled `S` card. A two-terminal switch
(Open, Closed, Simple) is controlled by the clock phase its display label
names: a label drawn Φ₁ means phase `Φ1`, written `PHI1` like any Greek name.
A single-ended switch is controlled by its CTRL pin. Both read the control
against the Cell's ground (`VSS` in a structural netlist, `0` at a deck's top),
so a Cell holding one states a ground. The phase node is the Net of that name
in the same Cell, from a Net Label or a Cell Pin. A phase no Net supplies is a
node of its own, reported as `SWITCH_PHASE_NOT_DRIVEN`. Every such switch
closes through `ideal_switch`, an `SW` model card (RON 1 Ω, ROFF 1e12 Ω, VT
0.5 V, VH 0) printed once inside each Cell that uses it. A two-terminal switch
whose label still shows its own name is clocked by a phase of that name, so a
freshly placed `S1` prints as `S1 a b S1 VSS ideal_switch` and warns that
nothing drives `S1`; writing Φ₁ on its label moves it onto that shared clock.
Spectre writes the same Cell-local four-terminal master as a hard conductance
`bsource`, with those unchanged defaults and phase/CTRL semantics. It neither
invents a clock nor smooths a transition. The SPDT selector has no primitive.
Native VACASK uses the same defaults and four-terminal interface through the
qualified `icm_switch` runtime primitive, which registers hard-edge breakpoints.
This requires the patched native runtime, not stock upstream 0.3.4; see the
[runtime patch and qualification](../../containers/vacask/patches/README.md).
A diode placed in a Process with no diode of its own (Abstract, SKY130, IHP
SG13G2, Custom) is bound to the generic model `DIODE`, which no library
defines. A placed Zener is not, and Apply process leaves it alone too: the
generic model has no breakdown, so a Zener's model is the one its BV builds
or one its author names, and without either the export keeps reporting
`MISSING_MODEL_TARGET`. Every Cell whose diodes name `DIODE`, a Zener bound to
it by hand included, carries one
`.model DIODE D(IS=1e-14 N=1)` card in its own body: SPICE's default
junction, its saturation current and emission coefficient stated. The export
reports `GENERIC_DIODE_MODEL` as information for that Cell, naming the
diodes ("D1 uses the generic diode model DIODE (IS=1e-14, N=1); set a model
for a real device"); like `MOS_BODY_DEFAULT_SUPPLY` it gates nothing. The name
stays an editable model target, and a diode bound to any other name gets no
card. A model of that name in the author's own text is the author's, and no
Cell carries the card, which would shadow it inside the Cell: in the SPICE the
Project was imported from, everywhere; in a simulation folder's files
(`.model DIODE …`, or `model DIODE …` in VACASK), in that folder's runs only.
The design export and every other folder's runs keep the card. Native VACASK
writes the card as an `sp_diode` model. The card is SPICE only; a Spectre
export still names `DIODE` for the reader's libraries to define.
A BJT placed in Abstract or Custom is bound in the same way to the generic
model `NPN` or `PNP`, which no library defines either. Every Cell whose
transistors name one carries its card, `.model NPN NPN(IS=1e-16 BF=100
VAF=100)` or `.model PNP PNP(IS=1e-16 BF=50 VAF=50)`: Gummel-Poon
placeholders with their saturation current, forward gain and Early voltage
stated, not any real device. The export reports `GENERIC_BJT_MODEL` as
information for that Cell, one finding naming each card's transistors ("Q1
and Q2 use the generic bipolar model NPN (IS=1e-16, BF=100, VAF=100), Q3 uses
the generic bipolar model PNP (IS=1e-16, BF=50, VAF=50); set a model for a
real device"). The names stay editable, and a model of the same name in the
author's own text replaces the card exactly as for `DIODE`. Native VACASK
writes the cards as `sp_bjt` models, `type=1` for NPN and `type=-1` for PNP,
loading `spice/bjt.osdi`. They are SPICE only; a Spectre export still names
`NPN` and `PNP` for the reader's libraries to define.
A MOS transistor bound to the generic `NMOS` or `PMOS` that Abstract and
Custom offer, and a voltage-controlled switch bound to the generic `SW`, get
no card: no one card suits every simulator, a level-1 card refuses the `nf`
every MOS carries, and a switch's threshold is the design's own. The SPICE
export reports `GENERIC_MODEL_UNDEFINED` as information for the Cell instead,
naming the parts and the cards a run needs ("M1 and M2 name NMOS, a generic
model the netlist does not define: add a .model NMOS card to the simulation
folder before simulating, or set a real model"). A model of that name, in any
case, in the SPICE the Project was imported from or in a folder's own files
quiets it, everywhere or in that folder's runs.
A drawn T-coil or transformer is one Symbol on the canvas and coupled
windings in the netlist: each Instance is an `X` call on a built-in
subcircuit that the file defines once, ahead of the Cells, with the
library's values as its defaults. `tcoil` (ports `n1 n2 n3`, for pins 1, 2
and the centre tap 3) is `L1 n1 n3 {l1}`, `L2 n3 n2 {l2}`, `K12 L1 L2 {k}`
and the bridge `CB n1 n2 {cb}`; `xfmr` (ports `p_minus p_plus s_minus
s_plus`) is `LP p_plus p_minus {lp}`, `LS s_plus s_minus {ls}` and
`K1 LP LS {k}`. Each winding is written from the end the Symbol's polarity
dot marks, which is the node SPICE and Spectre read as the dot, so a
T-coil's windings aid from end to end (L1 + L2 + 2M) and a transformer's
dotted pins are in phase. Spectre writes the same network with `inductor`
and `mutual_inductor`. A call takes exactly the Symbol's parameters: another
parameter (`MAGNETIC_PARAMETER_NOT_ACCEPTED`), a coupling outside −1 to 1
(`MAGNETIC_COUPLING_OUT_OF_RANGE`), or a Cell or external subcircuit already
exporting as `tcoil` or `xfmr` (`MAGNETIC_SUBCIRCUIT_NAME_COLLISION`) blocks
export. The dotted ends belong to the pins — pin 1 and the tap for a T-coil,
P+ and S+ for a transformer, as the library draws them — so the copy of
either definition a saved Project carries lowers the same way while it keeps
the library's pins and parameters. Native VACASK writes the same winding
network using its `mutual` primitive and bundled inductors. Its coupling
coefficient is nonnegative: negative coupling reverses the secondary winding's
reference direction without changing the externally visible pin order.
Decorative symbols never have a device definition. An unsupported electrical
Symbol blocks export.

Independent source syntax is accepted only after its source specification is
represented structurally. A display string is not a source specification.

## Net rules

- Extraction consumes the [connectivity contract](connectivity-and-routing.md#net-naming-and-lifecycle)
  and the [formal interface](schematic-model.md#electrical-authority). It does
  not reconstruct equivalence from spelling, drawing geometry or source hints.
- Semantic scope is independent of emitted spelling. Project-global spelling
  is selected from current claims, formal names, declarations and source hints
  in authority order, retaining variants for explanation. The dialect codec
  blocks authored-token collisions between distinct identities; hints may be
  disambiguated. Cadence bang spelling is an explicit operation profile, not
  persisted scope or an inference in generic SPICE mode.
- An unnamed local Net receives an ephemeral collision-free `net0`, `net1`,
  ... name in stable Logical-Net order. Existing authored names reserve their
  dialect spelling, so automatic allocation skips conflicts. This does not
  mutate the Project.
- Every Net mapped by one projected Formal Port uses that Port name before
  anonymous allocation and therefore receives no generated-name report.
- A global Net must have an explicit name.
- The global Net named `0` is the reference node.
- Other global Nets are emitted through the dialect's global declaration and
  are not silently converted to cell ports.
- Except for the established global SPICE ground reference `0`, one Logical
  Net cannot be both a formal Cell Pin and global; that ambiguity blocks export
  until the interface mode or the conflicting owner is changed.
- An unconnected terminal must carry an explicit `NoConnect`; otherwise export
  is blocked, and the error says to connect it or mark it No Connect. Each
  explicit `NoConnect` receives one deterministic, collision-free
  exporter-only local node (`NC0001`, `NC0002`, ...), preserving fixed device
  and subcircuit arity without adding a Project Net. The node's name is
  reported as information (`GENERATED_NO_CONNECT_NODE`): the mark is the
  author's stated intent, not a finding to resolve.
- Drawing coordinates, text styling and flightlines do not affect Export IR.
  Committed physical connectivity and owned electrical name claims do;
  a Net Label's electrical claim is not merely its drawn text.

## Transient Export IR

The export IR is distinct from the import-oriented `CircuitIR`:

[DesignNetlistIR](../../packages/netlist/src/ir.ts) owns the transient export
shape: top Cell, ordered Cells and external masters, globals, named nodes,
invocation kinds and raw parameters. It is never persisted as Project data.

Extraction validates the entire reachable hierarchy before returning an IR.
Cells are dependency-first with stable tie breaking. Ports follow the
name-grouped formal projection of persisted Cell-Pin declarations. Nodes follow
the device definition or child interface. Instances,
globals, and parameter names use deterministic ordering. Hierarchy cycles are
errors. Net-marker instances are validated and omitted.

The IR contains no geometry, Route, Junction, annotation, source text, include,
analysis, PDK path, or renderer state. A Cell may carry the model cards only
its own instances use, such as the ideal switch. The IR also carries the
coupled-winding subcircuits its drawn T-coils and transformers call.

Project-owned external text is composed after the structural printer through
the shared model-source inventory. Reachable owners emit once, including owned
helper-file closure; declared environment libraries retain rebased relative
references and pinned identities. SPICE copy, panel and export use this same
composition. Unsupported native body conversion refuses explicitly.

Printed body spans map to owner ID, applied revision, file and exact offset.
Supported body/default edits write back through explicit Apply to that owner.
Interface, dependency and cross-owner edits require the definition editor in
Cell Manager, also reachable from Instance Properties and simulation source
diagnostics. They cannot introduce folder-local overrides. The Netlist panel
shows the composed text directly without separate model-owner navigation rows;
explicit model Apply appears in its existing action controls when edits are
pending. Saved drafts do not replace applied bytes; generated model comments
identify the applied version and pending draft. Authoring previews retain the
reachable applied model bodies even when unfinished wiring or values block
strict export. Interface-only placeholders and unreviewed legacy declarations
have no authoritative body: their calls may appear in the preview, but Copy and
export refuse until an implementation is applied. Bodies in experiment files
do not implicitly become Project model owners. Reviewed library bindings still
resolve through their declared library/environment contract.

## Printer contracts

Printers are pure functions over a validated Export IR. They cannot access the
Project, Symbol resolver, filesystem, network, or diagnostics repair path.

SPICE `.spi` emits a generated-file/version comment, sorted `.global`
declarations, the coupled-winding subcircuits drawn magnetic devices call,
dependency-first `.subckt`/`.ends` blocks, ordered defaulted
formal parameters, a Cell's own `.model` cards inside its body, structural
device lines, and deterministic continuations.
It emits no guessed `.include`, `.lib`, analysis, stimulus, or `.end` deck
marker.

Spectre `.scs` emits a generated-file/version comment,
`simulator lang=spectre`, sorted `global` declarations, dependency-first
`subckt`/`ends` blocks, parenthesized ports/nodes, Cell-local `parameters`
declarations, and explicit primitive syntax. It emits no guessed `include`,
section, global parameters, options, analysis, stimulus, or save statement.

Both files are structural libraries. Successful export does not claim that a
simulator can run them without an external simulation setup.

## Diagnostics and failure behavior

Extraction returns structured diagnostics with stable code, severity,
Document ID, and affected object IDs. The strict extractor returns no IR when
any error remains. Copy and export use that same answer: no printer runs and no
partial netlist is exposed while an error remains. Required error coverage includes:

- invalid cell-terminal, Net, or instance identifiers;
- missing or mismatched formal terminal mappings;
- unconnected required terminal without `NoConnect`, including an omitted MOS B;
- unnamed global Net or duplicate explicit Net name;
- unknown or multiply assigned terminal;
- missing device definition, required pin, reference, target, or parameter —
  an Instance carrying no netlist record at all is read as an empty one, since
  it binds nothing and sets no parameter, so its target and parameters follow
  the ordinary missing-value rules rather than reporting the drawing broken;
- wrong reference prefix;
- unresolved or mismatched child cell and hierarchy cycle;
- unsupported dialect/device combination;
- identifier, parameter, count, or output resource-limit violation.

Information reports generated local Net names, explicit NoConnect nodes,
the MOS body findings below and the generic-model findings. Warnings may
report conflicting directions inside one same-name Formal Port group, and
`MILLI_SCALE_VALUE` a parameter value SPICE reads as milli where mega was
almost surely meant (an upper-case `M` before a unit, `1MΩ`), which exports
as written. Neither can downgrade a missing electrical fact required for
meaningful output.

### One electrical extraction authority

Live preview, clipboard copy, downloaded design netlists and Canvas-generated
simulation circuit files all call the same strict extractor on the same
persisted Project bindings. No output surface applies a browser-local process
profile, replaces a model/subcircuit master, changes an invocation kind, fills
device parameters or renumbers an Instance before extraction. An authored
external-subcircuit remains an `X` call everywhere and an authored primitive MOS
remains an `M` card everywhere.

Netlist configuration stores `format`, the selected process and editable
device templates for Abstract, SKY130, IHP SG13G2, TSMC 28, TSMC 180 and Custom.
The editor works in SKY130 until told otherwise, and a native device placed
while a process is selected is bound to that process's model as part of the
placement, so a drawn circuit exports as that process rather than with missing
model fields. A transistor whose process names a plain model takes it when it
is made. Any other part that needs a model takes what applying the process
would give it, in the same transaction: SKY130's transistors, PNP and NPN arrive
as their reviewed `X` wrappers with the definition, and the NPN with its
substrate bound as the process binds it. The Agent and the GUI place through
the same plan. A reviewed BJT wrapper takes the instance multiplier `m`, kept
through every model change; ngspice scales the X call by it.

A terminal a reviewed wrapper ties to the p-substrate belongs on ground or the
Cell's lowest supply: the SKY130 vertical PNP's collector, and the substrate
property terminals of the NPN, poly resistors, varactor and inductors. One on
another Net exports with the warning `PDK_SUBSTRATE_TERMINAL` (#1314): "Q3's
collector is the p-substrate of sky130_fd_pr__pnp_05v5_W0p68L0p68 and belongs
on ground or the lowest supply; it is on mir. Use it as a diode, or with its
collector grounded". A PNP mirror load drawn with it exported ready and
simulated its output at 0.93 V, where the textbook mirror sits near
VDD − V_EB. Ground is the Cell's ground node, and the lowest supply a Net named
like one (`VSS`, `AVSS`, `GND`, `VEE`, `SUB`, `VSUB`, any case).

A DMOS symbol in SKY130 takes the drain-extended 16 V device
(`sky130_fd_pr__nfet_g5v0d16v0`, `sky130_fd_pr__pfet_g5v0d16v0`), or a 20 V
one chosen in Properties (`nfet_20v0`, `nfet_20v0_nvt`, `nfet_20v0_zvt`,
`pfet_20v0`). A 20 V device has one channel and takes only `m` from the part.
Its X line always gives that channel, because the hosted continuous library
needs it spelled out (#1486):

- `nfet_20v0`: L 2.95 µm, W 29.41 µm;
- `nfet_20v0_nvt`: L 1.5 µm, W 30 µm;
- `nfet_20v0_zvt`: L 5 µm, W 30 µm;
- `pfet_20v0`: L 0.5 µm, W 30 µm.

volare's wrappers fix these sizes inside and ignore what the line gives them.
SKY130 models the 16 V pair only at a few sizes:

- N: W 5, 20 or 50–60 µm at L 0.7 µm, or W 5 or 20 µm at L 2.2 µm;
- P: W 5–50 µm at L 0.66 or 2.16 µm.

ngspice 46 picks one by the X line's W and L, accepting either bin edge within
1e-9 m. As the hosted profile runs it, W is the total width whatever the finger
count; a PDK spinit with `ngbehavior=hsa` takes W per finger instead. At any
other size ngspice stops with "could not find a valid modelname".

A 16 V part always has one of those sizes, or one an expression leaves open
(#1483, #1485). Whenever an edit would leave it at another numeric size, the
same transaction gives it a modelled one. Such edits include:

- placing it;
- giving it the device in Properties, by an Agent or by a process;
- typing its W or L.

The size changes as little as it can:

- one of W and L, the first that is enough, takes the device's own value: W 5 µm,
  with L 0.7 µm (N) or 0.66 µm (P);
- W is tried before L, and a W or L the edit set is tried last;
- both take the device's own values when neither alone will do;
- a W or L given as an expression stays as written.

The result is not always the closest modelled size: W 18 µm at L 2.2 µm becomes
W 5 µm, not 20 µm.

Opening a Project does the same for parts saved at another size, such as those
placed before #1484. A part's previous size does not come back when it leaves
the device.

A 16 V device whose size is still none of those exports with the warning
`REVIEWED_SIZE_UNMODELLED`, which names the sizes. This can happen to a Project
built outside the editor. A missing W or L counts as the device's default,
which its wrapper uses.

IHP SG13G2 binds reviewed devices the way IHP-Open-PDK's own xschem symbols
call them: `sg13_lv_nmos`/`sg13_lv_pmos` and the 3.3 V `sg13_hv_*` (`d g s b`;
`w l ng m`), the HBTs `npn13G2`, `npn13G2l`, `npn13G2v` (`c b e bn`, substrate
`bn` as a property terminal; `le we Nx`), `pnpMPA` (`c b e`; `a p m`), the
resistors `rsil`, `rppd`, `rhigh` (`1 2 bn`; `w l [b] m`) and the MIM capacitors
`cap_cmim` and `cap_rfcmim`. Its geometry is in metres, as the Project stores
it, so nothing is converted. Model suggestions in Properties follow the
Project's process library.

SPICE import reads an `M` card that names a reviewed SKY130 transistor, with no
`.model` card of that name in the deck, as that reviewed `X` wrapper: the
SKY130 library defines the name as a subcircuit, so its simulation profile
cannot run the `M` card. Its W and L are already in metres. A deck that does
declare the `.model` keeps a model binding. A model binding that still names
a reviewed device, as older placements and imports wrote, exports as written
with the warning `REVIEWED_DEVICE_AS_MODEL_CARD`; choosing the model again or
applying the process binds the `X` call.
Format is an output preference; names always keep their authored case. Process/device selection is an
undoable Project transaction that writes ordinary typed bindings and parameters
before any consumer extracts the circuit. Creating a bundled example applies
missing native-device defaults from the cached template while retaining
explicit models and external interfaces. Opening or reopening a saved Project's
panel does not edit it, refill deliberately missing parameters, or interfere
with recovery. Templates are
cached in the browser; applied bindings travel with the Project. Simulation Profiles select engines,
dependencies and corners and validate persisted targets; they do not rewrite
them.

Strict extraction and simulation preserve actual MOS B wiring, configured Cell
body defaults and explicit NoConnect. An otherwise unresolved schematic MOS
uses the conventional NMOS ground or PMOS VDD body connection even when no
supply symbol is drawn. A read-only projection supplies missing VDD and ground
nodes; block exports expose the new supplies as VDD/VSS ports and propagate
new pins through internal callers in the same order. The flat simulation root
keeps ground at node 0. No supply symbols or memberships are written back into
the drawing. Existing scoped supplies and explicitly connected/custom bodies
retain priority. The same fallback applies to historical imported devices when
their B terminal has no connection; source provenance does not disable the
conventional default. Missing D/G/S wiring remains an error. Existing declared
Cell interfaces keep their order; this default only adds needed implicit supplies.

A supply added this way is never silent. Where it becomes a new Cell Pin, the
export reports `MOS_BODY_DEFAULT_SUPPLY` as information for that Cell, one
finding per supply: the MOS whose bodies take it, the pin it became (VDD, or
VSS for ground), the other pin of the pair when that came with it, and that
connecting a B pin chooses another body. An LDO's pass device drawn without a
body printed as `XMP vout net0 vin VDD …` beside a `VDD` pin nobody drew, and
nothing said so. The finding is listed in the Check Report (Review Netlist
Issues), the Agent's netlist read and its diagnostics, and MCP `verify` names
it beside its counts; it does not count as a warning and gates nothing. The
Netlist panel lists only what keeps its text from being copied, so it shows no
information. A Cell that already has that supply (a marker, a rail, a supply
Port, or a Net the author named VDD or VSS), a body wired explicitly and a
body following a Cell default raise nothing, nor does a simulation deck's
root, which gains no pin. A caller that only passes the new supply on is not
reported; the Cell whose body took it is.

A body that follows a default (the Cell's default, the single drawn supply, or
the default a copied body brought along) onto one supply while its source is
on another supply of the same domain is reported as information,
`MOS_BODY_OTHER_SUPPLY`, for example "M1's body follows the Cell's PMOS
default VDDL; its source is on VDDH. Connect its B pin to VDDH if that is the
body you mean". A supply is what a body default reads as one
([connectivity](connectivity-and-routing.md#authoring-rules)), compared as the
netlist names its nodes, so a copied Ground marker is still ground, and node
`0` is called ground. The drawing holds no voltages: a body on the higher
supply is reverse-biased and usually intended, one on the lower supply is
forward-biased, and only the author knows which is which, so this is a
question rather than a warning. A body wired explicitly is never reported.

Two supplies of a domain are also why a body can have no default: a Cell that
draws VDD beside VDDH and configures no PMOS body default leaves an unwired
PMOS body unresolved, and the export gives it the conventional VDD. A body
with no Net is therefore asked the same question wherever the export puts it
on another node than its source's supply: "MP's body has no Net and takes the
conventional VDD; its source is on VDDH. Connect its B pin to VDDH if that is
the body you mean". The conventional supply is the export's choice — the Net
named VDD or VSS, drawn as a supply or only labelled, or a pin it adds, which
`MOS_BODY_DEFAULT_SUPPLY` also reports — while the source must be on a supply
the author drew. An imported MOS with no fourth node takes the Cell's body
default where one is set, and is then reported as following it. NMOS bodies
on ground supplies are compared the same way.

Ground is the one reference a Cell states rather than reaches for. A Cell
printed as a `.subckt` that meets ground — its own, or through a Cell it
instantiates — carries a `VSS` pin: placed immediately after the supplies the
author declared (a port whose Net is in the `vdd` power domain), and otherwise
first, so every interface reads `VDD VSS …` the way the Block library already
writes it. Its internal nodes read `VSS` in place of `0`. A Cell that only
passes ground down to a child gets the pin too, or the child's reference would
have nowhere to come from. A Cell whose author already gave ground a pin of
their own keeps that pin — the policy states a reference rather than
duplicating one — and the node takes that pin's name, so no Cell printed as a
subcircuit is left reaching for the global reference under another name. A
call then passes nothing extra: the caller's ground goes only to a pin the
Cell adds, and a parent that only calls such Cells needs no ground pin for
them. The added pin is named `VSS` unless the Cell already gives that name,
in any case, to another Pin or Net, as a Cell with ± supplies does when it
draws ground and a Port `VSS` for its negative supply (#1353). It is then
`GND` (or `GND__2` and on), the two stay apart, and the export reports
`GROUND_PIN_RENAMED` as information: "Ground's pin is named GND: VSS is
another Net here. If VSS is this Cell's ground, connect it to the ground
marker". Callers name the same pin; like the body defaults, a run does not
repeat the finding.

The one Cell a deck prints as its own top-level cards keeps node `0`: there the
deck is the outside, and its calls carry that `0` into each child's `VSS` pin.
So a simulated deck and a handed-out netlist share the same subcircuits, and
only the outermost level differs. `groundPin` selects the policy and
`rootAsTopLevel` names which Cell is the deck (`SIMULATION_DECK_GROUND` pairs
them for every simulation surface). The analyzer's own default keeps node `0`,
which is what an imported deck round-trips to and what an Agent Snapshot
reads.

Built-in Analog Blocks keep `VDD`/`VSS` as hidden, property-only electrical
terminals; the Symbol has no extra canvas pins. Each terminal may bind to any
existing logical Net through Properties. An explicit binding wins over supply
names and power-domain inference, so a Block can use an alternate rail without
changing its library subcircuit interface. The default `Auto` setting uses the
Cell's one unambiguous drawn Net in that domain (including a formal `VDD`/`VSS`
Port or a wired supply marker), the same classification used for MOS bodies
([connectivity](connectivity-and-routing.md)). A Cell that draws no supply of
that domain at all gives the Block the default an unconnected MOS body takes
(owner decision, 2026-10-04): the one Net the author named VDD or VSS, or else
a new `VDD` pin and ground, exposed and propagated as above. A textbook logic
figure drawn without supplies therefore exports. An imported node hint
spelled VDD is not a supply; it is disambiguated rather than merged. If
several candidates compete, `MISSING_BLOCK_SUPPLY` blocks export until the
author selects a Net or draws one unique supply. An Agent makes the same
choice with `circuit_properties` `set-block-supply {target, supply, net}`;
`net: null` returns to Auto.

Some built-in bodies never read their supplies: the ideal amplifiers and the
adder in either format, and the multiplier and the ideal comparator with a
numeric high level in SPICE. When such a Block has neither a selected nor a
drawn supply, the unused port is tied to node `0` and nothing blocks. A
textbook switched-capacitor integrator therefore exports without a supply
drawn. The ideal comparator whose high level is `VDD` reads VDD alone: it
takes the default VDD described above, but no default ground. An authored
Cell or a declared external definition of
the same name replaces the body and may use its supplies, so the rule above
applies to it again, as it does to every Block whose body uses VDD and VSS.
Export never silently declares `.global VDD VSS`; a default supply is a Cell
Pin, as for MOS bodies.

Persisted reviewed physical R/C bindings emit their declared terminals and raw
geometry; an ideal value is never reinterpreted as physical geometry during
export. Reviewed geometry stays in canonical metres until strict extraction
emits a wrapper's required units in either dialect. Unknown custom subcircuits
and unresolved hierarchy retain their original interfaces and validation.
Design-netlist export injects no environment model library. Explicit loads
declared by a reachable Project model source remain in its portable closure.
Execution Profile libraries and corner overrides belong to the authored
experiment and its selected environment.

### Missing models and values

`MISSING_MODEL_TARGET` and `MISSING_REQUIRED_PARAMETER` block structural output
like every other extraction error. The editor's selected process can author
configured defaults through one undoable Project transaction; Refresh applies
only missing defaults before trying extraction again. If no configured default
can resolve a field, the sidebar and Check Report show the located diagnostic
and expose no partial netlist. Export never invents an identifier for an
unknown electrical value.

### Unfinished drawings

An unfinished drawing is reported as `DEAD_END_NET`, one per node that a single
instance pin reaches. Such a node
is printed once and nothing else in the file ever reaches it, so a simulator
meets a floating node rather than a circuit. Four single-pin nodes are not dead ends and carry no
finding: a Cell port (its node continues outward to every instantiation), a
global Net (shared with the rest of the design), an explicit `NoConnect` (the
author saying the pin ends here), and a node with an authored or imported name
(a declared signal such as a probe point, not leftover geometry — the test is
that extraction did not have to invent the name).

`createDesignNetlistExport` reports these findings without withholding
output: its job is to say what the drawing currently says, so a preview of
work in progress stays possible. Whether a netlist is fit to hand out is the
caller's question, and `unfinishedDrawingDiagnostics` is how a caller asks
it. The editor's Check Report, its live netlist panel, and the copy/export
command all refuse on a non-empty answer, and `designExtractsNetlist` — the
Gallery's mark ([community gallery](community-gallery.md)) — answers `false`.

Existing conflicting bindings, missing hierarchy interfaces, unsupported devices,
invalid waveforms, and incomplete connections remain blocking. This projection
never exports the permissive authoring IR. It cannot omit an invalid device or invent a model definition, apart from the generic diode and bipolar cards above, which stand in only for the placeholder names a Process binds. Numerical defaults
and the explicit substrate rule belong only to the selected preset above.

The editor's primary Netlist button copies immediately in its current format
(SPICE by default) and opens the live right sidebar. That panel's Format select
chooses the format independently of the adjacent Process selector. The compact
NMOS/PMOS/R/C/L selectors apply their target to that device family. Ideal R/C/L
remain the default; selecting a reviewed physical passive uses its geometry,
not a numerical conversion of an ideal resistance/capacitance/inductance.
Authored W/L and values survive process changes, except a 16 V DMOS size SKY130
has no model for (see above), and reviewed SKY130 calls use
the existing canonical unit/interface conversion. TSMC 28 maps `m` to `multi`;
switching back restores `m`. Process selection preserves names and stable
instance IDs; dialect naming happens only during extraction. Custom external
blocks keep their own interfaces. Default restores the mapping the editor starts
in and output preferences, without overwriting authored parameter values,
apart from that same DMOS exception. A
circuit drawn before a process was chosen says so: the panel counts the devices
that still have no model — the same plan, counted rather than committed — and
offers them in one undoable click, filling only what is missing. These choices are remembered locally.
The adjacent menu offers Configuration…, Instances…, Check Report…, and Check
and Save; it has no format choice. Clipboard rejection leaves selectable code
and a status message, without a download fallback.

The right Netlist editor is open by default. Its SPICE and SCS source allows
editing device References, model targets and existing printed parameter values.
A valid edit applies after a short typing pause or Enter (Shift+Enter inserts a
line break). The printer supplies stable Document/Instance locations, including
SPICE continuation lines; the caret highlights the corresponding canvas Instance
and opens its Cell when necessary. It does not infer identity from Reference
spelling, which may repeat across Cells. The link runs both ways:

- Parts selected on the canvas light their printed cards, and a new selection
  scrolls them into view.
- A new selection on the canvas takes over from the caret's part.

While the strict export is blocked, the panel shows a read-only draft printed
from the authoring IR (`createDraftNetlistPreview`), so a part appears in the
netlist as soon as it is placed. In the draft:

- an unconnected pin, a missing model and a missing required value print as
  `?`;
- a part with no netlist form is named in a closing comment;
- the first line says the text is a draft.
  The cards a blocking finding names are lit in yellow and keep the canvas link.
  A `?` is no identifier in either format, so a draft never passes for a
  netlist. Copy and export stay blocked until the strict export is ready, and
  `designExtractsNetlist` never reads the draft.
  Explicit inspector actions (Q, double-clicking a component, Issues and import
  review) replace the default netlist panel. Canvas editing never requires closing
  the netlist first. A project panel is closed by the control that opened it —
  the toolbar button or the menu entry, both of which toggle — so the dock shows
  no close button over the panel's own controls, and the copy button keeps the
  right edge while the Format and Process selects give up width first.

Source edits use one atomic Project transaction with per-Document revisions.
Renaming preserves layout, wiring and IDs, updates bound labels, and leaves
explicit display aliases unchanged. Duplicate names, invalid prefixes, malformed
values and unsupported structure changes retain the draft with an error and
leave the circuit unchanged. Connections, ports and device structure are edited
on the canvas or in Project Code. Dirty source is never silently overwritten by
canvas or Agent changes: conflicting live netlist changes require Reload. Copy
in this panel is disabled until the draft is applied or discarded. The printed
source and the circuit share undo/redo through those same transactions.

The copy/export projection removes the strict printer's generated title and
adds no diagnostic, preset or library comments. It prints every name exactly as
authored: the live panel, Check Report, copy and download never change a
name's letter case. The projection still accepts an optional `portCase`
(`upper` or `lower`) for Agent API callers that request it explicitly; every
formal Port name and the Cell-local node it owns, subcircuit-call pin names,
and external-master terminal names then take that case, and all other Nets
keep their spelling. A browser that saved the retired case preference drops
it on load and keeps its process choices. SPICE
preserves an empty first title line so an entry-file reader does not consume
the first directive. Native SCS begins with its language declaration before an
include. Structured diagnostics remain available in the optional Check Report;
its preview and copy action use the same projection. Strict simulation printers
and their source locations remain unchanged.

## Operations and state transitions

```text
Project + Symbol definitions
  -> validate and extract DesignNetlistIR
  -> choose SPICE or Spectre printer
  -> deterministic text
  -> live sidebar and clipboard copy
```

An electrical edit changes Project revision and refreshes an open netlist sidebar.
Blocked structure or configuration clears the code instead of displaying stale
output; copying a blocked result leaves the clipboard unchanged.
A presentation-only edit may change revision but must not change extracted IR
or output bytes.

## Persistence boundary

Cell interfaces and instance electrical data are persisted in the Project.
Device definitions ship with the Symbol library. Export IR, generated local Net
names, diagnostics, and output text are transient. PDK model contents and simulation profiles remain external; export preferences
are browser-local configuration.

## Valid example

A four-terminal manually authored NMOS has reference `M1`, explicit model
`nch_mac`, D/G/S/B Net membership, and raw `w=2u l=60n`. It deterministically
prints as a model-backed device in both dialects. Moving or rotating it does not
change either output.

## Incomplete and rejected examples

A manually authored NMOS with W/L values but no model target produces a
missing-target error and no structural output. Without a selected preset,
export must not guess a model. With a preset, the
configured target and parameter defaults apply. The same
device with an unconnected, unmarked drain still blocks output.

## Compatibility boundary

Export accepts only the current Project schema. Retired compatibility
properties and all non-current schema versions are rejected by persistence
before extraction. Only the explicit preset projection may add its documented defaults and library
include; it never repairs a broken hierarchy or invents foundry model data.

## Deterministic validation

- current Project schema and canonical save/load/save tests
- complete reviewed device-definition coverage tests
- extractor diagnostics and presentation-independence tests
- repeated extraction deep equality and repeated output byte equality
- `.spi` reparse and normalized structural equivalence through `packages/spice`
- Spectre grammar-focused golden tests; licensed simulator parsing only when
  available and never implied otherwise
- focused editor clipboard/sidebar, bulk JSON, undo/redo and blocked-diagnostic flows
- full mainline gate before non-document delivery

## Simulation boundary

Project-owned external sources are native SPICE or Spectre. Their applied
revision owns both generated dialects, including the owned helper closure and
explicit third-party references. No independently editable converted model is
stored. Cross-dialect output carries derived owner mappings; edits that cannot
reverse exactly return MODEL_SOURCE_EDIT_REQUIRES_OWNER instead of changing an
experiment copy. Unsupported syntax reports a native file position. External
Spectre library references cannot be relabelled as SPICE; explicit SPICE language
sections retain their real language. Model Copy omits enclosing root/testbench
and refuses pending drafts. The GUI shares only Format/Process/Copy controls
with the right panel; their mutation scope remains the current model owner.

[Simulation source authoring and compilation](simulation.md) compose explicit
environment, source and analysis intent with the electrical projection.
[Execution](simulation-execution.md) owns preparation and runs. Structural
SPICE/Spectre export is not an executable deck and does not infer that setup.
