# Deterministic Netlist Export

Status: `accepted`

Primary owner: `packages/netlist`

Related ADR: [`hierarchy-netlist.md`](../adr/hierarchy-netlist.md)

## Purpose

Export converts persisted electrical facts into structural SPICE `.spi` and
Spectre `.scs` design netlists (Cells, ordered interfaces, devices, nodes,
targets, globals, raw parameters) by ordinary program logic: no AI, no drawing
geometry, no host PDK search. Libraries, corners, stimuli, analyses and saves
belong to a simulation deck ([simulation](simulation.md)).

## Authorities

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

- Retired `spice.name`, `spice.target`, `spice.pin.Pn`, `spice.param.*` are
  invalid and never read.
- Portable definitions share authoring interface validation: malformed ones
  block with `INVALID_COMPONENT_INTERFACE` even when loading is bypassed; every
  Symbol pin maps once with unique formal names. A descriptor calling a built-in
  model with an incompatible mapping is `COMPONENT_MODEL_INTERFACE_MISMATCH`.

## Persisted data model

The [model schema](../../packages/model/src/schema.ts) owns Cell interfaces and
Instance bindings; export defines no parallel shape.

- Names and values are length-bounded. Emitted identifiers are ASCII letters,
  digits and `_` (not starting with a digit), unique case-insensitively; other
  bounded source identifiers may persist so imports open, but block export and
  are never renamed.
- Cell Pin (`port`) and Bias Voltage Port (`port-filled`) each own one
  declaration via `terminals[].interfaceInstanceIds` and emit no line; the Port
  Name is `CellTerminal.name`. Same names (case-insensitive) fold into one
  formal node, first occurrence fixing order and spelling, without merging Base
  Nets. Only an explicit Agent `portCase` changes formal-name case.
- Every manual device has an explicit Reference, unique per Cell with its
  descriptor prefix; model-backed devices carry a target; raw parameters are
  never evaluated. Formal defaults emit in stored order; a required-only formal
  blocks. SPICE import restores `.subckt` defaults.
- An external-subcircuit binding selects a project definition by
  `definitionId` (ordered terminals, master `name`); instances own raw overrides
  and extra keys are kept. `unresolved-subcircuit` keeps only a master name.
  Artwork never turns a call into a primitive.
- Reviewed native mappings may rename pins: SKY130 resistor `R0/R1/B` from
  `1/2/B` (B is a Properties-only membership, never a Symbol pin, Route end or
  NoConnect); MIM capacitor and varactor `sky130_fd_pr__cap_var_lvt` `C0/C1`
  from `1/2`. Mappings are offered only on their symbol; Var Cap (`P1/P2`) stays
  ideal and refuses a model.
- SPICE adds the invocation prefix only in derived IR (`M1` → `XM1` for
  subcircuit bindings); Spectre keeps the authored spelling. Legal names are
  reserved first; collisions get `_2`, `_3`. Editor renames map back
  (`XM2` → `M2`); imported X names are never rewritten.
- Reviewed SKY130 `l/w` are stored as metre strings and printed as micrometres in
  both dialects; editable geometry maps back. Printed keys map back to authored
  case; untouched fields keep their spelling.

## Device definition

[DeviceDescriptor](../../packages/devices/src/contract.ts) owns pin order,
invocation, parameter metadata and dialects; the
[registry](../../packages/devices/src/registry.ts) holds reviewed entries.
`DeviceParameterDefinition` serves Insert and Properties; required export fields
derive from `parameters`.

- The effective binding beats the Symbol default: explicit external masters and
  child Cells are never replaced by a built-in body.
  [Instance parameter contracts](../../packages/devices/src/instance-parameters.ts)
  serve Properties, Agent, ERC and Circuit source;
  [built-in model contracts](../../packages/devices/src/built-in-model-contracts.ts)
  own selectors, families, backend availability and defaults.
- Generated masters are compiler-owned: one `generatedDefinitions` inventory
  carries comparator, logic, signal and magnetic bodies through printing and
  simulation, each emitted once. Factories produce typed recipes; printers own
  syntax only. VACASK prints reviewed nonlinear equations as behavioral sources
  (OpenVAF). Backend availability is not a PDK gate.
- An authored Cell or external definition with a built-in body's name replaces
  it, except where a collision code is listed below.
- MOS pin order is D/G/S/B; hidden pins stay. Decorative symbols have no
  definition; an unsupported electrical Symbol blocks. Sources export only from
  a structural specification, never a display string.

### Ideal blocks

Bodies live in [analog blocks](../../packages/netlist/src/ideal-analog-block-models.ts),
[signal blocks](../../packages/netlist/src/ideal-signal-block-models.ts) and
[generated models](../../packages/netlist/src/generated-models.ts). Every Block
declares fixed `VDD`/`VSS` ports; logic ports follow Symbol pins.

- Voltage amplifier (`gain` 1), transconductors (`gm` 1m S) and the fully
  differential op-amp (unlimited) are frequency-independent E/G sources that
  VDD/VSS neither power nor clamp.
- Op-amp: `gain`·V(IN+, IN−) (default 1e6), exact between `vlow`/`vhigh` and
  bending onto each limit within 1e-4 of the span. Limits are volts or
  `VDD`/`VSS` (default). It is powered when its VDD is a Net (selected or the one
  drawn positive supply); unpowered supply limits read ±5 V (owner decision),
  and a default VDD Pin added for other parts powers no op-amp. Several
  candidates read ±5 V (ground low) with non-blocking
  `IDEAL_OPAMP_SUPPLY_AMBIGUOUS`. Bodies `opamp`, `icm_opamp_vdd`,
  `icm_opamp_vss`, `icm_opamp_vdd_vss`; no call carries `vhigh=VDD`. Errors:
  `IDEAL_OPAMP_NAME_COLLISION`, `INVALID_IDEAL_OPAMP_LIMIT`.
- Logic (SPICE): gates, buffer, inverter and D flip-flops print once ahead of the
  Cells; inputs are high above V(VDD,VSS)/2 via a `tanh` step `vt` (10 mV);
  outputs swing VSS→VDD through a one-pole delay `td` (10 ps); flip-flops sample D
  on CK rising, RST active high.
- Adder: V(Y) = ±V(A) ± V(B). `signA`/`signB` are `+` (default) or `-` (`−` read
  and stored as `-`); signs pick the body (`adder`, `adder_minus_a`,
  `adder_minus_b`, `adder_minus_ab`), never a call parameter; `+ +` is
  byte-identical to unsigned. Errors and warnings: `INVALID_ADDER_SIGN`,
  `MASTER_NAME_COLLISION` (a Cell named `adder`), `ADDER_SIGN_NOT_EXPORTED`
  (subtracting adder calling a custom body). A Project `adder` definition
  replaces every body. [`adder.ts`](../../packages/devices/src/adder.ts) is the
  single table; drawing: [Razavi contract](razavi-visual-contract.md#signal-flow-adder-signs).
- Multiplier: `gain`·V(A)·V(B), `gain` default 1/V. ADC/DAC: 2^`bits` (default 8)
  levels between VSS and VDD, unclocked, output VSS + LSB·code clamped, so
  ADC→DAC reproduces the quantized input.
- Comparator (`icm_ideal_comparator`, [contract](../../packages/devices/src/ideal-comparator.ts)):
  vlow + (high − vlow)·½(1 + tanh(V(VIP,VIN)/`vtransition`)). `vhigh` is `VDD`
  (default; resolved like a Block supply, `MISSING_BLOCK_SUPPLY` when two
  compete) or volts; `vlow` volts (0); `vtransition` positive (`1m`). `VDD`
  calls `icm_ideal_comparator_vdd` (`VDD VIP VIN VOUT`, adds a VDD pin, no
  ground); numbers call `icm_ideal_comparator` (`VIP VIN VOUT`) byte-identically
  (stored `vhigh=1` is not migrated). Errors:
  `INVALID_IDEAL_COMPARATOR_PARAMETER` (also ERC and immediate Agent refusal),
  `IDEAL_COMPARATOR_NAME_COLLISION`.
- SPICE and VACASK include all bodies; Spectre includes comparator and
  combinational gates (`bsource` with RC delay); DFF, multiplier and converters
  stay call-only with `SPECTRE_MODEL_NOT_INCLUDED`. Other Analog Blocks are
  black-box calls.

### Switches

- Every switch is an ngspice `S` card through `ideal_switch` (`SW`: RON 1 Ω,
  ROFF 1e12 Ω, VT 0.5 V, VH 0) printed once per using Cell; Spectre uses a hard
  `bsource`, VACASK the qualified `icm_switch` (patched runtime,
  [patch](../../containers/vacask/patches/README.md)). No clock is invented;
  SPDT has no primitive.
- Two-terminal switches follow the phase their label names (Φ₁ → `PHI1`; a
  label showing its own name is its own phase, `S1 a b S1 VSS ideal_switch`);
  single-ended ones use CTRL; both read against the Cell's ground (`VSS`, `0` at
  a deck top). The phase node is the same-Cell Net of that name.
- An overbar names a separate `_bar` signal; export never inverts or adds an
  inverter.
- A phase no Net supplies becomes an input pin after authored pins and ground,
  propagated up through callers; at a deck top it is a plain node.

### Generic models

- Diodes in a Process without its own (Abstract, SKY130, IHP SG13G2, Custom)
  bind to `DIODE`; Zeners never do and report `MISSING_MODEL_TARGET`. Each Cell
  naming `DIODE` carries `.model DIODE D(IS=1e-14 N=1)` (information
  `GENERIC_DIODE_MODEL`).
- BJTs in Abstract or Custom bind to `NPN`/`PNP` with cards
  `.model NPN NPN(IS=1e-16 BF=100 VAF=100)` and
  `.model PNP PNP(IS=1e-16 BF=50 VAF=50)` (information `GENERIC_BJT_MODEL`).
- A same-name model in the imported SPICE suppresses the card everywhere; one in
  a folder's files only for that folder's runs. VACASK prints `sp_diode`/`sp_bjt`
  (`type=±1`); cards are SPICE-only.
- A netlist handed out (panel, copy, save, `SPICE+RNL`, `Spectre+RNL`) carries
  BSIM4 stand-ins for generic `NMOS`/`PMOS` in each Cell naming them
  (information `GENERIC_MOS_MODEL`), so it reads back with each part's channel
  and runs: `.model NMOS nmos level=54` and `.model PMOS pmos level=54` in
  SPICE, `model NMOS bsim4 type=n` and `model PMOS bsim4 type=p` in Spectre.
  BSIM4 takes the `nf` every MOS carries, which a level-1 card refuses; only
  ngspice and Spectre are promised to read them. A run's deck carries none
  (#1420: VACASK has no mapping for a Cell's own MOS card) and, like `SW`
  everywhere, SPICE reports information `GENERIC_MODEL_UNDEFINED`, silenced
  likewise.

### Magnetics

- T-coil, transformer and center-tap inductor are `X` calls on built-ins defined
  once ahead of the Cells: `tcoil` (`n1 n2 n3`: `L1 n1 n3 {l1}`, `L2 n3 n2 {l2}`,
  `K12 L1 L2 {k}`, `CB n1 n2 {cb}`), `xfmr` (`p_minus p_plus s_minus s_plus`:
  `LP p_plus p_minus {lp}`, `LS s_plus s_minus {ls}`, `K1 LP LS {k}`),
  `ct_inductor` (the T-coil without `CB`, `k` default 0).
- Windings start at the polarity dot (pin 1 and the tap; P+ and S+). Spectre uses
  `inductor`/`mutual_inductor`; VACASK `mutual` with nonnegative coupling.
- Errors: `MAGNETIC_PARAMETER_NOT_ACCEPTED`, `MAGNETIC_COUPLING_OUT_OF_RANGE`,
  `MAGNETIC_SUBCIRCUIT_NAME_COLLISION`.

## Net rules

- Extraction consumes the [connectivity contract](connectivity-and-routing.md#net-naming-and-lifecycle)
  and the [formal interface](schematic-model.md#electrical-authority), never
  spelling, geometry or hints.
- Global spelling comes from claims, formal names, declarations and hints in
  authority order; authored-token collisions block; Cadence bang spelling is an
  explicit operation profile only.
- Unnamed local Nets get transient `net0`, `net1`, … in stable order, skipping
  authored names; Formal Port Nets use the Port name.
- Globals need explicit names; global `0` is the reference; other globals use the
  dialect declaration, never ports; except `0`, a Net cannot be both formal Pin
  and global.
- An unconnected terminal needs `NoConnect`; each gets an exporter-only node
  `NC0001`, … (information `GENERATED_NO_CONNECT_NODE`).
- Coordinates, styling and flightlines never affect the IR.

## Transient Export IR

- [DesignNetlistIR](../../packages/netlist/src/ir.ts) is distinct from import
  `CircuitIR` and never persisted. Extraction validates the whole hierarchy first;
  Cells are dependency-first with stable ties; cycles are errors; net markers are
  omitted. The IR holds no geometry, source text, include, analysis or PDK path;
  a Cell may carry model cards only its instances use.
- Project-owned external text is composed after printing through the shared
  model-source inventory (each owner and helper closure once; environment
  libraries keep pinned identities), identically for copy, panel and export.
- Printed body spans map to owner, applied revision, file and offset; body and
  default edits Apply to that owner; interface and cross-owner edits need the
  Cell Manager editor. Drafts never replace applied bytes; interface-only
  placeholders block Copy and export.

## Printer contracts

Printers are pure functions of a validated IR.

- SPICE: version comment, sorted `.global`, magnetic subcircuits,
  dependency-first `.subckt`/`.ends`, ordered formals, Cell-local `.model`,
  device lines, deterministic continuations; never `.include`, `.lib`, analyses,
  stimuli or `.end`.
- Spectre: version comment, `simulator lang=spectre`, sorted `global`,
  dependency-first `subckt`/`ends`, parenthesized nodes, Cell-local `parameters`;
  never includes, sections, options, analyses, stimuli or saves. An independent
  source the SPICE import kept as written, its AC and PULSE, SIN or PWL in its
  dc text (`0.9 AC 1 0 PULSE(…)`), prints in Spectre's terms
  (`type=pulse val0=… dc=0.9 mag=1 phase=0`), read as the VACASK projection
  reads it; SPICE prints the text unchanged.

## Diagnostics and failure behavior

Diagnostics carry code, severity, Document ID and object IDs. Any error means no
IR and no partial netlist for Copy or export.

- Errors include invalid identifiers, mismatched formal mappings, unconnected
  terminals without `NoConnect`, unnamed globals, duplicate
  names, multiply assigned terminals, missing definition/pin/Reference/target/
  parameter (no netlist record reads as empty), wrong prefix, unresolved child,
  cycles, unsupported dialect/device and resource limits.
- Warnings include Formal Port direction conflicts and `MILLI_SCALE_VALUE`
  (upper-case `M` before a unit, exported as written). Nothing downgrades a
  missing electrical fact.

### One electrical extraction authority

Preview, copy, download and simulation circuits call the same strict extractor
on the same bindings; no surface applies a local profile, swaps masters, fills
parameters or renumbers first.

#### Process configuration

- Netlist configuration stores `format`, the process and device templates for
  Abstract, SKY130 (starting process), IHP SG13G2, TSMC 28, TSMC 180 and Custom.
  Process selection is one undoable transaction writing ordinary bindings;
  Simulation Profiles never rewrite them. Opening the panel never edits the
  Project or refills deliberately missing parameters.
- Placing a native device under a process binds its model in the same
  transaction (GUI and Agent share the plan); SKY130 transistors, PNP and NPN
  arrive as reviewed `X` wrappers. Reviewed BJT wrappers take `m`.
- IHP SG13G2 binds like its xschem symbols: `sg13_lv_*`/`sg13_hv_*`
  (`d g s b`; `w l ng m`), `npn13G2`/`npn13G2l`/`npn13G2v` (`c b e bn`; `le we
  Nx`), `pnpMPA` (`c b e`; `a p m`), `rsil`/`rppd`/`rhigh` (`1 2 bn`;
  `w l [b] m`), `cap_cmim`/`cap_rfcmim`; metres throughout.
- TSMC 28 maps `m` to `multi` and back. Process changes keep names, IDs and
  authored values (except 16 V DMOS sizing); the panel offers filling only
  missing models in one undo.
- Import reads an `M` card naming a reviewed SKY130 transistor without a
  same-name `.model` as its `X` wrapper; a model binding naming a reviewed device
  warns `REVIEWED_DEVICE_AS_MODEL_CARD`.

#### Substrate and negative supplies

- Reviewed p-substrate terminals (SKY130 PNP collector; NPN, poly resistor,
  varactor and inductor substrates) belong on ground or the lowest supply (a Net
  named `VSS`, `AVSS`, `GND`, `VEE`, `VNEG`, `SUB`, `VSUB`, any case); elsewhere
  `PDK_SUBSTRATE_TERMINAL`.
- A supply marker or rail named like `VEE`, `VSS` or `VNEG` is the (single)
  negative supply. Process-bound substrates take it while the NMOS default is
  unset or ground; an NMOS default elsewhere is the substrate default
  (`bulkDefaults.nmos`); else ground. Changing it (Cell Properties or Agent
  `set-mos-bulk-default` `{mos:"nmos"}`) moves followers; explicit Substrate
  Nets stay. A substrate on ground beside a negative supply warns
  `PDK_SUBSTRATE_ABOVE_NEGATIVE_SUPPLY` once per Cell.

#### SKY130 MOS sizing

- DMOS takes `sky130_fd_pr__nfet_g5v0d16v0`/`pfet_g5v0d16v0` or a 20 V device.
  20 V devices take only `m` and always print their channel: `nfet_20v0` L 2.95
  W 29.41; `nfet_20v0_nvt` L 1.5 W 30; `nfet_20v0_zvt` L 5 W 30; `pfet_20v0`
  L 0.5 W 30 (µm).
- 16 V sizes exist only at N: W 5, 20 or 50–60 at L 0.7, or W 5 or 20 at L 2.2;
  P: W 5–50 at L 0.66 or 2.16 (µm, total W). Edits or opening that leave another
  numeric size snap minimally (W then L, a just-edited field last, to W 5 and L
  0.7 N / 0.66 P); expressions stay; leftovers warn `REVIEWED_SIZE_UNMODELLED`.
- Other SKY130 MOS limits on Production (W per finger = W/`nf`):

| Device                                    | L from  | L up to  | W per finger from |
| ----------------------------------------- | ------- | -------- | ----------------- |
| `nfet_01v8`, `pfet_01v8`, `nfet_01v8_lvt` | 0.15 µm | 20.2 µm  | 0.42 µm           |
| `pfet_01v8_hvt`                           | 0.15 µm | 20.2 µm  | 0.42 µm           |
| `pfet_01v8_lvt`                           | 0.35 µm | 20.2 µm  | 0.42 µm           |
| `nfet_03v3_nvt`                           | 0.5 µm  | 0.909 µm | 0.42 µm           |
| `nfet_05v0_nvt`                           | 0.9 µm  | 24.99 µm | 0.42 µm           |
| `nfet_g5v0d10v5`, `pfet_g5v0d10v5`        | 0.5 µm  | 20.2 µm  | 0.42 µm           |

- Outside a limit, or L or W per finger over 1 mm on any micrometre-library
  device (a likely unit slip), warns `REVIEWED_SIZE_OUT_OF_RANGE`. Warnings
  never resize; expressions are unchecked; missing values count as defaults.

#### Implicit supplies and MOS bodies

- Extraction keeps B wiring, Cell defaults and `NoConnect`. An unresolved body
  (an import without a fourth node takes the Cell default first) takes the one
  drawn supply of its domain, else the one Net named `VDD` (PMOS) or `VSS`
  (NMOS), else a new `VDD` pin or ground. This read-only projection propagates
  added ports through callers; the deck root keeps `0`; nothing is written back.
  So B never fails `MISSING_PIN_NET`; missing D/G/S is an error.
- A supply that becomes a new Pin reports information `MOS_BODY_DEFAULT_SUPPLY`
  once per supply on the Cell whose bodies took it (Check Report, Agent reads,
  MCP `verify`; gates nothing).
- `MOS_BODY_OTHER_SUPPLY` (information) asks when a default-following or Net-less
  body lands on a supply other than its source's
  ([connectivity](connectivity-and-routing.md#mos-bulk)); wired bodies are never
  reported.
- Ground: a `.subckt` meeting ground carries `VSS` after the author's
  `vdd`-domain ports (else first), with internal `0` read as `VSS`; an author's
  ground pin is kept instead. If `VSS` names another Pin or Net, the pin is `GND`
  (`GND__2`, …) with information `GROUND_PIN_RENAMED`. `groundPin` selects the
  policy and `rootAsTopLevel` the deck Cell (`SIMULATION_DECK_GROUND`); the
  analyzer default keeps `0`.
- Block `VDD`/`VSS` are hidden property terminals. An explicit binding
  (Properties or Agent `circuit_properties` `set-block-supply {target, supply,
  net}`, `net: null` for Auto) wins; Auto takes the one drawn Net of the domain;
  with none drawn, the one Net named `VDD`/`VSS`, else a new `VDD` pin plus
  ground (owner decision); competition blocks with `MISSING_BLOCK_SUPPLY`. Imported VDD hints are not supplies.
- Bodies that never read supplies (ideal amplifiers, adder; SPICE multiplier and
  numeric comparator) tie unbound ports to `0` and never block; the op-amp takes
  no default supply; a `VDD` comparator takes VDD but no ground. Export never
  declares `.global VDD VSS`.
- Reviewed R/C bindings emit terminals and raw geometry; ideal values never
  become geometry. Design export injects no environment library.

### Missing models and values

`MISSING_MODEL_TARGET` and `MISSING_REQUIRED_PARAMETER` block like any error; the
process may author defaults in one undo (Refresh fills only missing ones). Export
never invents an identifier.

### Unfinished drawings

- `DEAD_END_NET`: one per node a single instance pin reaches, except Cell ports,
  globals, `NoConnect` and nodes with authored or imported names.
- `createDesignNetlistExport` reports it without withholding output;
  `unfinishedDrawingDiagnostics` answers fitness: Check Report, panel and
  copy/export refuse on a non-empty answer, and `designExtractsNetlist`
  ([Gallery mark](community-gallery.md#list)) answers `false`.
- Export never omits a device or invents a model beyond the generic cards.

### Netlist panel and copy

- The Netlist button copies in the current format and opens the live panel;
  clipboard rejection leaves selectable code, never a download.
- Source edits (References, targets, printed values) apply as one atomic
  transaction with per-Document revisions; printer locations link caret and
  canvas both ways (never by Reference spelling). Invalid edits keep the draft;
  dirty source is never overwritten (Reload); Copy waits for apply or discard.
- While strict export is blocked the panel shows a read-only draft
  (`createDraftNetlistPreview`) with `?` for missing facts and a draft first
  line; Copy, export and `designExtractsNetlist` never use it.
- The copy/export projection drops the generated title and adds no comments;
  names print exactly as authored (`portCase` only on explicit Agent request);
  SPICE keeps an empty first title line; SCS starts with its language line.
- Blocked output clears the panel and leaves the clipboard unchanged;
  presentation-only edits never change IR or bytes.
- The `SPICE+RNL` and `Spectre+RNL` formats add RNL records and reorder
  generated bodies' ports; they follow [RNL interchange](rnl-interchange.md),
  and the rules above stay those of `SPICE` and `SCS`.

## Persistence boundary

Cell interfaces and instance electrical data persist; device definitions ship
with the Symbol library; IR, names, diagnostics and text are transient; export
preferences are browser-local. Only the current schema is accepted.

## Simulation boundary

- Project-owned external sources are native SPICE or Spectre whose applied
  revision owns both generated dialects; no converted model is stored; edits
  that cannot reverse exactly return `MODEL_SOURCE_EDIT_REQUIRES_OWNER`. Model
  Copy omits the root/testbench and refuses pending drafts.
- [Simulation](simulation.md) composes setup with this projection;
  [execution](simulation-execution.md) owns runs. Structural export is not an
  executable deck.
