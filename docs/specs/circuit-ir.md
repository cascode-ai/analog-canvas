# Transient Circuit IR

Status: `accepted`

Primary owner: `packages/spice`

Dialect-neutral boundary between the [SPICE frontend](spice-frontend.md#compatibility-profile)
and the Schematic importer; shapes in [`ir.ts`](../../packages/spice/src/ir.ts).

```text
SourceBundle → lossless syntax + typed projections → elaboration
→ CircuitIR → Schematic importer + source-owned connectivity evidence → discard
```

## Rules

- Port and instance terminal positions are contiguous and zero-based in source
  order; every terminal and port references a net of the same cell; every
  top-cell name resolves.
- Source spans stay available for diagnostics; global, cell, model and
  instance parameter expressions keep raw text.
- Unknown statements stay opaque source references; recognized non-schematic
  statements stay typed in `preservedStatements` (diagnostics and round-trip
  evidence only, never persisted or executed). A reachable `.if`/`.elseif`
  whose condition could not be evaluated carries `unresolved`.
- Placement, routes, Junctions, symbols, layout intent and SVG never enter the
  IR; a cell with a `placement` property is rejected.
- No pin roles are guessed from names. The fixed capacitor maps source
  positions to pins `1`/`2`, the variable capacitor to `P1`/`P2`; plate meaning
  comes from device descriptors, not an IR or Project field.
- The IR is transient memory and test-fixture data, never written to the
  Project. The importer persists an immutable terminal reference, input text
  and `spice-source` evidence per live projected Base Net. Deleting the last
  structural owner retires that Base Net and its evidence; the Document
  source binding stays as provenance.
- Source identity never joins Nets. Frozen reference membership yields only
  transient [routing guidance](connectivity-and-routing.md#imported-routing-guidance);
  a cut stays split unless current authoritative names establish equivalence.
