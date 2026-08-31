# Razavi Visual Contract

Status: `accepted`

Owners: `fixtures/visual-reference`, `packages/symbols`, `packages/derived`,
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
PNG witness + rendered Symbol -> tools/calibration/razavi/fidelity-diff.mjs -> report
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
subject symbol/formal-scene identity
```

Reference windows and origins belong to evidence. A candidate-derived window
may support exploration but is not a reviewed regression baseline.

## Coordinate and construction contract

- Electrical pin anchors use the canonical 10-unit connection grid.
- Visual primitives may use measured finite-decimal logical coordinates.
- Visual calibration must not move pins, change pin order, or change topology.
- Instance transforms apply local x mirror, then rotation, then translation.
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

| Object                                    | Presentation           | Meaning                                     |
| ----------------------------------------- | ---------------------- | ------------------------------------------- |
| `port` symbol                             | Hollow circle and lead | Explicit hollow interface symbol            |
| `port-filled` symbol (`solid-port` alias) | Filled circle and lead | Explicit manual solid-endpoint symbol       |
| Explicit `Junction`                       | Filled solid dot       | Route-graph branch/join object              |
| Device pin, bend, or crossing             | No automatic dot       | Geometry alone never creates node semantics |

Both `port` and `port-filled` are reviewed palette symbols and ordinary
single-pin Instances. `port-filled` is manual-only and has no automatic SPICE
mapping. Hollow versus filled is explicit product intent, not a style-profile
fallback. A power label belongs to an explicit Net and rail Route/Junction
geometry; it does not replace either symbol presentation.

## Style, text, and rendering

The profile ID is `razavi-textbook-v1`. Formal output is black on white, has no
decorative effects or editor overlays, scales geometry and strokes together,
and uses butt caps plus miter joins unless a reviewed primitive overrides them.

The accepted profile tokens are:

```yaml
foreground: "#000"
background: "#fff"
strokes:
  wire: 1.6
  symbol: 1.6
  normal: 1.6
  emphasis: 2.4
  ground: 2.906977
  supply: 1.8
  annotation: 1.6
nodes:
  junctionRadius: 3.77907
  portOriginRadius: 2.47907
annotations:
  supplyBarWidth: 20
  currentArrowLength: 53.488372
  arrowHeadLength: 16.569767
  arrowHeadWidth: 7.906977
  currentLabelGap: 6.976744
  polarityOffsetX: 12
  polarityHalfGap: 8
lineCap: butt
lineJoin: miter
miterLimit: 4
formalStrokeScaling: "geometry-and-strokes"
typography:
  fontFamily: "'ICM Round Period', 'DejaVu Sans', Arial, 'Helvetica Neue', Helvetica, sans-serif"
  mathWeight: 700
  mathStyle: italic
  plainWeight: 400
  instanceFontSize: 15.116
  netFontSize: 15.116
  powerFontSize: 15.116
  annotationFontSize: 15.116
  polarityFontSize: 14
  captionFontSize: 14
  subscriptScale: 0.76
  subscriptBaselineShiftEm: 0.28
  subscriptHorizontalGapEm: 0.046
  labelGap: 6
  lineHeight: 1
```

`packages/derived/src/style-profile.ts` and its generated measurement adapters
are the executable representation of this table. A token change updates the
contract, generator/source, focused assertions, and affected fidelity baselines
together. Profile selection must not silently change the global typography or
math-composition rules.

Formal rendering uses deterministic layer and stable-ID order. Selection, hit
targets, grid, previews, diagnostics, and flightlines are absent from export.
SVG and raster outputs are derived presentation, never persistence or
connectivity truth.

## Catalog, runtime, and palette exposure

A Razavi palette entry is eligible only when all conditions hold:

1. its `SymbolDefinition` is electrically reviewed and every pin is on-grid;
2. `catalog.json` records `reviewStatus: "reviewed"`;
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
target identity, measurement selection, symbol/variant selection, and formal
scene kind. Adding a reviewed comparison target must not require a second
hard-coded device table in the CLI.

For each target, the fidelity runner must:

1. verify authority and registry integrity before treating results as reviewed;
2. load the target's reference-owned measurement and fixed window;
3. crop the reference with the recorded origin and floor-based top-left rule,
   preserving the origin's subpixel position inside the crop;
4. rasterize the actual Symbol or formal SVG path at the same
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

Typical commands are:

```powershell
pnpm symbols:razavi-mos
pnpm symbols:razavi-peripherals
pnpm symbols:razavi-inductor
pnpm symbols:razavi-opamp
pnpm symbols:razavi-common
pnpm symbols:razavi-zener
pnpm symbols:razavi
pnpm symbols:razavi:check
pnpm --filter @icm/symbols build
pnpm --filter @icm/model build
pnpm --filter @icm/derived build
pnpm --filter @icm/render-svg build
pnpm --filter @icm/exporters build
node tools/calibration/razavi/fidelity-diff.mjs <target>
```

The PDF extraction command and dependencies are documented in
`tools/pdf-vector-extract/README.md`; it is intentionally not part of the
routine raster calibration command set.

Run only the generators relevant to the changed family. Do not rewrite a
reviewed asset merely to enlarge the palette or improve one metric at the cost
of another registered sample.

## Failure behavior

- Missing or mismatched authority/registry hashes block reviewed validation.
- Missing measurement, target, symbol, variant, or formal-scene adapter blocks
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
- registered symbol and formal-scene pixel comparisons
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
distinct. This is the sole Razavi-specific visual contract. Historical style
and component-extension documents were deleted after their surviving rules
moved here; Git retains their history.

Related decisions and explanatory evidence:

- [`../adr/0012-pdf-vector-evidence-for-razavi-assets.md`](../adr/0012-pdf-vector-evidence-for-razavi-assets.md)
- [`symbol-dsl.md`](symbol-dsl.md)
- [`visual-language.md`](visual-language.md)
- [`../experience/razavi-symbol-construction-and-pixel-calibration.md`](../experience/razavi-symbol-construction-and-pixel-calibration.md)
