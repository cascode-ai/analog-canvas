# Transient Circuit IR

Status: `accepted`

Version: `1.2-spice-baseline`

Owning phase: `Phase 0/2`

Primary owner: `packages/spice`

## Purpose

Define the dialect-neutral structural boundary between the lossless SPICE
frontend and the Schematic importer without turning parser or renderer details
into persistent project data.

## Consumers

- SPICE elaborator
- Schematic importer
- connectivity golden tests

## Terminology

| Term                | Meaning                                                       |
| ------------------- | ------------------------------------------------------------- |
| Positional terminal | A terminal whose zero-based position preserves source order   |
| Opaque statement    | Preserved source text that has no recognized typed projection |
| Target              | Primitive, model, subcircuit, or opaque instance reference    |

## Data model or interface

`CircuitIR` contains dialect ID, candidate top-cell names, cells, global
parameter declarations, model declarations, and unresolved statements. A cell
contains ordered ports, nets, instances, local parameter declarations, and
source spans. An instance contains an explicit target, ordered terminals, raw
parameter expressions, and source location.

`preservedStatements` records typed but non-schematic directives, library and
conditional boundaries, functions, and control commands. It exists for
diagnostics and round-trip evidence; the Schematic importer does not persist
or execute it.

## Invariants

- Port and instance terminal positions are contiguous and zero-based.
- Every terminal and port references a net in the same cell.
- Every top-cell name resolves to a cell.
- Original source spans remain available for diagnostics.
- Global, cell, model, and instance parameter expressions retain raw text.
- Unknown statements remain as opaque source references; recognized
  non-schematic statements remain typed preserved references.
- Placement, routes, Junctions, symbols, layout intent, and SVG never enter IR.
- IR never guesses pin roles from instance or model names. For the reviewed
  built-in fixed capacitor, source terminal positions map deterministically to
  canonical pins `1` and `2`; its variable-capacitor counterpart uses stable
  pins `P1` and `P2`. Their device descriptors supply top-plate and bottom-plate
  meaning without adding a field to Circuit IR or Project JSON.

## Operations and state transitions

```text
SourceBundle → lossless syntax + typed projections → elaboration
→ CircuitIR → Schematic importer + source-owned connectivity evidence
→ discard CircuitIR
```

## Persistence boundary

Circuit IR is transient memory and test-fixture data only. It is not written to
`project.icproj.json`. The importer persists stable `spice-source` evidence for
each projected Base Net; re-import reparses the source snapshot. Document
consumers resolve matching source identities together without mutating or
serializing Circuit-IR-derived Logical Nets.

## Valid example

A subcircuit call retains target cell name and ordered node positions even when
no dedicated visual symbol exists.

## Rejected example

An instance terminal referencing a net absent from its cell is rejected. A cell
with a `placement` property is rejected as renderer leakage.

## Compatibility and migration

Phase 2 expands the boundary with parsing evidence while preserving these
separation rules. Dialect-specific syntax remains in frontend projections, not
in persistent Documents.

## Deterministic validation

- Zod and generated JSON Schema inspection
- terminal ordering and net-reference tests
- unknown statement preservation tests
- tests rejecting visual fields

## Open decisions

- The full SPICE3/ngspice compatibility matrix is selected in Phase 4.
