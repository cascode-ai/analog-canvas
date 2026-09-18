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

`terminals` stores independently authored Cell-Pin declarations. Canvas `port`
and `port-filled` symbols are Cell Pins: each owns exactly one singleton
declaration through `terminals[].interfaceInstanceIds` and neither emits an
instance line. Cell Pins are available in top and child Documents. A hierarchy
instance uses its bound child Document and the read-only formal projection of
that child's declarations. Ports receive no visible Instance Reference. A Cell Pin uses its
`CellTerminal.name`, such as `Vout`, as its Port Name.
Its bound Annotation may retain same-text RichText formatting, which never
changes emitted names. At extraction, names are grouped case-insensitively;
first occurrence fixes order and spelling, and every member Net maps to that
one emitted formal node. This projection does not merge Base Nets or mutate the
Project. Repeated internal Net naming still uses Net Labels. The copy/export
projection below may then change only the letter case of formal names.

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
`unresolved-subcircuit` binding retains only a master name; export emits it
only as a built-in Analog Block's black-box master call. A PDK may provide
artwork later, but artwork cannot change external invocation into a primitive
or model binding.

Reviewed native-device mappings may source those ordered target terminals from
stable local pins with different names. The released SKY130 resistor maps
`R0/R1/B` from native `1/2/B`; B is a real `Net.terminals` membership edited
only in Properties and never a Symbol pin, Route endpoint, or NoConnect. The
reviewed MIM capacitor maps `C0/C1` from the frozen capacitor pins `1/2`.

`Instance.reference` is the exact ngspice designator. Selecting a reviewed
external target atomically changes `M1/R1/C1` to `XM1/XR1/XC1`; clearing that
target restores the native prefix. Imported X calls are retained unchanged,
and all References remain case-insensitively unique before output. Reviewed
SKY130 `l/w` values are stored canonically as metre-valued SPICE strings and
projected to plain micrometre numbers by extraction for both SPICE and Spectre
output.

External-master parameters are deliberately open: declared formal parameters
provide authoring metadata, requiredness, and defaults, while additional raw
instance keys are retained and emitted. This permits a project to carry
library-specific settings such as `l`, `w`, and `nf` without bundling the
library model or PDK.

## Device definition

Each exportable electrical device Symbol has one reviewed `DeviceDescriptor`
in `packages/devices`. Built-in Analog Blocks instead have a black-box
subcircuit descriptor: a master name and ordered ports, including fixed supply
ports.

[DeviceDescriptor](../../packages/devices/src/contract.ts) owns canonical pin
order, invocation policy, parameter metadata and supported dialects. The
[registry](../../packages/devices/src/registry.ts) supplies reviewed entries.

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
  anonymous allocation and therefore receives no generated-name warning.
- A global Net must have an explicit name.
- The global Net named `0` is the reference node.
- Other global Nets are emitted through the dialect's global declaration and
  are not silently converted to cell ports.
- Except for the established global SPICE ground reference `0`, one Logical
  Net cannot be both a formal Cell Pin and global; that ambiguity blocks export
  until the interface mode or the conflicting owner is changed.
- An unconnected terminal must carry an explicit `NoConnect`; otherwise export
  is blocked. Each explicit `NoConnect` receives one deterministic,
  collision-free exporter-only local node (`NC0001`, `NC0002`, ...), preserving
  fixed device and subcircuit arity without adding a Project Net.
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
analysis, PDK path, or renderer state.

## Printer contracts

Printers are pure functions over a validated Export IR. They cannot access the
Project, Symbol resolver, filesystem, network, or diagnostics repair path.

SPICE `.spi` emits a generated-file/version comment, sorted `.global`
declarations, dependency-first `.subckt`/`.ends` blocks, ordered defaulted
formal parameters, structural device lines, and deterministic continuations.
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
any error remains. The copy/export projection below permits explicit TODO
fields for two omission categories; every other error still prevents printer
invocation and output. Required error coverage includes:

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

Warnings may report generated local Net names or conflicting directions inside
one same-name Formal Port group. They cannot downgrade a missing
electrical fact required for meaningful output.

### Explicit export presets

The export boundary accepts an optional `NetlistExportProfile`. The editor
ships Abstract, SKY130, TSMC 28, TSMC 180, and Custom defaults in a single raw
JSON configuration. The Netlist menu's Configuration… entry opens it in the
right-side Project tools dock, which is separate from Properties. `selected`
chooses the active preset; `format` and `portCase` hold the output choices.
Valid code edits apply immediately, invalid drafts block copying, and browser
preferences are separate from the Project schema. The live Netlist panel edits
the same configuration through compact controls: Format and Process selects;
NMOS, PMOS, R, C, and L target selects for the selected preset, where choosing
a target reloads that family's parameter defaults; a Port-name case toggle; and
a Default action that restores the whole default configuration.

Projection copies the Project and visits only the reachable hierarchy. Abstract
uses ideal R/C/L and generic model names without model cards; SKY130 uses reviewed
external transistor interfaces and ideal R/C by default; TSMC 28 binds MOS
models `nch_ulvt_mac`/`pch_ulvt_mac` with default `l=30n` and renames the
portable MOS `m` to the wrapper's `multi`; TSMC 180 binds `nch`/`pch` with
default `l=180n`, keeps `m`, and binds PNP to `pnp10_5_rpo`; both TSMC presets
keep R/C/L ideal; Custom preserves authored targets. Editable library defaults
are `sky130.lib.spice` section `tt`, `toplevel.scs` section `TOP_TT`, and
`cmn018_gp2a_5v_v1d4_usage.scs` section `tt_lib`; Abstract and Custom have none.
Defaults fill only missing parameters, case-insensitively. Existing source
waveforms and AC intent do not acquire a new DC bias from a fallback.

Strict extraction, simulation, and profiled copy export use actual MOS B
connectivity, including placement-materialized defaults. Without membership or
an explicit NoConnect they report `MISSING_PIN_NET`; polarity and preset substrate
settings do not invent MOS connections. Export preserves declared Cell interfaces
and their ordering in hierarchy calls. It never adds VDD/VSS ports, promotes a
local rail to a formal Pin, or rewrites a Global marker to local. Ground remains
node `0`; it does not imply a VSS interface.

Built-in Analog Blocks retain their library-declared fixed supply names. Such
a name resolves first to an authored named Net in the Cell, and failing that
to the supply the author drew — the Cell's single Net in that power domain, a
`VSS` port therefore sitting on the ground and a `VDD` port on the positive
supply, the same reading a MOS body uses for its fourth node
([connectivity](connectivity-and-routing.md)). The declared name states the
port's role, not a Net spelling the author has to reproduce: nobody names a
Net `VSS` when they have drawn a ground symbol. A Cell with no Net in that
domain, or with more than one, falls back to the Block's own declaration: the
netlist declares a global node of the declared name and reports
`DECLARED_BLOCK_SUPPLY` (warning) naming the Block and the node. That is the
Block's library interface stating what it needs, so it adds no Cell port,
claims no Net in the Document, and changes no membership — the drawing is
untouched and the report says what the netlist declared. When that token is
already some other node in the Cell, declaring it would put two nodes under
one name, so the supply stays missing and `MISSING_BLOCK_SUPPLY` says which
Net holds the spelling. For different supply domains, use an explicit external
definition with the intended terminal mapping.

Explicit physical R/C targets use reviewed W/L parameters, never infer geometry
from an ideal value, and warn when replacing that value. A resistor's existing
substrate connection wins; an absent substrate may use an explicitly configured
existing net or exporter-only ground `0`. Reference or target-interface collisions
block output. Reviewed geometry stays in canonical metres until strict
extraction emits the PDK wrapper's micrometre values in either dialect. Unknown
custom subcircuits and unresolved hierarchy retain their original interfaces and
validation.

Configured library paths and sections are printed as includes outside the pure
IR printer. SCS output remains entirely in `simulator lang=spectre`, including
SKY130; the configured model library is referenced with native Spectre `include`
syntax. This does not convert the model library itself or claim licensed Spectre
qualification. Strict extraction and simulation consumers do not implicitly use
these export presets.

### Incomplete output

`createDesignNetlistExport` permits output when the only errors are
`MISSING_MODEL_TARGET` and `MISSING_REQUIRED_PARAMETER`. It copies the Project,
fills absent model bindings and blank/missing required device parameters with
undefined `TODO_<cell>_<reference>_<field>` identifiers, and requires that copy
to pass strict extraction before printing. Authored electrical identifiers and
expressions are reserved case-insensitively to avoid accidental resolution;
SPICE parameter placeholders use braces and Spectre uses bare identifiers.
The returned structured placeholder list and diagnostics identify incomplete output.
The sidebar and Check Report show that state outside the copied text. The
projection never writes placeholders into the Project or changes simulation readiness.

### Unfinished drawings

A TODO placeholder answers "this value is not bound yet". The opposite
condition — the drawing itself is not finished — is reported as
`DEAD_END_NET`, one per node that a single instance pin reaches. Such a node
is printed once and nothing else in the file ever reaches it, so a simulator
meets a floating node rather than a circuit, and no placeholder can stand in
for a wire nobody drew. Four single-pin nodes are not dead ends and carry no
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
never exports the permissive authoring IR. It cannot omit an invalid device or invent a model definition. Numerical defaults
and the explicit substrate rule belong only to the selected preset above.

The editor's primary Netlist button copies immediately in its current format
(SPICE by default) and opens the live right sidebar. That panel's Format select
chooses the format, which is remembered with the browser-local configuration.
The adjacent menu offers Configuration…, Instances…, Check Report…, and Check
and Save; it has no format choice. Clipboard rejection leaves selectable code
and a status message, without a download fallback.

The copy/export projection removes the strict printer's generated title and
adds no diagnostic, preset, TODO-summary or library comments. It also accepts
an optional `portCase` (`upper` or `lower`), which the editor always supplies
from its remembered choice, uppercase by default. Every formal Port name and
the Cell-local node it owns, subcircuit-call pin names, and external-master
terminal names then take that case; all other Nets keep their spelling. SPICE
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
missing-target error in strict analysis. A structural export may mark its
model `TODO_Main_M1_model` if all other electrical facts are present. Without a selected preset, export must not guess a model. With a preset, the
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

[Simulation source authoring and compilation](simulation.md) compose explicit
environment, source and analysis intent with the electrical projection.
[Execution](simulation-execution.md) owns preparation and runs. Structural
SPICE/Spectre export is not an executable deck and does not infer that setup.
