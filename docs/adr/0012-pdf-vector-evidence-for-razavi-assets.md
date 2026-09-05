# ADR 0012: Permit scoped PDF vector evidence for Razavi assets

Status: `accepted`

Date: `2026-08-10`

Owners: `fixtures/visual-reference`, `packages/symbols`, `scripts`, `tools`

## Context

The Razavi reference manifest is the sole visual authority. The accepted
screenshot set contains no inductor, while
Figure 15.21 of the approved Razavi textbook contains a clean PDF-native
inductor path. Reconstructing that curve from pixels would discard coordinates,
stroke width, and Bézier control points already present in the source.

PDF geometry still lacks electrical pin identity, the 10-unit connection grid,
and Symbol DSL semantics. It also must not create a second authority or merge
PDF parsing into the existing raster comparison implementation.

## Decision

The schema-version-1 Razavi manifest may contain an optional
`vectorEvidence` array. Each entry is scoped and must pin:

- evidence ID and `pdf-vector-extract` kind;
- source PDF SHA-256, PDF page, printed page, and figure;
- committed vector-extract JSON and SHA-256;
- committed raster witness and SHA-256; and
- the visual features governed by that evidence.

The full source PDF remains external. The committed extract is the deterministic
geometry input, and the raster witness is the comparison input. The authority
loader hash-checks both. Manifests without `vectorEvidence` remain valid, so no
schema migration is required.

The tool boundaries are mandatory:

1. `tools/pdf-vector-extract/` parses the PDF and creates evidence.
2. A family generator converts pinned evidence to Symbol DSL and supplies
   electrical pin anchors explicitly.
3. `tools/calibration/razavi/fidelity-diff.mjs` compares the rendered Symbol with the
   witness and never edits either source.

This decision is applied one reviewed component at a time. It does not
authorize bulk conversion or replacement of existing raster evidence. The
current PDF-derived set includes the clock-pulse and waveform witnesses from
Figures 16.8 and 20.54 of _Analysis and Design of Data Converters_, the
inductor from Figure 15.21, the
three-terminal op-amp from Figure 8.26, and the common-device family recorded
by `extract-razavi-common-assets.py`: NPN and PNP BJT, diode, voltage amplifier,
and ideal switch. Every semantic pin extension must say so in its evidence; it
must not be described as native source artwork.

## Inductor mapping

The Figure 15.21 path is retained as one continuous Bézier path. Its PDF stroke
width maps to the Razavi `normal` stroke role. Visual endpoints are extended
along their existing centerline to electrical pins `(0,-30)` and `(0,30)`,
which preserves the source curve while satisfying the 10-unit grid. Electrical
pin names, order, and SPICE `L` mapping are product semantics added outside the
PDF extract.

## Op-amp mapping

The Figure 8.26 triangle, three terminal leads, and polarity marks are retained
as selected PDF vector objects. A direct source-PDF crop witness excludes the
surrounding feedback circuit and junction dots. The reviewed Symbol exposes
`IN+`, `IN-`, and `OUT` on the 10-unit grid, matching the ideal textbook symbol.
It has no implicit supply pins and no automatic SPICE mapping; a real op-amp
subcircuit requires an explicit complete pin contract.

## Common-device mapping

The common-device extractor fingerprints native objects in a tight page/figure
region and commits a normalized SymbolDefinition with a direct source-PDF crop
witness. Candidate rendering or a reconstructed selection PDF cannot be used
as a witness.
The NPN body and outward emitter arrow are directly normalized from Figure
12.6. The PNP body and inward upper-emitter arrow are separately normalized
from Figure 12.11; neither arrow is a hand-drawn polarity reversal. The
Figure 15.54 supplies an outline diode triangle and a double-width cathode bar.
Two-terminal diode and three-terminal NPN/PNP map to SPICE `D` and three-node
`Q`, respectively. SPICE `G` remains valid parser/compiler IR, but no reviewed
controlled-source graphical symbol is exposed or automatically imported.

The two-terminal ideal switch does not map to four-terminal SPICE `S`. The
single-ended voltage amplifier
likewise remains manual because its reference
nodes are implicit. BJT hybrid-pi models are composed from resistor,
capacitor, and the reviewed VCCS rather than represented by a pseudo-device.

## Magnetic compound mapping

Figure 19(a) of _LO Generation Techniques for Millimeter-Wave Receivers_
supplies native-vector topology, winding separation, and same-name polarity-dot
placement for the four-terminal `xfmr`. Figure 2 of _The Bridged T-Coil_
supplies the three-terminal L1/L2/CB topology and its relative placement. The
approved Symbols do not copy either paper's coil or capacitor paths: both
reuse `inductor-compact`, and `tcoil` also reuses `capacitor`. This prevents a
second Razavi passive family from drifting into the catalog.

Both devices are atomic on a parent Canvas. Their PDF terminal circles and
number bubbles are evidence annotations, not product endpoints, so external
pins remain unmarked and connect directly to ordinary Wires. Internal filled
dots retain the topology, while polarity dots remain presentation primitives
and never become electrical Junctions.

Neither device claims a single SPICE primitive. `xfmr` requires two inductors
plus mutual coupling, and `tcoil` requires L1/L2/K/CB. Until compound-device or
fixed-cell lowering is explicitly defined, both are manual-only catalog
Instances with stable four- and three-pin contracts respectively.

## Pulse Source and timing-waveform mapping

The two-terminal `pulse-voltage-source` is a deliberate composition. Its
circle, leads, and `+`/`-` electrical contract reuse the calibrated independent
voltage-source family. Figure 16.8 supplies only the square-step pulse
presentation and clock-trace visual language. It does not define electrical
pins, parameter defaults, or simulator behavior; those remain product-owned
and are covered by device, netlist, and digital-event tests.

Figure 20.54 is pinned separately as the presentation authority for stacked
digital traces, signal labels, dashed timing guides, and the horizontal time
axis. It is not an executable waveform fixture and cannot determine logic
values or event times.

## Consequences

- The inductor keeps source-level curve precision and traceable textbook
  provenance.
- Existing raster targets and schema-version-1 manifests behave unchanged.
- Poppler antialiasing may affect a regenerated witness, so committed hashes
  remain authoritative and the vector JSON is the Symbol-generation input.
- PDF sources cannot supply electrical correctness; pin semantics still
  require explicit review and tests.

## Validation

- Extractor rejects a mismatched textbook SHA-256 or path fingerprint.
- Authority loader accepts legacy manifests and rejects modified vector
  extracts or witnesses.
- The peripheral, inductor, and common-family generators have write and
  stale-check modes.
- Symbol/catalog tests enforce continuous geometry, on-grid pins, provenance,
  palette exposure, and SPICE import mapping.
- The existing fidelity runner produces the inductor reference/render/diff
  report from the raster witness.

## Related documents

- [`../specs/razavi-visual-contract.md`](../specs/razavi-visual-contract.md)
- [`../../tools/pdf-vector-extract/README.md`](../../tools/pdf-vector-extract/README.md)
- [`../../fixtures/visual-reference/razavi-reference-v1/manifest.json`](../../fixtures/visual-reference/razavi-reference-v1/manifest.json)
