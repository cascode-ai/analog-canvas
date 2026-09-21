# Visual Language

Status: `accepted`

Primary owner: `packages/render-svg`, `apps/editor`

## Scope

The shared formal scene, text/formula composition and transient overlays serve
the canvas and exporters. [Razavi](razavi-visual-contract.md) owns reviewed
artwork and style; [export](export.md) owns file-format conversion.

## Document style composition

`Document.presentation.styleOverrides` stores optional scale intent, not
resolved profile tokens. [The schema](../../packages/model/src/schema/presentation.ts)
owns its fields and bounds: typography, Wire, symbol, annotation strokes and
Junction radius each scale independently within 0.5–2; absence means 1.
`resolveDocumentStyleProfile` composes those values once for derived geometry,
rendering and export. Object-level overrides apply only within their declared
scope. Invalid scales are rejected, not clamped; clearing overrides restores
the base profile without rewriting objects.

## Terminology

| Term          | Meaning                                                            |
| ------------- | ------------------------------------------------------------------ |
| Formal layer  | Electrical and explanatory content included in export              |
| Overlay       | Grid, selection, hit target, preview, flightline, or diagnostic UI |
| Style profile | The Razavi token set and rendering rules used by a Document        |

## Data model or interface

The accepted `razavi-textbook-v1` profile, including its token table,
component-construction rules, and pixel-alignment contract, is defined in
[`razavi-visual-contract.md`](razavi-visual-contract.md). This generic visual
language specification does not duplicate Razavi values.

Unknown persisted profile IDs are blocking render errors; the renderer never
silently substitutes a profile. Semantic symbol roles resolve through the
Razavi profile. Reviewed Razavi assets use semantic roles and retain measured
finite-decimal geometry.

[Interface artwork](razavi-visual-contract.md#interface-symbols-and-node-semantics)
owns hollow/filled Ports and supply presentation. The renderer consumes
[confirmed contact evidence](connectivity-and-routing.md#derived-read-models)
for branch dots, never inferring electrical membership from appearance.
Current and voltage annotation geometry uses semantic kinds and profile
tokens rather than text glyphs or editor overlays.

Formal SVG has stable groups for routes, Junctions, symbols, and annotations.
The editor creates its grid and interaction overlay outside the formal group.

Annotations are semantic `instance-label`, `instance-value`, `net-label`,
`power-label`, and `route-marker` objects. Current
annotations rotate the arrow independently so their text stays upright.
Instance text comes from authored annotations and their typed bindings;
the renderer does not synthesize default labels from internal Instance IDs.
Text and position can change without changing stable Instance IDs.
Instance labels and values inherit their owning Instance's effective
foreground by default; an optional per-Annotation `textColor` override changes
only that annotation's text. Net, power, and route-marker annotations use the
Document style profile while their own `textColor` remains Auto.
Net labels are formal electrical annotations tied to a logical Net; plain text
has no electrical meaning.

Under `razavi-textbook-v1`, instance identifiers and recognized voltage,
current, power, and pin labels are composed into deterministic SVG
`<tspan>` runs. The leading symbol is the base and the remaining identifier
defaults to its subscript; trailing `+` and `-` signs remain upright. This is a
style compiler, not an input grammar: underscores, braces, carets, backslashes,
letter case, and every other authored character remain literal. Users change
ordinary RichText formatting through the explicit toolbar, while only the
explicit Formula editor interprets LaTeX syntax. The persisted semantic name
and the flattened RichText projection therefore remain identical, and the same
composed formal SVG scene feeds SVG, PNG, and PDF export.

An authored formula is the atomic alternative to ordinary styled RichText,
not another text object type. Its persisted facts are bounded LaTeX source and
`inline`/`block` display intent. The `analog-canvas-math-v1` profile supports
the reviewed base, AMS, and cases command sets and rejects external resources,
HTML/style injection, package loading, and dynamic command definitions. The
formal profile recognizes MathLive's `\differentialD` source as an upright
differential operator, so source produced by the editor preview remains valid
without rewriting the persisted LaTeX. The typesetter emits standalone
path-only SVG with deterministic width, height, baseline, and source identity.
Formula letters and numerals default to bold sans-serif, matching schematic
text. Drafting text and callout weight/slant overrides also apply to formulas;
explicit LaTeX font commands retain their meaning. This is rendering style,
not a rewrite of the stored expression. Measurement and drawing use the same
style-aware artifact, prepared before canvas, export, and server thumbnail
rendering.
Formula SVG is embedded into the same formal
scene used by canvas, SVG, PNG, and vector PDF; it is never rasterized or
persisted.

An ordinary RichText overbar is one explicit decoration over its authored
span. A subscript/superscript stack under that span does not inherit separate
bars, and text before or after the span neither breaks nor extends the bar.
The complete line is measured before start, center, or end alignment is
resolved, so continuation text cannot shift the anchor or escape export
bounds.

Derived visual diagnostics cover unplaced or unresolved symbols, symbol and
label overlap, Routes through symbols, collinear same-Net Route overlap, Route
departure against a pin's outward direction, terminals resting on another
Net's Route, short route segments, ambiguous
Junction dots, unsatisfied layout constraints, and optional export-page
bounds. Diagnostics never mutate geometry. Unresolved symbols and ambiguous
Junction dots are blocking errors. Arbitrary wire angles are valid authoring
intent and produce no angle-only warning or error, including on protected
Routes. Explicit angle straightening remains an optional undoable operation,
not a diagnostic prerequisite. A terminal resting on another Net's Route is a
structural warning outside the gate. Spacing and other layout-quality findings
are observations.

Every finding declares `category`, `confidence`, and `gateEligible`.
Structural findings describe high-confidence model, topology, or explicit
constraint conditions. Visual observations describe heuristic geometry and
require inspection of the formal render. A gate-ineligible observation must
never become an automatic layout objective merely because a quality policy
lists its code. Where deterministic primitive bounds exist, overlap analysis uses the
active symbol variant's visible geometry and clusters repeated overlaps.

## Invariants

- Profile defaults, primitive caps/joins and stroke scaling follow the
  [Razavi contract](razavi-visual-contract.md#style-text-and-rendering).
  Explicit authored color overrides remain preserved.
- Instance transforms apply rotation, then independent screen-space horizontal
  and/or vertical reflection, then translation. Mirror actions do not rewrite
  the authored rotation.
- Polarity notation moves with its component or drafting annotation, while
  every negative-polarity bar remains horizontal on the page at all rotations.
  Symbol assets identify those bars with an `upright-*-polarity-negative`
  primitive part instead of relying on geometric guesses in the renderer.
- Drafting text, formulas, fractions, and polarity marks keep their glyphs and
  strokes upright. Rotation may change a multipart polarity annotation's
  layout direction, but never rotates the notation itself.
- Instance and pin text is emitted outside component transforms, so component
  rotation and mirroring cannot rotate or mirror its glyphs.
- Object and layer ordering is deterministic by stable ID and fixed layer
  order.
- Selection, hit targets, grid, drag preview, diagnostics, and flightlines are
  absent from formal SVG export.
- SVG is derived output and never becomes connectivity or persistence truth.
- Formula source is persistence truth; generated glyph paths and formula
  metrics are transient derived output.
- Annotation attachment moves with an edited instance while its offset and
  semantic kind remain persisted.
- Instance labels may be dragged to any position, retaining their
  object-relative anchor so they follow subsequent component moves. Ordinary
  Net labels also move freely without changing their electrical binding;
  directional route markers retain their route attachment.
- New Analog Block names sit about five units outside the drawn artwork,
  matching compact device-label spacing. Label coordinates use fine precision
  rather than connection-grid rounding; saved, authored placements are retained.
- Visual goldens use original project fixtures, not copied textbook artwork.

## Operations and state transitions

```text
SchematicDocument + Symbol Resolver + optional bounds
→ validate
→ deterministic formal scene
→ SVG document
```

Viewport bounds may differ from export bounds. Export derives bounds from
placed symbol geometry plus an explicit integer margin.

## Persistence boundary

The Document persists `styleProfileId`, placement, annotations, and presentation
intent. Render scenes, SVG XML, grid, viewport, and overlay state are transient.

## Rejected example

An exported SVG containing a `hit-target`, `selection`, `editor-overlay`, or
grid pattern fails formal-layer validation even if the on-screen canvas is
correct.

## Evidence

[Renderer tests](../../packages/render-svg/src/render.test.ts) and
[drafting tests](../../packages/render-svg/src/drafting-render.test.ts) protect
deterministic composition, transforms and formal/overlay separation.
[Style resolution tests](../../packages/derived/src/style-profile.test.ts)
protect override composition; [export](export.md#validation) owns cross-format
acceptance. Font embedding and further cross-format metric calibration remain
[deferred questions](../roadmap/README.md#deferred-contract-questions).
