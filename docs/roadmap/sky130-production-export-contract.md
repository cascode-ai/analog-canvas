# SKY130 Production Export Contract Repair

Status: `proposed; implementation not started`

Primary owners: `packages/devices`, `packages/edit-engine`,
`packages/project-protocol`, `packages/netlist`, `packages/spice`,
`packages/symbols`, `apps/editor`

## Objective

Repair the released schematic-to-SPICE path for a deliberately small reviewed
SKY130 set without replacing the existing Project, external-subcircuit, or
DesignNetlist protocols. The accepted set is the two 1.8 V MOS devices plus
one physical resistor and one physical MIM capacitor:

- `sky130_fd_pr__nfet_01v8`
- `sky130_fd_pr__pfet_01v8`
- `sky130_fd_pr__res_high_po`
- `sky130_fd_pr__cap_mim_m3_1`

The defect is narrower than a new PDK system:

> The repository already represents an external master, ordered connectivity,
> raw instance parameters, and structural X calls. The missing work is to make
> production export use one reviewed binding authority, separate the authored
> reference from the emitted SPICE card designator, and apply the verified
> terminal and parameter-unit projection in both import and export. The
> existing ideal R/C primitives remain separate and unchanged.

This roadmap is the implementation record for that bounded repair. It does not
authorize PDK installation, model-file distribution, simulation profiles, or a
second netlist protocol.

## User-visible outcome

A user inserts the existing NMOS or PMOS symbol, keeps its ordinary MOS
reference such as `M1`, and selects one of the reviewed model-field entries:

- `sky130_fd_pr__nfet_01v8`
- `sky130_fd_pr__pfet_01v8`

The schematic continues to show `M1`. SPICE export emits a legal, reversible
external-subcircuit call:

```spice
XM1 drain gate source bulk sky130_fd_pr__nfet_01v8 l=0.15 w=1 nf=1 m=1
```

Changing back to an ordinary MOS model keeps `M1`. Importing an existing SKY130
X call keeps its external invocation and may use the existing MOS artwork only
when an exact reviewed interface matches. Unknown external calls remain generic
external blocks.

The same interaction applies to the two reviewed physical passives without
adding another Insert flow. A user inserts the existing resistor or capacitor,
keeps the authored reference `R1` or `C1`, and selects the exact reviewed model
in the existing model/target field. Legal SPICE output uses X cards:

```spice
XR1 top bottom vss sky130_fd_pr__res_high_po w=1 l=5.5 mult=1
XC1 top bottom sky130_fd_pr__cap_mim_m3_1 w=5 l=5 mf=1
```

The resistor remains a two-terminal resistive path in the drawing, with a real
third substrate terminal `B`. The MIM capacitor remains a two-terminal
capacitor. Selecting either reviewed target changes its binding and authored
parameter surface; it does not synthesize a scalar resistance/capacitance or
expand PDK-internal parasitics onto the schematic.

## Evidence and current failure

### Upstream contract

The ngspice manual is authoritative for the syntax boundary:

- [ngspice manual, circuit description and subcircuit calls](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf)
  defines `.model`, `.subckt`, `M` device lines, `X` subcircuit calls,
  parameterized calls, geometric `scale`, and the special X-line `m`
  multiplier.
- [SkyWater `nfet_01v8` public wrapper](https://github.com/google/skywater-pdk-libs-sky130_fd_pr/blob/f62031a1be9aefe902d6d54cddd6f59b57627436/cells/nfet_01v8/sky130_fd_pr__nfet_01v8.pm3.spice)
  declares `sky130_fd_pr__nfet_01v8` as `.subckt ... d g s b`, declares its
  public formal parameters, and calls binned internal MOS `.model` cards.
- [SkyWater's runnable 1T1R example](https://github.com/google/skywater-pdk-libs-sky130_fd_pr_reram/blob/main/examples/1T1R/1T1R.spice)
  selects the `tt` library section and calls the public NFET through an X line
  with plain micrometre geometry such as `l=0.15 w=7.0`.
- [open_pdks' SKY130 circuit template](https://github.com/fossi-foundation/open-pdks/blob/main/sky130/irsim/circuit_template.spi)
  follows the same library-selection, X-call, and D/G/S/B convention.
- [SkyWater `res_high_po` public wrapper](https://github.com/google/skywater-pdk-libs-sky130_fd_pr/blob/main/cells/res_high_po/sky130_fd_pr__res_high_po.model.spice)
  declares `.subckt sky130_fd_pr__res_high_po r0 r1 b`, accepts `w`, `l`, and
  `mult`, and delegates the substrate parasitic network to the PDK model.
- [SkyWater `cap_mim_m3_1` public wrapper](https://github.com/google/skywater-pdk-libs-sky130_fd_pr/blob/main/cells/cap_mim_m3/sky130_fd_pr__cap_mim_m3_1.model.spice)
  declares `.subckt sky130_fd_pr__cap_mim_m3_1 c0 c1 w=1 l=1 mf=1` and owns
  the capacitance and contact-resistance calculation.
- [SkyWater's MIM device documentation](https://github.com/google/skywater-pdk/blob/main/docs/rules/device-details.rst)
  identifies `c0` and `c1` as the two capacitor terminals and describes the
  model as a subcircuit rather than a primitive scalar C card.

The public name `sky130_fd_pr__nfet_01v8` is therefore a PDK device/model name
in product vocabulary but an external `.subckt` master in ngspice grammar. The
internal `sky130_fd_pr__nfet_01v8__model.*` cards are PDK implementation
details and are not schematic targets.

### Repository state before this repair

The necessary facts exist, but different paths interpret them differently:

```text
Project authoring
  -> exact external definition is created
  -> Project reference is changed from M<n> to X<n>

Design export used by the editor
  -> analyzeDesignNetlist(...)
  -> printDesignNetlist(...)
  -> raw Project parameters are printed

Standalone SKY130 binder used by tests
  -> converts M<n> to XM<n>
  -> converts SI-suffixed l/w to plain micrometre values
  -> is not called by the editor's production export command
```

Concrete evidence:

- `packages/edit-engine/src/hierarchy-planner.ts` creates the reviewed
  external definition but allocates a hierarchy/X reference.
- `packages/devices/src/reference.ts` treats the invocation kind as the
  authority for the persisted reference prefix.
- `packages/netlist/src/sky130.ts` contains the micrometre conversion and
  `M1 -> XM1` projection, but `bindSky130Netlist()` is reached only by its test
  corpus.
- `apps/editor/src/features/editor-shell/editor-export-commands.ts` calls
  `printDesignNetlist(format, ir)` directly.
- `packages/netlist/src/printers.ts` prints `instance.reference` verbatim; it
  does not derive the SPICE card designator from invocation semantics.
- `packages/symbols/src/pdk-registry.ts` recognizes every four-terminal name
  matching broad `sky130_fd_pr__nfet_*` and `sky130_fd_pr__pfet_*` regular
  expressions even though the reviewed authoring suggestions contain only the
  standard 1.8 V pair.
- automatically created reviewed definitions have an empty formal-parameter
  list, so the Project does not demonstrate the public wrapper signature.
- `apps/editor/src/features/component-insert/component-parameters.ts` removes
  `m` from the external MOS property set without establishing a replacement
  semantic.

### Concrete reproduction

The user Project `Folded-Cascode Op Amp (PMOS Cascode Loads).icproj.json`
contains ten native MOS symbols bound to the two reviewed SKY130 external
masters. The old authoring flow persisted references `X1` through `X10` and
parameters `l=150n`, `w=1u`, `nf=1`, `m=1`.

Current production export includes lines such as:

```spice
X1 N0004 Vb3 VDD VDD sky130_fd_pr__pfet_01v8 l=150n m=1 nf=1 w=1u
```

The repaired production path must emit the electrically equivalent target
representation:

```spice
XM1 N0004 Vb3 VDD VDD sky130_fd_pr__pfet_01v8 l=0.15 w=1 nf=1 m=1
```

Topology, Net names, global projection, Cell ports, model selection, and
physical device dimensions do not change.

## Scope

### In scope

- Exact reviewed bindings for the standard SKY130 1.8 V NFET and PFET.
- One exact physical-resistor binding for `sky130_fd_pr__res_high_po` with
  ordered `R0/R1/B` connectivity and reviewed `w/l/mult` parameters.
- One exact physical-capacitor binding for `sky130_fd_pr__cap_mim_m3_1` with
  ordered `C0/C1` connectivity and reviewed `w/l/mf` parameters.
- Reuse of the existing resistor and capacitor artwork, with a resistor
  substrate-pin presentation that never erases the third electrical node.
- Properties and batch editing for the reviewed R/C geometry and substrate
  selection without deriving geometry from the generic scalar `value`.
- Persisted schematic reference independent of emitted SPICE invocation kind.
- A deterministic emitted-reference projection and collision diagnostic.
- Bidirectional parameter conversion for the reviewed parameters whose units
  are established.
- Distinct `nf`, `m`, and `mult` semantics.
- Exact-match native MOS presentation on import without changing X invocation.
- Compatibility handling for Projects created by the current SKY130 UI.
- One production path shared by editor export and lower-level contract tests.
- Correction or explicit relabeling of inconsistent SKY130 fixtures.
- Specifications, ADRs, user documentation, and test contracts needed to make
  the boundary durable.

### Out of scope

- Installing, downloading, copying, or discovering a PDK.
- Persisting an absolute PDK path in a Project.
- Emitting `.lib`, corner, stimulus, analysis, temperature, solver options, or
  `.end` in the structural design netlist.
- Defining foundry BSIM coefficients or exposing them in Properties.
- Binding a generic `nch`/`pch` design to SKY130 at simulation time.
- Supporting every `sky130_fd_pr__*` device family.
- Supporting other resistor variants, including `res_xhigh_po`, fixed-width
  precision variants, diffusion resistors, and generic metal/poly resistors.
- Supporting `cap_mim_m3_2`, varactors, VPP capacitors, or any capacitor with
  additional body/shield terminals.
- Supporting SKY130 diodes, BJTs, inductors, RF/HV/ESD devices, or isolated
  MOS variants. These families are explicitly deferred rather than inferred
  from a common name prefix or similar artwork.
- Inferring a public interface from a name prefix or regular expression.
- Changing the Insert shortcut or adding a second SKY130-specific component
  insertion flow.
- Claiming Spectre-model compatibility from ngspice evidence. The ngspice
  projection in this target must not silently become a global PDK rule.

## Frozen terminology and authorities

| Fact | Authority | Example |
|---|---|---|
| Schematic presentation | reviewed symbol mapping | existing `nmos`, `resistor`, or `capacitor` artwork |
| Authored reference | `Instance.reference` | `M1`, `R1`, or `C1` |
| Invocation kind | typed netlist binding | `external-subcircuit` |
| Emitted SPICE reference | dialect projection | `XM1`, `XR1`, or `XC1` |
| Public master | external definition/reviewed binding | `sky130_fd_pr__res_high_po` |
| Ordered public terminals | reviewed binding checked against external definition | `D G S B`, `R0 R1 B`, or `C0 C1` |
| Connectivity | `Net.terminals` by canonical pin name | `D -> N0001` |
| Canonical instance values | `Instance.netlist.parameters` | `l=150n`, `w=1u` |
| Target parameter spelling and units | reviewed binding adapter | `l=0.15`, `w=1` |
| PDK internal coefficients | external model library | BSIM cards and bins |
| Corner and analysis | future simulation profile | `tt`, `.op` |
| Installed library path | future environment resolver | machine-local path |

Presentation may change from a generic box to the native MOS artwork, but it
must never change an imported X binding into a primitive M binding.

## Minimal reviewed binding contract

The electrical portion belongs with reviewed device semantics, not in the
symbol-only registry. The exact type and module split may follow existing
package dependency rules, but one authoritative record must be consumed by
authoring, import, extraction, and export.

The minimum facts are:

```typescript
interface ReviewedExternalDeviceBinding {
  id:
    | "sky130-nfet-01v8"
    | "sky130-pfet-01v8"
    | "sky130-res-high-po"
    | "sky130-cap-mim-m3-1";
  libraryId: "sky130_fd_pr";
  masterName:
    | "sky130_fd_pr__nfet_01v8"
    | "sky130_fd_pr__pfet_01v8"
    | "sky130_fd_pr__res_high_po"
    | "sky130_fd_pr__cap_mim_m3_1";
  invocationKind: "external-subcircuit";
  deviceClass: "mos" | "resistor" | "capacitor";
  terminalOrder:
    | readonly ["D", "G", "S", "B"]
    | readonly ["R0", "R1", "B"]
    | readonly ["C0", "C1"];
  symbolPinMap: Readonly<Record<string, string>>;
  authoredReferencePrefix: "M" | "R" | "C";
  spiceCardPrefix: "X";
  parameterBindings: readonly ReviewedParameterBinding[];
}
```

Do not persist this entire record per instance. A stable exact binding lookup
and the existing external definition are sufficient. Persist an additional
binding ID only if implementation proves that exact master and interface
cannot identify the contract safely.

`packages/symbols` consumes the reviewed binding to choose `nmos` or `pmos`
presentation or reuse the existing passive artwork. It does not own invocation
or parameter-unit semantics.

`terminalOrder` is the public target order; it does not authorize renaming the
stable pins already used by the native symbols. The reviewed mappings are:

| Native stable pin | Reviewed target terminal |
|---|---|
| MOS `D/G/S/B` | `D/G/S/B` |
| resistor `1/2/B` | `R0/R1/B` |
| capacitor `1/2` | `C0/C1` |

## Reviewed physical-resistor contract

`sky130_fd_pr__res_high_po` is not an ideal scalar resistor and must not be
forced through the current `R n1 n2 value` contract.

- Invocation is `external-subcircuit` with exact target terminal order
  `r0 r1 b`.
- The authored reference remains in the resistor domain (`R1`); SPICE emission
  derives `XR1` without mutating or renumbering the Project instance.
- The existing resistor artwork and stable endpoint pins `1/2` are reused.
  The reviewed presentation adds an electrically real side terminal `B` whose semantic
  role is `substrate`, not a third resistor-current endpoint and not MOS base
  or bulk by spelling alone.
- Native pins `1` and `2` remain the series insertion pair and map to target
  `R0` and `R1`. `B` must never participate in conductor splicing or replace
  either resistor endpoint.
- Import preserves the third source node exactly. Export always emits it,
  whether its visual connection is expanded or compact.
- New authoring exposes `B` until the user explicitly connects it by wire or
  chooses an existing Net in a `Body/Substrate Net` property. No Net-name rule
  silently chooses VSS/VDD and no unconfigured body default is invented.
- A compact view may hide the side pin only after `B` has resolved Net
  membership; Properties must still show the selected Net and offer an
  explicit-pin action. An explicit wire is ordinary electrical wiring and
  takes precedence over compact presentation.
- An unresolved `B` is an export-blocking missing-terminal diagnostic. It is
  not exported as ground, one resistor endpoint, or an empty node.
- The reviewed authored parameters are geometry `w`, `l`, and wrapper
  multiplier `mult`. Generic resistor `value` is not converted into geometry
  and is not emitted while this binding is selected.
- Internal head/body resistance, mismatch, temperature effects, and substrate
  parasitic capacitors remain entirely inside the loaded SKY130 model. The
  editor neither calculates them nor persists synthetic component instances.

The initial target deliberately does not introduce a general PDK substrate or
well-domain protocol. A later convenience target may add explicit Document
defaults when more than one reviewed body-terminal family justifies that
shared concept; it must not reuse MOS-only metadata accidentally.

## Reviewed physical-capacitor contract

`sky130_fd_pr__cap_mim_m3_1` is a two-terminal physical MIM capacitor wrapper,
not a primitive `C n1 n2 value` card.

- Invocation is `external-subcircuit` with exact target terminal order
  `c0 c1`.
- The authored reference remains in the capacitor domain (`C1`); SPICE
  emission derives `XC1` without changing the Project reference.
- Existing capacitor artwork and stable pin `1/2` top/bottom plate semantics
  are reused. The reviewed mapping is exact: pin `1`/top plate -> `C0`, pin
  `2`/bottom plate -> `C1`.
- The authored parameters are geometry `w`, `l`, and multiplicity `mf`.
  Generic scalar capacitance `value` is not converted to area and is not
  emitted while this binding is selected.
- Capacitance, process/corner scaling, mismatch, and contact resistance are
  calculated by the external SKY130 model. They are not copied into Project
  JSON or expanded into visible internal R/C elements.
- Switching between generic C and this reviewed target preserves reference and
  connectivity but requires a complete target-appropriate parameter set. The
  editor never guesses `w/l` from a previously authored capacitance.

`cap_mim_m3_2`, varactors, VPP capacitors, and body/shield-bearing capacitor
families require separate exact bindings and remain deferred.

## Reference contract

### New authoring

- An ordinary MOS instance starts and remains in the MOS `M` reference domain.
- Selecting a reviewed SKY130 external target changes only its typed binding.
- Switching between ordinary MOS and reviewed SKY130 does not renumber the
  instance.
- Ordinary resistor and capacitor instances likewise remain in their authored
  `R` and `C` reference domains when the reviewed physical target is selected
  or removed.
- Batch annotation and clipboard operations use the authored reference policy,
  not the emitted SPICE card prefix.

### SPICE emission

- The printer must not decide invocation kind by inspecting the first
  character of `Instance.reference`.
- Reviewed SKY130 external instances with authored references `M1`, `R1`, and
  `C1` emit `XM1`, `XR1`, and `XC1` respectively.
- An imported external instance whose preserved reference is already a valid X
  identifier remains unchanged; it never becomes `XX...`.
- The derived emitted reference participates in case-insensitive per-Cell
  uniqueness validation. If two authored references collapse to one emitted
  identifier, export stops with a stable diagnostic instead of renaming one.

### Import

- The source card letter remains authoritative. An imported X call stays an
  external-subcircuit binding.
- Source reference spelling is retained for source round-trip unless a proven
  compatibility migration applies to an old UI-authored Project.
- Native MOS presentation is an optional reviewed view of the external
  binding, not a binding conversion.

## Parameter contract

### Canonical versus target representation

For a newly authored or newly imported reviewed SKY130 MOS, resistor, or MIM
capacitor, the Project stores the editor's canonical values. Import converts
target-native values to this representation; export performs the inverse
conversion.

The first reviewed conversions are:

| Semantic | Project representation | SKY130 ngspice call |
|---|---|---|
| channel length | SPICE length in metres, suffix allowed | plain micrometre number under the reviewed library convention |
| channel width | SPICE length in metres, suffix allowed | plain micrometre number under the reviewed library convention |
| finger count | dimensionless `nf` | `nf` |
| parallel identical-device multiplier | dimensionless `m` | ngspice X-line special `m` |
| SKY130 wrapper multiplier | independent target-native `mult` | wrapper formal `mult` |
| resistor width and length | SPICE lengths in metres, suffix allowed | `w/l` as plain micrometre numbers |
| resistor multiplicity | dimensionless `mult` | wrapper formal `mult` |
| MIM width and length | SPICE lengths in metres, suffix allowed | `w/l` as plain micrometre numbers |
| MIM multiplicity | dimensionless `mf` | wrapper formal `mf` |

Examples:

```text
Project l=150n -> target l=0.15
Project w=1u   -> target w=1
Project nf=4   -> target nf=4
Project m=2    -> target X-line m=2
Project mult=2 -> target wrapper formal mult=2
Project resistor l=5.5u -> target l=5.5
Project MIM w=5u l=5u mf=2 -> target w=5 l=5 mf=2
```

`m`, `nf`, `mult`, and `mf` are never aliases. In particular, do not implement
`m -> mult`, `m -> nf`, or `m -> mf`.

The public wrapper also declares `ad`, `as`, `pd`, `ps`, `nrd`, `nrs`, `sa`,
`sb`, and `sd`. This target must preserve explicitly imported overrides. It
must not invent unit conversion for them until the binding declares and tests
that conversion. Unsupported or unverified manual parameters remain advanced
raw overrides with a clear unverified status; they do not require one new
Project field per PDK parameter.

### Expression handling

Numeric unit conversion may operate only on values the adapter can parse
without changing meaning. Expressions such as `{LMIN*2}` cannot be converted
by evaluating them in the exporter. Until a portable parameter/unit contract
exists, a reviewed SKY130 instance with an expression requiring unit
conversion must produce a diagnostic rather than a plausible but unverified
number.

### Dialect boundary

The plain-micrometre conversion is verified for the SKY130 ngspice-facing
wrapper convention. Do not apply it to every PDK or every dialect. Spectre
output remains outside this repair's evidence boundary; implementation must
either retain its prior structural behavior or report an explicit unsupported
binding/dialect combination, but must not silently reuse ngspice-only
assumptions.

## Compatibility with existing Project files

The current saved format already contains authored UI Projects where selecting
SKY130 changed `M<n>` to `X<n>`. Compatibility must be deliberate.

### Safe reference migration

An old reference `X<n>` may migrate to `M<n>` only when all of the following
are true:

1. the instance uses native `nmos` or `pmos` presentation;
2. it binds an external definition whose name is exactly one of the two
   reviewed masters;
3. the external interface is exactly D/G/S/B in that order;
4. the instance has no source-import provenance requiring exact X spelling;
5. `M<n>` does not collide with another authored reference.

Anything else is retained. A collision or ambiguous origin is reported rather
than silently renumbered.

The folded-cascode reproduction satisfies these conditions: its SKY130
instances have native MOS symbols, exact reviewed definitions, no import
provenance, and `X1` through `X10`. Loading it after the migration should yield
authored `M1` through `M10` and emitted `XM1` through `XM10`.

### Legacy parameter ambiguity

Existing external parameter maps do not explicitly say whether a bare value
was authored in canonical SI or imported in target-native micrometres. Do not
globally reinterpret every string.

- Explicit SI suffixes such as `150n` and `1u` are safe canonical evidence for
  the current editor-authored flow.
- Proven imported SKY130 source values may be normalized through import
  provenance.
- A bare legacy value without sufficient provenance is ambiguous. Preserve it
  and require review or emit a stable compatibility diagnostic; do not guess
  whether `1` meant one metre or one micrometre.

New imports must normalize recognized l/w values immediately so new Project
files do not carry this ambiguity forward. Unknown external masters continue
to own target-native raw parameters and do not use the SKY130 adapter.

## Production pipeline after repair

One path must own the released behavior:

```text
CircuitProject
  -> validate exact typed binding and authored reference
  -> extract canonical DesignNetlistIR with invocation semantics
  -> apply the reviewed format-specific parameter/reference projection
  -> validate emitted identifiers and target parameters
  -> print structural SPICE
```

The exact placement of projection in extraction versus printing is an
implementation choice, but these invariants are not:

- editor export and package tests call the same public operation;
- printers receive enough typed information to distinguish primitive MOS from
  external-subcircuit invocation;
- no code infers invocation from a name regex or reference prefix;
- no second extraction is introduced;
- generic external calls do not pass through a SKY130 adapter;
- projection failure is a diagnostic and blocks download.

The existing `bindSky130Netlist({ modelByTarget })` mixes two concerns:

1. projecting an explicitly selected reviewed external target for design
   export; and
2. replacing a generic design model such as `nch` with a PDK at simulation
   time.

Only the first belongs in this target. Move its reusable conversion into the
reviewed production binding or replace the helper. Leave generic simulation
binding out of the design-export contract.

## Required implementation targets

### WP-SKY1 - Exact binding authority

- Replace the broad SKY130 NFET/PFET regex rules with two exact reviewed
  entries.
- Add exact entries for `res_high_po` and `cap_mim_m3_1`; do not add a family
  regex for similar resistor or capacitor names.
- Put invocation, terminal order, reference projection, formal-parameter
  knowledge, and parameter conversion under one electrical authority.
- Let `packages/symbols` derive only the native presentation mapping.
- Reject or retain generic presentation for unreviewed names, incompatible
  terminal counts, reordered terminals, and explicit block presentation.

Primary files:

- `packages/symbols/src/pdk-registry.ts`
- `packages/symbols/src/hierarchical-block.ts`
- reviewed device definitions under `packages/devices/src/`
- related symbol and device tests

### WP-SKY2 - Authored and emitted reference separation

- Stop `planSetMosModelTarget()` from allocating a hierarchy reference.
- Keep the MOS-authored reference when changing binding.
- Make clipboard and batch-reference logic follow authored presentation policy.
- Extend export IR or its typed metadata so SPICE emission derives `XM1`
  without mutating the Project.
- Validate derived emitted-reference collisions.
- Apply the same authored/emitted split to reviewed `R -> XR` and `C -> XC`
  projections without changing generic R/C references.

Primary files:

- `packages/edit-engine/src/hierarchy-planner.ts`
- `packages/devices/src/reference.ts`
- `packages/edit-engine/src/reference-batch-planner.ts`
- `apps/editor/src/features/clipboard/clipboard.ts`
- `packages/netlist/src/ir.ts`
- `packages/netlist/src/extract.ts`
- `packages/netlist/src/printers.ts`

### WP-SKY3 - Bidirectional parameter projection

- Normalize reviewed SKY130 l/w values during import.
- Convert canonical l/w to target micrometre values during SPICE export.
- Preserve `nf`, emit ngspice X `m`, and retain independent wrapper `mult`.
- Preserve other explicit public overrides without pretending their units were
  reviewed.
- Normalize and project reviewed resistor `w/l/mult` and MIM `w/l/mf` without
  treating any multiplier as an alias.
- Keep generic R/C scalar `value` outside the physical-device parameter map;
  no resistance-to-geometry or capacitance-to-area solver is introduced.
- Reject non-convertible required expressions with a stable diagnostic.
- Route the editor download command through this production operation.

Primary files:

- `packages/spice/src/importer.ts`
- `packages/netlist/src/sky130.ts` or its reviewed replacement
- `packages/netlist/src/extract.ts`
- `packages/netlist/src/printers.ts`
- `apps/editor/src/features/editor-shell/editor-file-commands.ts`
- `apps/editor/src/features/editor-shell/editor-export-commands.ts`
- `apps/editor/src/features/component-insert/component-parameters.ts`
- `apps/editor/src/features/properties/property-edit-planner.ts`

### WP-SKY4 - Compatibility and Project persistence

- Add the narrowly qualified old-X-reference migration.
- Handle legacy parameter representation only when evidence is sufficient.
- Keep imported source reference/provenance intact.
- Do not add PDK paths, corner, or model coefficients to Project schema.

Primary files:

- `packages/project-protocol/src/previous-to-current.ts`
- a focused Project migration module if the existing migration structure
  requires one
- `packages/project-protocol/src/*migration.test.ts`
- `packages/model` only if a proven missing semantic fact cannot be represented
  by the current typed binding

### WP-SKY5 - Fixtures and documentation

- Correct the 14 SKY130 M calls in
  `netlists/phase-9-heldout-differential-ring-8stage/circuit.spi` and the 18 in
  `netlists/phase-9-heldout-chopper-afe-8ch/circuit.spi`, or deliberately
  rename them to generic primitive models if those frozen fixtures are not
  intended to claim SKY130 syntax.
- Retain their topology-only disclaimers; do not claim electrical performance.
- Add a minimal reviewed conformance corpus based on the pinned official
  interface and example. Do not copy or fabricate foundry coefficients.
- Label structural fixtures separately from runnable simulation decks.
- Update the accepted contracts that currently conflate external invocation
  with persisted X reference.

Primary files:

- `netlists/phase-9-heldout-differential-ring-8stage/`
- `netlists/phase-9-heldout-chopper-afe-8ch/`
- `packages/spice/src/corpus.test.ts`
- `packages/netlist/src/current-contract.test.ts`
- `docs/adr/0029-external-subcircuit-definition-protocol.md`
- `docs/specs/netlist-export.md`
- `docs/user/spice-compatibility.md`
- `docs/agent/knowledge/pdk-and-symbols.md`

### WP-SKY6 - Physical resistor and MIM capacitor authoring

- Reuse the existing resistor and capacitor Insert actions and artwork; model
  selection changes binding instead of creating a parallel PDK palette.
- Add the exact native `1/2/B` to target `R0/R1/B` resistor mapping while
  retaining native pins `1/2` as the only legal series-insertion pair.
- Add a routeable substrate side pin and `Body/Substrate Net` property. Compact
  presentation is allowed only after the B terminal has actual Net membership.
- Keep an explicit substrate Route ordinary and visible; do not extend the
  MOS-only dashed-bulk convention by spelling coincidence.
- Add the exact capacitor top/bottom to `C0/C1` mapping without creating a
  third terminal or calculated-capacitance field.
- Give reviewed physical passives their geometry parameter editors and batch
  editing while retaining generic `value` for ordinary R/C devices.
- Prove imported and newly authored R/C instances reach the same production
  export path as the MOS binding.

Primary files:

- reviewed device definitions under `packages/devices/src/`
- resistor/capacitor variants under `packages/symbols/`
- `packages/edit-engine/src/` terminal and binding planners
- `packages/spice/src/importer.ts`
- `packages/netlist/src/`
- `apps/editor/src/features/component-insert/`
- `apps/editor/src/features/properties/`
- affected route, flightline, and series-placement tests

## Acceptance matrix

| Scenario | Required result |
|---|---|
| Insert NMOS `M1`, select reviewed NFET | Project remains `M1`; binding becomes reviewed external |
| Export that instance | `XM1 D G S B sky130_fd_pr__nfet_01v8 ...` |
| Switch reviewed NFET back to ordinary MOS | reference remains `M1`; connectivity unchanged |
| Import official-style `Xn ... nfet_01v8 l=0.15 w=1` | binding remains external; native NMOS presentation is allowed; canonical l/w are restored |
| Re-export the imported call | same electrical target, D/G/S/B order, and target-equivalent parameters |
| Insert resistor `R1`, select reviewed `res_high_po` | reference remains `R1`; binding becomes external; native `1/2/B` maps to target `R0/R1/B` |
| Leave reviewed resistor B unresolved | stable export-blocking missing-terminal diagnostic; no guessed VSS/VDD |
| Connect reviewed resistor B to VSS | `XR1 r0-net r1-net VSS ... w/l/mult`; native `1/2` remain the series path |
| Import `XR... r0 r1 b res_high_po` | exact third-node connectivity is retained; native resistor presentation is allowed |
| Insert capacitor `C1`, select reviewed `cap_mim_m3_1` | reference remains `C1`; exact C0/C1 mapping and w/l/mf editor are used |
| Export reviewed MIM capacitor | `XC1 c0-net c1-net sky130_fd_pr__cap_mim_m3_1 w=... l=... mf=...` |
| Switch generic R/C to reviewed physical target | reference and connectivity stay stable; scalar value is not converted into geometry |
| Re-open reviewed R/C Project | no model-internal parasitic R/C elements or calculated values appear in Project JSON |
| Enter an unreviewed `sky130_fd_pr__nfet_*` name | no automatic native mapping or X conversion |
| Enter an unreviewed `sky130_fd_pr__res_*` or `cap_*` name | no family inference; generic external binding/presentation is retained |
| Import a generic unknown X master | generic external block and raw parameter round-trip |
| Set `nf=4 m=2 mult=3` | all three remain distinct in emitted output |
| Two authored references derive the same SPICE identifier | export-blocking collision diagnostic |
| Export folded-cascode legacy Project | `XM1...XM10`, `l=0.15 w=1`, unchanged topology and Nets |
| Export structural SPICE | no `.lib`, corner, analysis, stimulus, absolute path, or `.end` is invented |
| Export unrelated primitive MOS | existing M-card behavior and SI-suffixed values remain unchanged |
| Export existing global/unnamed Nets | current VDD/0 and deterministic generated-Net behavior remains unchanged |

## Required tests

Keep one primary owner per behavior and one browser test only for production
wiring that lower layers cannot prove.

### Unit and module contracts

- exact binding accepts only the two reviewed names and exact D/G/S/B order;
- resistor binding accepts only exact `res_high_po`, maps stable `1/2/B` to
  target R0/R1/B, and preserves B as ordinary Net membership;
- capacitor binding accepts only exact `cap_mim_m3_1` with C0/C1 order;
- import preserves X invocation while applying native presentation;
- MOS, resistor, and MIM l/w import/export conversions are inverse over
  supported numeric forms;
- unknown suffixes and required non-convertible expressions fail closed;
- `nf`, `m`, and `mult` remain independent;
- resistor `mult` and capacitor `mf` remain independent from MOS multipliers;
- Project reference policy remains M for reviewed native MOS presentation;
- Project reference policy remains R/C for reviewed passive presentation;
- SPICE emitted reference projection produces `XM1`, `XR1`, and `XC1` and
  detects collisions;
- reviewed resistor B cannot splice a conductor, disappear from export, or
  acquire a Net from its name;
- reviewed MIM never derives w/l from scalar capacitance or persists
  model-internal contact resistance/capacitance;
- generic external raw parameters remain unchanged;
- legacy reference migration is narrowly qualified and collision-safe;
- legacy ambiguous values are not silently reinterpreted;
- the complete folded-cascode expected netlist is covered as a production
  contract fixture.

### Editor production wiring

- Selecting a suggestion in the existing Model field retains the displayed
  reference and all D/G/S/B connectivity.
- Selecting reviewed resistor/capacitor suggestions retains R/C references,
  uses the existing Insert actions, and exposes only the reviewed properties.
- Wiring or selecting the resistor substrate Net resolves B; leaving it
  unresolved blocks the download with the same lower-level diagnostic.
- File/Export SPICE uses the same reviewed projection as package tests.
- Switching back restores ordinary model binding without renumbering.

### Regression protection

- SPICE import/export round-trip outside SKY130;
- Spectre structural export is not accidentally given ngspice-only units;
- Net naming and global projection;
- clipboard and batch annotation;
- Project save/open compatibility;
- unreviewed external-block rendering.

## Expected validation surface

Before implementation, each work package runs gate planning for its owned
paths. The completed branch is cross-module and is expected to select the
conservative delivery path.

Focused development checks should include the affected tests under:

```text
packages/devices
packages/symbols
packages/edit-engine
packages/project-protocol
packages/spice
packages/netlist
apps/editor
```

At minimum, every target runs `git diff --check`, its focused
`pnpm test:local` tests, and the gate commands selected from the actual diff.
Any implementation commit carries the required `Test-Impact` trailer. A
mainline delivery follows the repository's full delivery policy and waits for
all required GitHub checks.

## Explicitly rejected approaches

- Replacing the current Project/netlist protocols with a general PDK schema.
- Treating every `sky130_fd_pr__nfet_*` or `pfet_*` as the same four-terminal
  interface.
- Treating every resistor-looking or capacitor-looking SKY130 name as the
  reviewed `res_high_po` or `cap_mim_m3_1` interface.
- Dropping, grounding, or joining `res_high_po.B` from a name-based guess.
- Reusing the MOS-only bulk route/binding special case for a resistor merely
  because both terminals are spelled `B`.
- Converting generic resistance/capacitance values into guessed physical
  geometry or copying PDK-internal parasitic elements into the Project.
- Using the visual symbol or model-name prefix to decide M versus X.
- Persisting X as the user's MOS reference merely because SPICE requires an X
  card.
- Mapping `m` to `nf` or `mult`.
- Applying micrometre conversion to every external subcircuit, PDK, or dialect.
- Invoking internal binned SKY130 `.model` names directly.
- Adding a PDK path, corner, or `.lib` line to canonical structural export.
- Keeping a test-only SKY130 binder while production export follows another
  path.
- Silently guessing the unit of an ambiguous legacy bare value.

## Exit gate

This repair is complete only when all of the following are demonstrated:

1. the folded-cascode Project exports the expected `XM1...XM10` structural
   calls with target-native `l=0.15 w=1` and unchanged connectivity;
2. new authoring keeps `M` references through SKY130 selection and removal;
3. official-style SKY130 import/export is electrically equivalent under the
   reviewed public interface;
4. reviewed `res_high_po` import/new authoring/export preserves R0/R1/B,
   requires an explicit B Net, and emits w/l/mult without expanding the model;
5. reviewed `cap_mim_m3_1` import/new authoring/export preserves C0/C1 and
   emits w/l/mf without inventing a scalar capacitance;
6. no broad SKY130 name rule remains in the released mapping path;
7. editor export and package tests exercise the same production projection;
8. generic external calls and unrelated primitive devices retain their
   existing behavior;
9. accepted specs and ADRs agree with the implementation; and
10. required local and remote delivery gates are green.
