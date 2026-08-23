# Razavi Symbol Construction and Pixel Calibration

## 1. Methodology

Extending the Razavi component set is not merely an SVG drawing task. It is a
closed loop of visual evidence, coordinate contracts, electrical semantics,
primitive topology, runtime registration, and validation through the actual
renderer. Visual decisions come only from hash-pinned Razavi rasters. VSS,
legacy assets, and the current candidate geometry cannot fill gaps in that
evidence.

### Separate visual and electrical coordinates

- Reference evidence uses pixel coordinates and explicitly records
  `assetPath`, `originPx`, `pixelsPerLogical`, crop window, and rotation.
- Symbol primitives use local logical coordinates and may retain measured
  fractional values.
- Pin anchors are an electrical contract on the 10-unit connection grid.
  Visual calibration must not move pins, change pin order, or alter topology.
- When an overlap or extended primitive exceeds the previous bounds, expand
  the viewBox deliberately so the repaired stroke is not clipped.

The formal crop window belongs to the reference evidence. A window derived
from candidate geometry is useful only for exploration and must not become the
regression baseline for a reviewed symbol. Reference cropping and candidate
rasterization must preserve the same subpixel origin. A small translation
search reports registration lift only; it never replaces the formal alignment.

### Share family geometry and isolate semantic differences

A symbol family should have one canonical body geometry. Shared bodies, bars,
channels, leads, and spacing are maintained once; polarity, arrow direction,
variants, and hidden-pin presentation are expressed separately. When one asset
has several reference orientations, samples, or variants, a change must satisfy
all of them rather than optimize a single crop.

### Repair seams according to primitive topology

```text
One continuous visual stroke       -> one continuous path
Separate primitives that may cover -> deterministic overlap and render order
Separate model or topology objects -> render-only bridge
```

Do not repair a seam by changing a route endpoint, pin anchor, or Junction
meaning. Check `lineCap`, `lineJoin`, stroke width, `miterLimit`, render order,
and viewBox together. Calibrate acute corners in this order: centerline points,
cap/join, miter limit, then outline or amplitude. Changing several variables at
once makes the result impossible to attribute.

### Use pixel comparison as a diagnostic loop

Rasterize the actual Symbol or formal SVG rendering path. Browser screenshots
and parallel approximation formulas are not stable baselines. The reference
crop and candidate raster must use the same integer footprint, scale, and
origin registration.

Read binary IoU, soft IoU, registration lift, edge-shell ratio, and the
red/green/gray diff together. Solid mismatch regions usually indicate a real
geometry error; a thin contour shell more often indicates antialiasing or
subpixel registration. Scores and automated verdicts guide investigation but
are not acceptance gates by themselves. Inspect the spatial diff and formal
render before retaining a change.

This judgment is supported by the capacitor dual-orientation calibration, MOS
and arrow overlaps, the continuous resistor path, and terminal/route-anchor
render-only bridges. The detailed chronology and measurements were kept in
target plans that are no longer tracked; the committed evidence is in the
history of `packages/symbols/assets/razavi-v1/` and
`fixtures/visual-golden/` for August 2026.

## 2. Code and Paths

| Layer                      | Path                                                                                                                                          | Responsibility                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Visual evidence            | `fixtures/visual-reference/razavi-reference-v1/*.png`                                                                                         | Preserve original reference images; never rewrite them during calibration            |
| Authority and measurements | `fixtures/visual-reference/razavi-reference-v1/manifest.json`, `*-geometry.json`                                                              | Pin hashes, scope, origins, scale, windows, rotation, and measurements               |
| Symbol sources             | `packages/symbols/assets/razavi-v1/*.symbol.json`                                                                                             | Store electrical pins, visual primitives, and variants                               |
| Catalog                    | `packages/symbols/assets/razavi-v1/catalog.json`                                                                                              | Store review status, visual authority, palette eligibility, and generated hashes     |
| Generators                 | `scripts/generate-razavi-mos-assets.mjs`, `scripts/generate-razavi-peripheral-assets.mjs`, `scripts/generate-razavi-symbol-catalog.mjs`       | Generate reviewed assets from measurements and shared family rules                   |
| Style and rendering        | `packages/derived/src/style-profile.ts`, `packages/render-svg/src/render.ts`                                                                  | Resolve shared visual tokens, formal render order, and render-only bridges           |
| Pixel comparison           | `tools/calibration/razavi/fidelity-diff.mjs`, `scripts/lib/razavi-fidelity.mjs`, `scripts/lib/symbol-rasterize.mjs`, `scripts/lib/png-io.mjs` | Crop, rasterize through the real renderer, calculate diagnostics, and emit diff PNGs |
| Normative entry points     | `docs/specs/razavi-visual-contract.md`, `docs/specs/symbol-dsl.md`                                                                            | Define Razavi authority/construction/fidelity and generic pin/primitive contracts    |

Use this fixed execution order:

```text
Register the raster and measurement
-> define the electrical pin contract
-> edit the measurement, generator, or Symbol DSL
-> regenerate assets and the catalog
-> run symbols:razavi:check
-> rebuild the dist packages read by the fidelity tool
-> run fidelity comparison for every reference orientation and variant
-> inspect metrics and diff PNGs
-> retain, revert, or continue with one-variable adjustments
```

Common commands:

```powershell
pnpm symbols:razavi
pnpm symbols:razavi:check
pnpm --filter @icm/symbols build
pnpm --filter @icm/derived build
pnpm --filter @icm/render-svg build
node tools/calibration/razavi/fidelity-diff.mjs <target>
```

The fidelity tool currently imports implementation from `packages/*/dist`, so
running it without rebuilding may compare stale artifacts. A formally reviewed
target should store an explicit window in reference-owned measurement data
instead of relying on the candidate-geometry fallback. Run manifest and hash
validation before fidelity comparison because the comparison tool does not
replace authority-integrity checks.

Before committing a symbol, ask eight questions: Is the reference registered?
Is the window fixed? Are the pins unchanged? Is family geometry shared? Does
the seam strategy match primitive topology? Does the viewBox cover every
visible stroke? Was `dist` rebuilt? Were all orientations, variants, and diffs
inspected by a human?
