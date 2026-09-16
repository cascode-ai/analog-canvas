# ADR 0012: Permit scoped PDF vector evidence for Razavi assets

Status: `accepted`

Date: `2026-08-10`

Owners: `fixtures/visual-reference`, `packages/components`, `packages/symbols`,
`scripts`, `tools`

## Context

The Razavi reference manifest is the sole visual authority. Some reviewed
devices have native PDF paths but no useful screenshot counterpart. Measuring
a raster reconstruction would discard coordinates, stroke widths and Bézier
control points already present in the source.

PDF artwork does not define electrical pins, the connection grid, model
parameters or netlist lowering. Using it must not create another visual or
electrical authority.

## Decision

The schema-version-1 Razavi manifest permits optional `vectorEvidence`.
Each scoped entry pins:

- evidence ID and `pdf-vector-extract` kind;
- source PDF SHA-256, PDF page, printed page and figure;
- committed vector-extract JSON and SHA-256;
- committed raster witness and SHA-256;
- the visual features governed by that evidence.

The full source PDF stays external. The committed extract is deterministic
geometry input; the direct source-PDF crop is comparison evidence. A candidate
render or reconstructed selection PDF is not a reference witness. The authority
loader verifies hashes. Raster-only manifests remain valid.

The tool boundaries remain separate:

1. `tools/pdf-vector-extract/` parses source PDFs and creates pinned evidence.
2. Family generators normalize that evidence into canonical component
   definitions and explicitly supply product pin anchors and catalog metadata.
3. `tools/calibration/razavi/symbol-fidelity-diff.mjs` compares rendered
   candidates with reference witnesses; comparison never edits either source.

Adoption is reviewed component by component. This is not permission to replace
existing raster references wholesale. The manifest owns evidence scope;
[component definitions](../../packages/components/README.md) own the current
catalog, geometry normalizations and electrical mappings. This ADR does not
maintain a competing device inventory.

## Evidence versus product semantics

A component may reuse a reviewed body or compose several reviewed primitives.
Its definition and generator must distinguish extracted artwork from product
adaptations such as grid-aligned leads, compact passive scaling, equilateral
analog-block outlines, polarity variants or compound-device topology.
Do not relabel a normalized shape as an exact native PDF path.

Reference timing traces and pulse marks govern presentation, not computed
events, source defaults or simulator behavior. Likewise, a drawn magnetic
compound does not establish a SPICE primitive. Simulation support follows its
Device descriptor and tested lowering contract, not its visual review status.

Pin identity/order, endpoint extension, scaling and parameter semantics remain
explicit product decisions. New or changed electrical behavior needs electrical
validation independently of visual fidelity.

## Consequences and validation

- Native paths retain curve precision and traceable provenance.
- Existing raster references remain authoritative in their declared scope.
- Regenerated witnesses can differ with rasterizer antialiasing; committed
  hashes remain the accepted evidence and vector extracts the geometry input.
- Extractors reject mismatched source hashes or object fingerprints.
- Authority checks reject changed extracts or witnesses.
- Generator stale checks and component/catalog tests protect geometry,
  provenance, registration and declared pin/netlist contracts.
- Fidelity reports measure visual agreement; they do not prove electrical
  correctness or authorize a new catalog entry.

## Related documents

- [Visual contract](../specs/razavi-visual-contract.md)
- [Component library](../../packages/components/README.md)
- [PDF extraction](../../tools/pdf-vector-extract/README.md)
- [Reference manifest](../../fixtures/visual-reference/razavi-reference-v1/manifest.json)
