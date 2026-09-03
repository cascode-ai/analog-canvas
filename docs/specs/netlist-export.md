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
- `apps/editor`: authoring, diagnostics, and downloads
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

| Fact                       | Authority                                     | Never inferred from                           |
| -------------------------- | --------------------------------------------- | --------------------------------------------- |
| Cell name                  | `Document.netlist.name`                       | Document title or filename                    |
| Cell interface order       | first occurrence in `projectCellInterface`    | coordinates or alphabetical order             |
| Connectivity               | `Net.terminals`                               | Routes, Junction geometry, labels, or overlap |
| Logical Net name/scope     | resolved owner-addressed marker claims        | legacy Base fields or text appearance         |
| Instance reference         | `Instance.reference`                          | object ID or annotation text                  |
| Device class and pin order | reviewed device definition or child interface | `symbolId` string conventions or orientation  |
| Model/subcircuit target    | typed instance binding                        | symbol name or PDK search                     |
| Parameters                 | typed raw parameter record                    | rendered text or numeric evaluation           |
| Dialect syntax             | requested printer                             | persisted source lines                        |

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
Document ID, and affected object IDs. Any error prevents printer invocation and
download. Required error coverage includes:

- invalid cell-terminal, Net, or instance identifiers;
- missing or mismatched formal terminal mappings;
- unconnected required terminal without `NoConnect`;
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

## Operations and state transitions

```text
Project + Symbol definitions
  -> validate and extract DesignNetlistIR
  -> choose SPICE or Spectre printer
  -> deterministic text
  -> browser download
```

An electrical edit changes Project revision and invalidates a previous export.
A presentation-only edit may change revision but must not change extracted IR
or output bytes.

## Persistence boundary

Cell interfaces and instance electrical data are persisted in the Project.
Device definitions ship with the Symbol library. Export IR, generated local Net
names, diagnostics, and output text are transient. PDK libraries and simulation
profiles are external to this version of the contract.

## Valid example

A four-terminal manually authored NMOS has reference `M1`, explicit model
`nch_mac`, D/G/S/B Net membership, and raw `w=2u l=60n`. It deterministically
prints as a model-backed device in both dialects. Moving or rotating it does not
change either output.

## Rejected example

A manually authored NMOS with W/L values but no model target produces a
blocking missing-target diagnostic. Export must not guess `nmos`, `nch_mac`, or
a foundry model from its Symbol ID.

## Compatibility boundary

Export accepts only the current Project schema. Retired compatibility
properties and all non-current schema versions are rejected by persistence
before extraction. No export path invents a model, child binding, Net
connection, source specification, library path, or simulator directive.

## Deterministic validation

- current Project schema and canonical save/load/save tests
- complete reviewed device-definition coverage tests
- extractor diagnostics and presentation-independence tests
- repeated extraction deep equality and repeated output byte equality
- `.spi` reparse and normalized structural equivalence through `packages/spice`
- Spectre grammar-focused golden tests; licensed simulator parsing only when
  available and never implied otherwise
- focused editor download and blocked-diagnostic browser flows
- full mainline gate before non-document delivery

## Deferred simulation-deck contract

A later accepted contract may persist named simulation profiles containing
explicit library references and path policy, corner/section, parameters,
temperature, structured sources, analyses, options, and save selections. It
composes with the DesignNetlistIR and does not add simulator commands to Net,
Instance, Symbol, Route, or drawing contracts.
