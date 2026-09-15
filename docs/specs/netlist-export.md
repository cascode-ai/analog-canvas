# Deterministic Netlist Export

Status: `accepted`

Primary owner: `packages/netlist`

Related ADR: [`0017-deterministic-design-netlist-boundary.md`](../adr/0017-deterministic-design-netlist-boundary.md)

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

```typescript
interface CellNetlistInterface {
  name: string;
  terminals: Array<{
    id: StableId;
    name: string;
    direction: PortDirection;
    netId: StableId;
    interfaceInstanceIds: [StableId];
  }>;
}

interface InstanceNetlistData {
  binding:
    | { kind: "primitive"; deviceClass: DeviceClass }
    | { kind: "model"; deviceClass: DeviceClass; name: string }
    | { kind: "subcircuit"; childDocumentId: StableId; name: string }
    | { kind: "external-subcircuit"; name: string };
  parameters: Record<string, string>;
}
```

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
Project. Repeated internal Net naming still uses Net Labels.

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
not a simulator model lookup. Its definition's ordered terminals select the
emitted `X` nodes and its `name` is the emitted master token. The instance owns
raw overrides. A PDK may provide artwork later, but artwork cannot change
external invocation into a primitive or model binding.

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
projected to plain micrometre numbers only for SPICE/ngspice export.

External-master parameters are deliberately open: declared formal parameters
provide authoring metadata, requiredness, and defaults, while additional raw
instance keys are retained and emitted. This permits a project to carry
library-specific settings such as `l`, `w`, and `nf` without bundling the
library model or PDK.

## Device definition

Each exportable electrical Symbol has one reviewed definition:

```typescript
interface DeviceNetlistDefinition {
  symbolId: StableId;
  deviceClass:
    | "resistor"
    | "capacitor"
    | "inductor"
    | "mos"
    | "voltage-source"
    | "current-source"
    | "net-marker"
    | "hierarchical";
  referencePrefix: string | null;
  pinOrder: string[];
  targetPolicy: "builtin" | "required-model" | "child-cell" | "none";
  parameters: DeviceParameterDefinition[];
}
```

`DeviceParameterDefinition` is the same descriptor-owned field metadata used
by Insert and Properties (key, label, requiredness, editor kind, optional unit
hint/example/help, and display role). Required export fields are derived from
`parameters`; there is no separate `requiredParameters` registry.

Pin order names canonical Symbol pins. Hidden or implicit pins remain present.
Canonical MOS ordering is D/G/S/B. Ground is a Net marker that verifies the
explicit global Logical Net `0` and emits no instance line. A VDD Port is a
non-emitting global marker claim with `powerDomain: vdd`. A named Power Rail
uses the same claim and has no Instance. Only
an explicitly global Net is emitted through the dialect's global declaration.
Decorative symbols never have a device definition. An unsupported electrical
Symbol blocks export.

Independent source syntax is accepted only after its source specification is
represented structurally. A display string is not a source specification.

## Net rules

- `Net.terminals` is the only connectivity truth.
- Named Nets are unique within a cell under case folding.
- An unnamed local Net receives an ephemeral collision-free `N0001`, `N0002`,
  ... name in stable Net-ID order. This does not mutate the Project.
- Every Net mapped by one projected Formal Port uses that Port name before
  anonymous allocation and therefore receives no generated-name warning.
- A global Net must have an explicit name.
- The global Net named `0` is the reference node.
- Other global Nets are emitted through the dialect's global declaration and
  are not silently converted to cell ports.
- A terminal belongs to at most one Net.
- An unconnected terminal must carry an explicit `NoConnect`; otherwise export
  is blocked. Each explicit `NoConnect` receives one deterministic,
  collision-free exporter-only local node (`NC0001`, `NC0002`, ...), preserving
  fixed device and subcircuit arity without adding a Project Net.
- Routes, Junctions, flightlines, labels, placement, and drafting content do
  not affect the Export IR.

## Transient Export IR

The export IR is distinct from the import-oriented `CircuitIR`:

```typescript
interface DesignNetlistIR {
  topCellId: StableId;
  cells: DesignNetlistCell[];
  globals: string[];
}

interface DesignNetlistCell {
  id: StableId;
  name: string;
  ports: Array<{ id: StableId; name: string; netName: string }>;
  nets: Array<{ id: StableId; name: string; scope: "local" | "global" }>;
  instances: DesignNetlistInstance[];
}

interface DesignNetlistInstance {
  id: StableId;
  reference: string;
  deviceClass: string;
  target: string | null;
  nodes: Array<{ pinName: string; netName: string }>;
  parameters: Array<{ name: string; rawValue: string }>;
}
```

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
- unconnected required terminal without `NoConnect`, except an omitted MOS B;
- unnamed global Net or duplicate explicit Net name;
- unknown or multiply assigned terminal;
- missing device definition, required pin, reference, target, or parameter;
- wrong reference prefix;
- unresolved or mismatched child cell and hierarchy cycle;
- unsupported dialect/device combination;
- identifier, parameter, count, or output resource-limit violation.

Warnings may report generated local Net names or conflicting directions inside
one same-name Formal Port group. They cannot downgrade a missing
electrical fact required for meaningful output.

### Explicit export presets

The export boundary accepts an optional `NetlistExportProfile`. The editor
ships Abstract, SKY130, and Custom defaults in a single raw JSON configuration
in the right Properties panel; `selected` chooses the active preset. Valid code
edits apply immediately, invalid drafts block copying, and browser preferences
are separate from the Project schema. There are no per-field configuration forms.

Projection copies the Project and visits only the reachable hierarchy. Abstract
uses ideal R/C/L and generic model names without model cards; SKY130 uses reviewed
external transistor interfaces and ideal R/C by default; Custom preserves authored
targets. Defaults fill only missing parameters, case-insensitively. Existing source
waveforms and AC intent do not acquire a new DC bias from a fallback.

Across all three profiles and strict simulation extraction, an explicit MOS B
connection wins. If B has neither a Net nor an explicit NoConnect, NMOS emits on
global `0` and PMOS emits on global `VDD`. The fallback is part of the extracted
IR only; it does not add a Net, binding, label, or route to the saved Project.

Explicit physical R/C targets use reviewed W/L parameters, never infer geometry
from an ideal value, and warn when replacing that value. A resistor's existing
substrate connection wins; an absent substrate may use an explicitly configured
existing net or exporter-only ground `0`. Reference or target-interface collisions
block output. Reviewed geometry stays in canonical metres until strict SPICE
extraction emits the PDK wrapper's micrometre values. Unknown custom subcircuits
and unresolved hierarchy retain their original interfaces and validation.

Configured library paths and sections are printed as includes outside the pure
IR printer. SKY130 `.scs` files use `simulator lang=spice` for the same authentic
SPICE wrapper library; this is not a native Spectre PDK conversion or a claim of
licensed Spectre qualification. Strict extraction and simulation consumers do not
implicitly use these export presets.

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

Existing conflicting bindings, missing hierarchy interfaces, unsupported devices,
invalid waveforms, and incomplete connections remain blocking. This projection
never exports the permissive authoring IR. It cannot omit an invalid device or invent a model definition. Numerical defaults
and the explicit substrate rule belong only to the selected preset above.

The editor's primary Netlist button copies immediately in its current format
(SPICE by default) and opens the live right sidebar. Its adjacent menu copies
the other format and remembers that choice for the session. Clipboard rejection
leaves selectable code and a status message, without a download fallback.

The copy/export projection removes the strict printer's generated title and
adds no diagnostic, preset, TODO-summary or library comments. SPICE preserves
an empty first title line so an entry-file reader does not consume the first
directive. Native SCS begins with its language declaration before an include.
Structured diagnostics remain available in the optional Check Report; its
preview and copy action use the same projection. Strict simulation printers
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

## Deferred simulation-deck contract

A later accepted contract may persist named simulation profiles containing
explicit library references and path policy, corner/section, parameters,
temperature, structured sources, analyses, options, and save selections. It
composes with the DesignNetlistIR and does not add simulator commands to Net,
Instance, Symbol, Route, or drawing contracts.
