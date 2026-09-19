# Razavi Visual Contract

Status: `accepted`

Owners: `fixtures/visual-reference`, `packages/components`, `packages/symbols`, `packages/derived`,
`packages/render-svg`, `scripts`

## Purpose

Define the single normative contract for Razavi visual authority, component
construction, product exposure, reference registration, and pixel-fidelity
comparison. Generic Symbol DSL, electrical model, routing, and export contracts
remain in their owning specifications and are not duplicated here.

## Scope

Every catalog entry declares its `provenance`:

- `razavi-reference-v1` — drawn from the reviewed textbook authority. Every
  rule in this contract applies, and the entry must pin its evidence.
- `house` — drawn here, for a primitive the textbook does not contain. It
  carries no visual authority and claims none.

`razavi-reference-v1` is the default and stays the rule for anything the
textbook covers. A `house` entry exists so a primitive the reference simply
never drew — a four-terminal voltage-controlled switch, say — can be placed
at all, instead of being unreachable because a book about analog design had
no figure for it.

The line is deliberate and narrow. A `house` entry may not stand in for a
component the reference does cover, and may not be introduced to avoid the
work of pinning evidence for one that it does. Naming the provenance in the
catalog is what keeps the distinction checkable rather than remembered: a
reader can see at a glance which artwork answers to the textbook and which
answers to us.

## Authority and evidence

The rules in this section govern `razavi-reference-v1` entries.

`fixtures/visual-reference/razavi-reference-v1/manifest.json` and the evidence
it hash-pins are the sole visual authority for them. They control component
geometry, stroke hierarchy, node and interface-symbol treatment, arrows,
typography, annotations, and visual acceptance. Supplemental rasters and PDF
vector extracts are scoped evidence inside the same authority, not competing
authorities.

Existing raster targets remain raster-owned. A `pdf-vector-extract` entry is
allowed only when the approved raster set lacks the component and the manifest
records the source PDF SHA-256, PDF page, printed page, figure, extracted JSON,
and a direct source-PDF crop witness. The source PDF is external evidence; the committed,
hash-pinned extract is the reproducible geometry input. Its raster witness
keeps final validation on the same diff protocol as raster-owned assets.
Candidate Symbol rendering, manually reconstructed selection PDFs, and other
derived artwork must never serve as the raster witness.

VSS, decoded master IR, historical generators, and the
current candidate rendering are not visual evidence. If the authority lacks a
component or feature, it remains unreviewed; do not infer it from those
sources, and never widen an evidence file to cover geometry the source does
not contain. A primitive the textbook never drew is a `house` entry, drawn
openly as ours, rather than a Razavi entry with invented evidence.

PDF extraction, Symbol generation, and raster comparison are separate tools:

```text
source PDF -> tools/pdf-vector-extract -> pinned vector evidence + PNG witness
pinned vector evidence -> family generator -> Symbol DSL
PNG witness + rendered Symbol -> tools/calibration/razavi/symbol-fidelity-diff.mjs -> report
```

The PDF extractor must not import the fidelity implementation, and the
fidelity tool remains read-only with respect to vector evidence and Symbol DSL.

Every reviewed reference target records or resolves:

```text
evidence path(s) and asset hash(es)
source identity and page/figure provenance when PDF-derived
originPx
pixelsPerLogical
fixed crop window
rotation
measurement coordinate system
subject symbol identity
```

Reference windows and origins belong to evidence. A candidate-derived window
may support exploration but is not a reviewed regression baseline.

## Coordinate and construction contract

- Electrical pin anchors use the canonical 10-unit connection grid.
- Visual primitives may use measured finite-decimal logical coordinates.
- Visual calibration must not move pins, change pin order, or change topology
  unless a family generator records an explicit product lead-normalization
  rule. NPN/PNP preserve their extracted body and arrow geometry while moving
  B from `-40` to `-30` and C/E from `±30` to `±20`, placing all three
  connection anchors one grid cell closer to the body.
- Instance transforms apply rotation, independent screen-space mirror axes,
  then translation.
- A symbol family has one canonical shared body geometry; polarity, arrow,
  hidden-pin presentation, and other semantic differences remain separate.
- A geometry change must satisfy every registered orientation, sample, and
  reviewed variant for the affected asset.
- Extending a primitive beyond the previous bounds requires an explicit
  viewBox audit so visible strokes are not clipped.

Construct continuous presentation according to primitive topology:

```text
one continuous visual stroke       -> one continuous path
separate primitives that may cover -> deterministic overlap and render order
separate model or topology objects -> render-only bridge
```

Seam repair never changes route endpoints, pin anchors, Net membership, or
Junction semantics. Review `lineCap`, `lineJoin`, stroke width, `miterLimit`,
render order, and viewBox together. For acute corners, calibrate centerline
points first, then cap/join, then miter limit, and only then outline amplitude.

## Interface symbols and node semantics

The following are distinct reviewed presentations and must not be conflated:

| Object                                    | Presentation                | Meaning                                    |
| ----------------------------------------- | --------------------------- | ------------------------------------------ |
| `port` symbol                             | Hollow circle and lead      | Explicit hollow interface symbol           |
| `port-filled` symbol                      | Filled circle and lead      | Explicit manual solid-endpoint symbol      |
| Confirmed branch contact                  | Filled solid dot            | Shared contact evidence requires a dot     |
| Unconnected device pin, bend, or crossing | No automatic dot            | Unconfirmed geometry has no node semantics |
| Route joined to a visible device pin      | Dot if branch rule requires | Committed contact, not visual overlap      |

Both `port` and `port-filled` are reviewed palette symbols and ordinary
single-pin Instances. `port-filled` is manual-only and has no automatic SPICE
mapping. Hollow versus filled is explicit product intent, not a style-profile
fallback. A placed `vdd-port` is the reviewed supply marker; its local/formal
or Global meaning follows the schematic model. A drawn power rail uses explicit
Net and Route/Junction geometry. These authoring forms do not replace the
hollow or filled Port presentation.

Dot eligibility follows [confirmed branch topology](connectivity-and-routing.md#derived-read-models),
not merely the presence of a Junction object. A confirmed contact incident to
a valid `power-rail` renders without a dot while remaining electrically and
interactively real; the rail uses its calibrated power-rail stroke. This is a
supply-presentation exception, not a deletion of connectivity.

## Style, text, and rendering

The profile ID is `razavi-textbook-v1`. Formal output defaults to black on white;
explicit authored color overrides are preserved. It has no
decorative effects or editor overlays, scales geometry and strokes together,
and uses butt caps plus miter joins unless a reviewed primitive overrides them.
One conductor run is one shape. A straight run is often several Routes — split
at a pin it passes through, or at a retained Junction — and every stroked
element a renderer composites on its own leaves its edge where it meets the
next: two that abut leave a lighter row at the seam, and a stroke laid over
that seam leaves a darker one. Conductors of one paint are therefore stroked as
a single path of many subpaths, with the miters that carry a run through a pin
or a Junction among them, so the coverage is one calculation and a run reads as
the single line it is. Each Route keeps an unpainted element of its own for
identity and geometry: the ink is shared, the objects are not. A Route drawn
back along its pin's own lead covers that lead instead of turning away from it
and contributes no miter — the subpath would double back on itself.

The executable [style profile](../../packages/derived/src/style-profile.ts)
owns the exact token names, values and shared typography. Its
[generated measurement adapter](../../packages/derived/src/razavi-peripheral-geometry.generated.ts)
projects the hash-pinned peripheral measurements; it is generated output,
not a second editable authority. Semantic stroke roles distinguish ordinary
wires/symbol strokes, emphasis, Ground bars and power rails. Arrow proportions,
node radius and script metrics remain calibrated values rather than page-grid
coordinates.

A token change updates its owning source, generated projections, focused
assertions and affected fidelity baselines together. Profile selection must
not silently change global typography or math composition. Formal output
scales geometry and strokes together and never emits
`vector-effect="non-scaling-stroke"`.

[Visual language](visual-language.md) owns the common formal scene, annotation
composition and overlay boundary; this contract does not redefine them.

## Analog transconductance blocks

A transconductance relation is drawn as a right-tapered trapezoid with
renderer-owned formula text centered inside. The single-input form has one west
input `A` and one east output `Y`. Its taller input edge and narrower output edge
follow the pinned user-supplied small-signal reference. The differential form
has west inputs `IN+` and `IN-`, explicit polarity marks, and one east output
`OUT`. Both live in Analog Blocks and use the canonical default `g_m`; instance
presentation may express indexed forms such as `g_m1`, `gₘL`, or another safe
formula without changing electrical pin identity.

The single-input trapezoid, leads, background, hit bounds, and route endpoints
share the adaptive formula-block layout. Long formulae and explicit minimum
dimensions grow that body on the 10-unit grid; they never clip or shrink 12-unit
formula text. The differential form keeps fixed calibrated pin spacing so both
inputs remain unambiguous. Both blocks are behavioral and manual-only: neither
their formula nor coefficient implies a SPICE primitive or automatic device
mapping.

## Catalog, runtime, and palette exposure

A Razavi palette entry is eligible only when all conditions hold:

1. its `SymbolDefinition` is electrically reviewed and every pin is on-grid;
2. the component file's `catalog` section records `reviewStatus: "reviewed"`;
3. `palette` is true and `visualAuthority.kind` is
   `"razavi-reference-v1"`;
4. referenced evidence, raster witness, and measurements are present and
   hash-checked;
5. the symbol is present in `razaviProductSymbols`.

`razaviProductSymbols` is the sole source for the Reference-calibrated Razavi
section of the Component Library. Optional families may appear only through a
separate, explicitly named library such as `Extended Devices`; they remain
outside Razavi authority and its fidelity claims. `builtInSymbols` combines
the resolvable collections without weakening either boundary. Legacy symbols
are not retained or resolvable. An unsupported SPICE device blocks import with
an explicit diagnostic. PDK mappings separately declare model scope, terminal
count, and complete ordered pin lists; a visual name never implies electrical
pin order.

## Pixel-alignment and IoU contract

The declarative target registry is
`fixtures/visual-reference/razavi-reference-v1/fidelity-targets.json`. It is
hash-pinned by the authority manifest and is the single source for fidelity
target identity, measurement selection and symbol/variant selection. The
current comparison CLI selects registered Symbol targets; it does not run
circuit/formal-scene targets. Adding a supported comparison target must not
require a second hard-coded device table in the CLI. Full-scene acceptance
uses the shared renderer and export tests, not a claimed circuit-IoU runner.

For each target, the fidelity runner must:

1. verify authority and registry integrity before treating results as reviewed;
2. load the target's reference-owned measurement and fixed window;
3. crop the reference with the recorded origin and floor-based top-left rule,
   preserving the origin's subpixel position inside the crop;
4. rasterize the registered runtime Symbol at the same
   `pixelsPerLogical`, integer footprint, rotation, and subpixel origin;
5. reject mismatched raster dimensions;
6. emit reference, rendered, and red/green/gray diff PNGs;
7. report binary IoU, soft IoU, miss/extra counts, registration lift,
   edge-shell ratio, and the best diagnostic shift.

Binary IoU uses the manifest threshold and is a relative regression signal,
not a universal pass value. Soft IoU reduces the weight of antialiased edge
differences. The bounded translation search is diagnostic only: its best score
and registration lift never replace the unshifted baseline. A high edge-shell
ratio suggests contour/antialias disagreement; solid mismatch regions suggest
geometry error. Automated verdicts guide inspection but do not approve a
geometry change without reviewing the spatial diff and formal rendering.

The fidelity scripts currently import `packages/*/dist`. Regenerate assets and
rebuild affected packages before comparison; stale compiled output invalidates
the result. The comparison tool is read-only with respect to source geometry,
although it writes derived reports and PNGs.

## Component extension workflow

1. Add approved evidence to the authority fixture, record its scope, and pin
   its hash. Use a raster for raster-owned targets. For a PDF-only component,
   add a `pdf-vector-extract` entry and its raster witness. Stop if neither form
   contains sufficient evidence.
2. Add or update a measurement file with coordinate system, scale, origin,
   fixed window, rotation, visible geometry, and intended Symbol mapping.
3. Define electrical pins, order, roles, directions, variants, and any PDK/SPICE
   mappings independently of visual tuning.
4. Author or generate Symbol DSL using semantic stroke roles; preserve on-grid
   pins and family-canonical geometry.
5. Register catalog authority and product exposure. Add a runtime registration
   only for a new symbol ID.
6. Add the fidelity target to the single registry and protect geometry,
   authority, and eligibility with focused assertions.
7. Generate assets/catalog, run authority/hash checks, rebuild the packages
   consumed by the fidelity tool, compare every registered sample/variant, and
   inspect the diffs before acceptance.

Commands and dependencies belong to the [component guide](../../packages/components/README.md),
[calibration tools](../../tools/calibration/razavi/README.md) and
[PDF extractor](../../tools/pdf-vector-extract/README.md), not a second command
inventory here. PDF extraction remains separate from routine raster calibration.

Run only the generators relevant to the changed family. Do not rewrite a
reviewed asset merely to enlarge the palette or improve one metric at the cost
of another registered sample.

## Failure behavior

- Missing or mismatched authority/registry hashes block reviewed validation.
- Missing measurement, target, symbol, or variant blocks
  that target; no fallback symbol or reference is substituted.
- Off-grid pins, pin-order mismatch, stale generated catalog output, and
  ineligible palette exposure fail deterministic checks.
- Candidate-derived windows are rejected for reviewed acceptance even when
  they improve IoU.
- Unknown profile IDs remain blocking render errors.
- If accepted specifications disagree, resolve the specification conflict
  before changing implementation or goldens.

## Valid and rejected examples

A valid filled interface marker is the reviewed `port-filled` symbol with its
own explicit catalog identity and manual-only exposure. It remains an ordinary
Instance with pin `P`.

A valid seam repair joins one resistor stroke into a continuous path or adds a
render-only bridge between separate route objects while preserving endpoints.

A rejected calibration shifts an electrical pin to improve pixel overlap. A
rejected fidelity target derives its formal crop from the candidate's changing
bounds or promotes the best translated IoU to the baseline score.

## Deterministic validation

- `pnpm symbols:razavi:check`
- focused Symbol catalog and renderer tests
- generator stale checks for affected families
- package builds consumed by the fidelity runner
- registered Symbol pixel comparisons and formal-scene render/export tests
- inspection of reference/rendered/diff PNGs
- repeated render equality and transform coverage

For BJT small-signal work, `npn`/`pnp` remain device symbols. No standalone
hybrid-pi or controlled-source pseudo-symbol is part of the reviewed palette;
such equivalent circuits must be expressed only when their complete primitive
symbol set has been separately approved.

## Compatibility

Schema-version-1 manifests without `vectorEvidence` remain valid. PDF-derived
symbols extend the palette without changing persisted Project schema; only an
explicit reviewed mapping may extend SPICE import behavior. The hollow `port`,
filled `port-filled`, Junction, and all existing symbol behavior remain
distinct. This is the sole Razavi-specific visual contract.

Related decisions and explanatory evidence:

- [`../adr/resources.md`](../adr/resources.md)
- [`symbol-dsl.md`](symbol-dsl.md)
- [`visual-language.md`](visual-language.md)
