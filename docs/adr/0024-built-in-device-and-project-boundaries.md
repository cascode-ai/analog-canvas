# 0024 - Component Resources and Evidence

Status: `accepted`

Owners: `packages/components`, `packages/devices`, `packages/symbols`, `references`

## Decision

Author each built-in component once and generate runtime projections.
[Symbol DSL](../specs/symbol-dsl.md) and the
[component definition contract](../../packages/components/README.md) own the
resource shape; the [Razavi visual contract](../specs/razavi-visual-contract.md)
owns reviewed evidence. [Research sources](../../references/README.md) remain
pinned inputs, not product dependencies.

## Context

Artwork, electrical behavior and evidence are related but not interchangeable.
A visually accurate symbol may have no simulator lowering; a hidden pin still
has electrical meaning. Research checkouts must not become accidental build
dependencies.

## Rationale

One component definition prevents independently maintained device and symbol
registries from drifting, while generated projections let electrical consumers
avoid importing artwork. Project Instances own actual values and connectivity,
not copies of the built-in library.

Scoped raster and PDF evidence preserve source fidelity without inventing
electrical semantics. PDF paths retain precision where approved raster evidence
is absent; a direct source crop remains the witness so candidates cannot grade
themselves. Product adaptations and pin normalization must remain distinguishable
from source artwork.

Pinned, narrowly scoped research inputs make provenance and licensing reviewable.
Vendoring complete repositories or depending on local reference checkouts would
blur ownership and reproducibility. Extraction tools may differ in language;
their accepted outputs cross the same product-owned resource boundary.
