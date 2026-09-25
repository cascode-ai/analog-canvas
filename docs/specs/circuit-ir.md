# Transient Circuit IR

Status: `accepted`

Primary owner: `packages/spice`

## Purpose

Define the dialect-neutral structural boundary between the lossless SPICE
frontend and the Schematic importer without turning parser or renderer details
into persistent project data.

The [SPICE frontend](spice-frontend.md#compatibility-profile) owns the supported
dialect subset; this IR does not imply full simulator-language compatibility.

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
`project.icproj.json`. The importer persists a small immutable terminal reference
and input text, not a second editable IR. It also persists `spice-source` evidence for
each live projected Base Net. Deleting
the final structural owner retires that Base Net and its source evidence, while
the Document source binding remains available as provenance. Source identity
never joins electrical Nets. Frozen reference membership produces transient
[routing guidance](connectivity-and-routing.md#imported-routing-guidance), not
Logical-Net equivalence; mutable source identities cannot reconstruct that
reference. A cut must remain electrically split unless current authoritative
names independently establish equivalence.

## Valid example

A subcircuit call retains target cell name and ordered node positions even when
no dedicated visual symbol exists.

## Rejected example

An instance terminal referencing a net absent from its cell is rejected. A cell
with a `placement` property is rejected as renderer leakage.

## Evidence

[The executable IR schema](../../packages/spice/src/ir.ts) owns exact shapes.
[IR tests](../../packages/spice/src/ir.test.ts) protect ordered terminals,
references and rejection of visual fields. Dialect-specific syntax stays in
frontend projections rather than persistent Documents.
