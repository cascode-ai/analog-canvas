# Razavi Visual Contract

Status: `accepted`

Owners: `fixtures/visual-reference`, `packages/components`, `packages/symbols`, `packages/derived`,
`packages/render-svg`, `scripts`

The sole Razavi-specific contract: visual authority, construction, exposure
and pixel fidelity. Commands live in the [component guide](../../packages/components/README.md),
[calibration tools](../../tools/calibration/razavi/README.md) and
[PDF extractor](../../tools/pdf-vector-extract/README.md).

## Provenance

Every catalog entry declares `provenance`: `razavi-reference-v1` (the default;
drawn from the reviewed textbook, pins its evidence, every rule here applies)
or `house` (a primitive the textbook never drew, e.g. a four-terminal
voltage-controlled switch; claims no authority). A `house` entry may not stand
in for a component the reference covers or avoid pinning its evidence.

## Authority and evidence

- `fixtures/visual-reference/razavi-reference-v1/manifest.json` and the
  evidence it hash-pins are the sole authority for geometry, strokes, node
  and interface treatment, arrows, typography, annotations and acceptance.
  Supplemental rasters and PDF extracts are scoped evidence inside it.
- Raster targets stay raster-owned. A `pdf-vector-extract` entry is allowed
  only when the raster set lacks the component, recording source PDF SHA-256,
  PDF and printed page, figure, extracted JSON and a direct source-PDF crop
  witness (never candidate renders or reconstructed PDFs).
- VSS, decoded master IR, old generators and candidate renders are not
  evidence. Missing coverage stays unreviewed; never widen evidence beyond its
  source.
- Extraction, generation and comparison are separate: the extractor never
  imports the fidelity code; the fidelity tool never writes evidence or DSL.
- Each reviewed target records evidence paths and hashes, PDF provenance,
  `originPx`, `pixelsPerLogical`, fixed crop window, rotation, measurement
  coordinate system and subject symbol. Windows and origins belong to
  evidence; candidate-derived windows are never reviewed baselines.

## Construction

- Pin anchors use the 10-unit grid; visual primitives may use measured
  decimals. Calibration never moves pins, changes order or topology unless a
  family generator records a lead-normalization rule (NPN/PNP: B `-40`→`-30`,
  C/E `±30`→`±20`, body and arrow unchanged).
- A family has one canonical body; polarity, arrows and hidden pins vary
  separately. Signed amplifier marks follow named pins (the converter v9
  correction fixed sixteen differential forms' input marks); registration
  checks plus/minus strokes separately.
- A geometry change must satisfy every registered orientation, sample and
  variant; growing beyond previous bounds needs a viewBox audit.
- One continuous stroke → one path; separate primitives that may cover →
  deterministic overlap and order; separate model objects → render-only
  bridge. Seam repair never changes endpoints, anchors, membership or
  Junctions. Tune acute corners as centerline, then cap/join, then miter
  limit, then outline.

## Interface symbols and node semantics

| Object                                    | Presentation                | Meaning                                    |
| ----------------------------------------- | --------------------------- | ------------------------------------------ |
| `port` symbol                             | Hollow circle and lead      | Explicit hollow interface symbol           |
| `port-filled` symbol                      | Filled circle and lead      | Explicit manual solid-endpoint symbol      |
| Confirmed branch contact                  | Filled solid dot            | Shared contact evidence requires a dot     |
| Unconnected device pin, bend, or crossing | No automatic dot            | Unconfirmed geometry has no node semantics |
| Route joined to a visible device pin      | Dot if branch rule requires | Committed contact, not visual overlap      |

Both ports are ordinary single-pin Instances (pin `P`); `port-filled` is
manual-only with no SPICE mapping; hollow vs filled is explicit intent. A
placed `vdd-port` is the supply marker; a drawn power rail is Net plus
Route/Junction geometry. Dots follow [confirmed branch topology](connectivity-and-routing.md#derived-read-models),
not Junction objects; a contact on a valid `power-rail` draws no dot but stays
real.

## Style, text, and rendering

- Profile `razavi-textbook-v1`: black on white by default, authored colors
  kept, no decoration or overlays, geometry and strokes scale together (never
  `vector-effect="non-scaling-stroke"`), butt caps and miter joins unless a
  primitive overrides.
- One conductor run is one shape: conductors of one paint are stroked as one
  path of many subpaths (with miters through pins and Junctions) so abutting
  Routes leave no light or dark seam; each Route keeps an unpainted element
  for identity. A Route drawn back along its pin's lead covers it and adds no
  miter.
- The [style profile](../../packages/derived/src/style-profile.ts) owns token
  names, values and typography; the
  [measurement adapter](../../packages/derived/src/razavi-peripheral-geometry.generated.ts)
  is generated. Stroke roles: wires/symbols, emphasis, Ground bars, power
  rails. A token change updates its source, projections, assertions and
  fidelity baselines together; profile selection never changes global
  typography.

## Source symbols

- Independent sources use their circular defaults and expose no Shape choice
  in Properties or Agent `set-properties`.
- VCCS, CCCS, VCVS and CCVS default to a circle; `appearance.shape` selects
  `circle` or the existing `diamond` outline on the same Instance.
- VCCS and CCCS retain the existing current arrow. VCVS and CCVS retain
  external positive and negative marks, with no arrow in either outline.
- Source outlines and leads use the normal stroke. Shape selection preserves
  pins, Net membership, control bindings and authored Annotation anchors.
  These controlled-source compositions are house artwork, not new textbook
  evidence.

## Analog transconductance blocks

Right-tapered trapezoid with centred renderer-owned formula, default `g_m`
(instance forms like `g_m1` keep pin identity). Single-input: west `A`, east
`Y`, sharing the adaptive formula-block layout (grows on the 10-grid, never
clips 12-unit text). Differential: `IN+`, `IN-` with polarity marks, `OUT`,
fixed pin spacing. Both are behavioral, manual-only and map to no SPICE
primitive.

## Signal-flow adder signs

- A subtracting input is the Instance's `signA`/`signB` netlist parameter
  ([netlist export](netlist-export.md#device-definition)), not another
  Symbol. Once one input subtracts, each input shows a small plus or minus;
  an all-adding adder shows none. Marks are Instance presentation; the
  Symbol, its evidence and fidelity target carry none.
- Placement measured on Figure 21.38 at 1.3 px/unit: 7.6-unit bars in the
  normal stroke with butt ends, centred at (−21.5, −10.5) for A and
  (−12.5, 18.5) for B ([input-signs.ts](../../packages/symbols/src/input-signs.ts)
  and its test pin them). They follow turns and mirrors and stay level or
  upright on the page.
- `resolveInstanceSymbol` (or `withInputSigns`) carries the marks to
  everything that measures ink: scene and export bounds, selection, label
  placement and clearance, diagnostics, hit/marquee boxes and edge snapping,
  Agent connect/route-net/move clearance, the wire-under-symbol warning, wire
  shaping and Snapshot bounds, so planners avoid what
  `VISUAL_WIRE_THROUGH_SYMBOL` reports.

## Catalog and palette exposure

A Razavi palette entry needs: an electrically reviewed `SymbolDefinition` with
on-grid pins; `catalog.reviewStatus: "reviewed"`; `palette: true` and
`visualAuthority.kind: "razavi-reference-v1"`; present, hash-checked evidence,
witness and measurements; membership in `razaviProductSymbols` (the sole
source of the Razavi library section). Optional families appear only in a
separately named library (e.g. `Extended Devices`) without Razavi claims.
Unsupported SPICE devices block import; PDK mappings follow
[Symbol DSL](symbol-dsl.md). `npn`/`pnp` stay device symbols; no hybrid-pi or
controlled-source pseudo-symbol without an approved primitive set.

## Pixel fidelity

`fixtures/visual-reference/razavi-reference-v1/fidelity-targets.json`
(hash-pinned) is the single registry of Symbol targets (no second device table
in the CLI; full scenes use renderer/export tests). Comparison verifies
integrity, crops the reference at its recorded origin (subpixel kept),
rasterizes the Symbol at the same scale, footprint, rotation and origin,
rejects size mismatch, and reports binary and soft IoU, miss/extra, lift,
edge-shell ratio and best shift with diff PNGs. Binary IoU is a relative
regression signal; the shift search is diagnostic and never the baseline;
approval needs the spatial diff and formal render. Rebuild `packages/*/dist`
before comparing.

## Failure behavior

Missing or mismatched hashes block reviewed validation; a missing
measurement, target, symbol or variant blocks that target with no fallback;
off-grid pins, pin-order mismatch, stale generated output and ineligible
exposure fail checks; candidate-derived windows are rejected even if IoU
improves. Conflicting specs are resolved before code or goldens change.
Schema-1 manifests without `vectorEvidence` stay valid; PDF-derived symbols
change no Project schema.
