# 0017 - Deterministic Design-Netlist Boundary

Status: `accepted`

Date: `2026-08-13`

Owners: `packages/model`, `packages/symbols`, `packages/netlist`, `apps/editor`

## Context

The editor persists logical connectivity and can import structural SPICE, but
does not export an edited design as SPICE or Spectre. Import retains some
source facts in free-form `spice.*` properties while intentionally discarding
source text and transient Circuit IR. Manual devices do not consistently carry
formal references or model targets.

Reliable EDA export requires deterministic program logic and one authority for
every emitted fact. Drawing labels, coordinates, Symbol names, and host PDK
installations are not safe authorities. A simulation deck also requires
configuration absent from a schematic: libraries, process corner, stimuli,
analyses, options, temperature, and output selection.

This changes the Project format, Symbol contract, package graph, editor
authoring, and two dialect outputs, so it requires an ADR.

## Decision

The product implements deterministic structural design-netlist export through
four separated layers:

1. `packages/model` persists explicit cell interfaces and instance electrical
   reference, typed binding/target, and raw parameters.
2. `packages/symbols` owns reviewed device class, prefix, canonical pin order,
   target policy, and required parameters.
3. A new `packages/netlist` extracts and validates transient
   `DesignNetlistIR`, then prints SPICE or Spectre through pure modules.
4. `apps/editor` authors the facts, shows diagnostics, and downloads only after
   validation succeeds.

Net membership remains authoritative in `Net.terminals`.
Geometry and annotations do not enter export. Retired `spice.*` properties are
invalid.

Import `CircuitIR` is not reused because it owns source declarations,
preserved statements, spans, dialect evidence, and unresolved syntax. The
visual `packages/exporters` package is not reused because it owns SVG-derived
artifacts. Netlist generation is a distinct electrical transformation.

The first release produces structural libraries, not simulation decks. It
emits no guessed include, PDK, corner, stimulus, analysis, option, or save
statement. A later typed simulation-profile contract may compose those
explicit facts with DesignNetlistIR.

## Alternatives considered

### Print directly from the Project in each dialect

- Benefits: fewer initial types.
- Costs: duplicated hierarchy, naming, validation, and pin-order behavior.
- Reason not selected: equivalent deterministic dialects need one normalized
  validation boundary.

### Reuse import CircuitIR

- Benefits: existing circuit-shaped schema.
- Costs: mixes source preservation with persisted design authority.
- Reason not selected: import and export have different ownership and failure
  semantics.

### Preserve and patch original source

- Benefits: retains source text for untouched imports.
- Costs: source text is not persisted and manual edits cannot be represented as
  safe text patches.
- Reason not selected: it cannot support general schematic-to-netlist export.

### Infer missing facts with AI or heuristics

- Benefits: fewer required fields in demonstrations.
- Costs: nondeterministic, electrically unsafe, and unverifiable.
- Reason not selected: export must reproduce explicit engineering intent.

## Consequences

### Positive

- Identical Project and Symbol inputs produce identical bytes without AI.
- SPICE and Spectre share hierarchy, naming, diagnostics, and electrical facts.
- Missing model/library intent is visible instead of guessed.
- Presentation-only edits cannot change a design netlist.
- A future simulation system can compose with a stable structural boundary.

### Negative or limiting

- Current Projects and editor Properties require explicit typed fields.
- Incompatible external data requires explicit conversion before open.
- Structural files may not run until simulation setup supplies models and
  analyses.
- Both printers require continuing structural-equivalence coverage.

## Compatibility boundary

Extraction accepts only the current schema and typed facts. It never creates a
model target, hierarchy relationship, source specification, Net membership,
include, or analysis absent from the Project. Compatibility properties and
non-current schema versions are rejected before export.

## Validation

- current schema and canonical persistence tests;
- device-definition completeness and pin-order tests;
- extractor presentation-independence, hierarchy, naming, and diagnostics;
- byte-deterministic SPICE/Spectre goldens;
- structural SPICE reparse equivalence;
- editor blocked/successful download flows;
- full repository mainline delivery gate.

## Related documents

- [`../specs/netlist-export.md`](../specs/netlist-export.md)
- [`../specs/project-file-format.md`](../specs/project-file-format.md)
- [`../specs/schematic-model.md`](../specs/schematic-model.md)
- [`../specs/symbol-dsl.md`](../specs/symbol-dsl.md)
- [`../specs/circuit-ir.md`](../specs/circuit-ir.md)
