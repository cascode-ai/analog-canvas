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

External-master parameters are deliberately open: declared formal parameters
provide authoring metadata, requiredness, and defaults, while additional raw
instance keys are retained and emitted. This permits a project to carry
library-specific settings such as `l`, `w`, and `nf` without bundling the
library model or PDK.

## Device definition

Each exportable electrical device Symbol has one reviewed `DeviceDescriptor`
in `packages/devices`. Built-in Analog Blocks instead have a black-box
subcircuit descriptor: a master name and ordered ports, including fixed supply
ports. The logic Symbols — gates, buffer, inverter, adder, multiplier and the
D flip-flops — are Blocks on that same contract: the drawing says what the
block is and which nodes it meets, and the model behind the master name is
the reader's to supply. Their ports follow the Symbol's own pins, a clock or
reset counting as an input and a complement as an output, and they declare
the same fixed supplies so every Block writes a card of the same shape.

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

Warnings may report generated local Net names or conflicting directions inside
one same-name Formal Port group. They cannot downgrade a missing
electrical fact required for meaningful output.

### One electrical extraction authority

Live preview, clipboard copy, downloaded design netlists and Canvas-generated
simulation circuit files all call the same strict extractor on the same
persisted Project bindings. No output surface applies a browser-local process
profile, replaces a model/subcircuit master, changes an invocation kind, fills
device parameters or renumbers an Instance before extraction. An authored
external-subcircuit remains an `X` call everywhere and an authored primitive MOS
remains an `M` card everywhere.

Netlist configuration stores `format`, `portCase`, the selected process and
editable device templates for Abstract, SKY130, TSMC 28, TSMC 180 and Custom.
The editor works in SKY130 until told otherwise, and a native device placed
while a process is selected is bound to that process's model as part of the
placement, so a drawn circuit exports as that process rather than with missing
model fields.
Format and case are output preferences. Process/device selection is an
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
subcircuit is left reaching for the global reference under another name.

The one Cell a deck prints as its own top-level cards keeps node `0`: there the
deck is the outside, and its calls carry that `0` into each child's `VSS` pin.
So a simulated deck and a handed-out netlist share the same subcircuits, and
only the outermost level differs. `groundPin` selects the policy and
`rootAsTopLevel` names which Cell is the deck (`SIMULATION_DECK_GROUND` pairs
them for every simulation surface). The analyzer's own default keeps node `0`,
which is what an imported deck round-trips to and what an Agent Snapshot
reads.

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

Persisted reviewed physical R/C bindings emit their declared terminals and raw
geometry; an ideal value is never reinterpreted as physical geometry during
export. Reviewed geometry stays in canonical metres until strict extraction
emits a wrapper's required units in either dialect. Unknown custom subcircuits
and unresolved hierarchy retain their original interfaces and validation.
Design-netlist export adds no model-library include. Libraries, sections and
corners belong to authored simulation source and its selected execution Profile.

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
never exports the permissive authoring IR. It cannot omit an invalid device or invent a model definition. Numerical defaults
and the explicit substrate rule belong only to the selected preset above.

The editor's primary Netlist button copies immediately in its current format
(SPICE by default) and opens the live right sidebar. That panel's Format select
chooses the format independently of the adjacent Process selector. The compact
NMOS/PMOS/R/C/L selectors apply their target to that device family. Ideal R/C/L
remain the default; selecting a reviewed physical passive uses its geometry,
not a numerical conversion of an ideal resistance/capacitance/inductance.
Authored W/L and values survive process changes, and reviewed SKY130 calls use
the existing canonical unit/interface conversion. TSMC 28 maps `m` to `multi`;
switching back restores `m`. Process selection preserves names and stable
instance IDs; dialect naming happens only during extraction. Custom external
blocks keep their own interfaces. Default restores the mapping the editor starts
in and output preferences, without overwriting authored parameter values. A
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
spelling, which may repeat across Cells.
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
adds no diagnostic, preset or library comments. It also accepts
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

[Simulation source authoring and compilation](simulation.md) compose explicit
environment, source and analysis intent with the electrical projection.
[Execution](simulation-execution.md) owns preparation and runs. Structural
SPICE/Spectre export is not an executable deck and does not infer that setup.
