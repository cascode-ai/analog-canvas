# 0044 - Imported source provenance is not connectivity

Status: `accepted`

Date: `2026-08-25`

Owners: `packages/spice`, `packages/derived`, `packages/edit-engine`,
`apps/editor`

## Context

Imported SPICE Nets need two independent facts: their current electrical
topology and the source Net from which routing guidance can be reconstructed.
Treating `spice-source` as Logical-Net equivalence kept a deleted Wire
electrically connected. Retaining it only on the primary split component fixed
export, but made the detached endpoints disappear from imported guidance.

External X calls had a related classification problem. A reviewed SKY130
symbol mapping proves that the schematic understands the external master's
pin contract, but import subsequently marked every external master as missing.
ERC then reported that state as a missing model even though X calls are
external-subcircuit bindings rather than device-model bindings.

## Decision

- `spice-source` is persisted provenance and routing intent only. The Logical
  Net resolver never unions Base Nets by source identity.
- A physical split copies source provenance to every surviving Base Net. A
  later merge deduplicates identical `(Base Net, source Net)` facts.
- Imported routing guidance groups current physical components by source
  identity, but every guide also carries the actual Base Net at each endpoint.
  Completing the guide uses the normal Wire/connect transaction; export sees
  no connection until that transaction succeeds.
- A reviewed external-master symbol mapping is resolved for schematic ERC.
  Unknown X-call masters report `ERC_MISSING_EXTERNAL_MASTER`; device-model
  bindings continue to report `ERC_MISSING_MODEL`.
- Foundry model-library availability is a future simulation-deck preflight
  concern. It is not inferred from whether the schematic can resolve a
  reviewed external-master symbol contract.

No Project schema, UI preference, or new Net object is introduced.

Source provenance is copied to every physical component created by a cut,
while non-owner electrical Evidence follows the physical-cut rules. Naming,
physical-cut, and endpoint-readiness decisions remain independent.

## Consequences

- Cutting an imported Wire changes electrical export immediately while still
  leaving an accurate visual suggestion for restoring the source topology.
- A few authored Wires cannot accidentally dismiss guidance for unrelated
  detached components of the same imported source Net.
- SKY130 X-call MOS instances retain their external-subcircuit binding and
  original master spelling without producing a false missing-model ERC.
- Missing model and missing external-master diagnostics now describe distinct
  contracts and can lead to different repair actions.

## Validation

- Logical-Net tests prove shared source provenance does not join Base Nets.
- Routing-guidance tests prove separate Base Nets sharing a source receive a
  guide with their real endpoint Net IDs.
- Cut and merge tests prove source provenance propagation and deduplication.
- SKY130 corpus import and ERC tests prove reviewed versus unknown external
  master classification.

## Related documents

- [ADR 0040](0040-connectivity-evidence.md)
- [ADR 0041](0041-physical-cut-and-endpoint-readiness.md)
- [Connectivity and routing](../specs/connectivity-and-routing.md)
