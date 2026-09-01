# Visual Language

Status: `accepted`

Primary owner: `packages/render-svg`, `apps/editor`

## Purpose

Define the first formal schematic output style and keep export content separate
from editor-only interaction overlays.

## Consumers

- native SVG editor canvas
- `packages/render-svg`
- symbol compiler and annotation renderer
- SVG, PNG, and PDF exporters
- visual diagnostics and golden tests

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

For Razavi formal output, the reviewed `port` and `port-filled` Symbol assets
provide explicit hollow and filled interface presentations. Each is an
ordinary single-pin Instance whose pin `P` uses normal terminal connectivity;
the renderer does not replace either symbol with a separate model-level Port
shape. Power labels belong to explicit Nets and Route/Junction rail geometry,
not to a Port-specific presentation. Explicit Junctions render independently;
device-pin anchors, ordinary corners, and geometric crossings never acquire a
dot from appearance or degree alone.
An explicit branch Junction on a valid VDD Net that contains a `power-rail`
Route remains electrically and interactively real but renders without a dot;
the rail itself uses the supply stroke. This is a Razavi supply-presentation
exception, not a deletion or weakening of its connectivity record.
Current and voltage annotation geometry is derived from the annotation kind and
profile tokens, not text glyphs or editor overlays. Razavi-specific authority,
construction, and pixel-alignment rules live in
[`razavi-visual-contract.md`](razavi-visual-contract.md).

Formal SVG has stable groups for routes, Junctions, symbols, and annotations.
The editor creates its grid and interaction overlay outside the formal group.

Annotations are semantic `instance-label`, `instance-value`, `net-label`,
`power-label`, and `route-marker` objects. Current
annotations rotate the arrow independently so their text stays upright.
Explicit instance labels suppress only the renderer's default instance ID.
Their text and position are editable without changing stable instance IDs.
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
label overlap, short route segments, ambiguous Junction dots, unsatisfied
layout constraints, and optional export-page bounds. Diagnostics never mutate
geometry. Unresolved symbols and ambiguous Junction dots are blocking errors;
spacing and layout-quality findings are observations.

Every finding declares `category`, `confidence`, and `gateEligible`.
Structural findings describe high-confidence model, topology, or explicit
constraint conditions. Visual observations describe heuristic geometry and
require inspection of the formal render. A gate-ineligible observation must
never become an automatic layout objective merely because a recipe lists its
code. Where deterministic primitive bounds exist, overlap analysis uses the
active symbol variant's visible geometry and clusters repeated overlaps.

## Invariants

- Formal output is black on white with no gradients, shadows, or decorative
  frames.
- Symbol geometry uses square line caps and miter joins unless a reviewed
  symbol explicitly requires another choice.
- Instance transforms apply local x-coordinate mirror, then rotation, then
  translation, matching the model coordinate contract.
- Instance and pin text is emitted outside component transforms, so component
  rotation and mirroring cannot rotate or mirror its glyphs.
- Object and layer ordering is deterministic by stable ID and fixed layer
  order.
- Selection, hit targets, grid, drag preview, diagnostics, and flightlines are
  absent from formal SVG export.
- SVG is derived output and never becomes connectivity or persistence truth.
- Formula source is persistence truth; generated glyph paths and formula
  metrics are transient derived output.
- Razavi formal output scales geometry and strokes together and emits no
  `vector-effect="non-scaling-stroke"`.
- Annotation attachment moves with an edited instance while its offset and
  semantic kind remain persisted.
- Hollow `port`, filled `port-filled`, and supply-rail presentations remain
  distinct authored objects; presentation never creates another endpoint kind.
- Instance-label drag is bounded around its symbol and Net-label drag is
  bounded around attached route geometry; free text is unconstrained.
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

## Deterministic validation

- original SVG golden comparison
- all rotation/mirror transform tests
- repeated render equality
- formal versus overlay structural inspection
- browser export acceptance

## Open decisions

- Font embedding and cross-format metric calibration remain deferred.

## Signal Flow transconductance blocks

A transconductance relation is drawn as a right-tapered trapezoid with one west
input `A`, one east output `Y`, and renderer-owned formula text centered inside.
The taller input edge and narrower output edge follow the pinned user-supplied
small-signal reference. The canonical default is `+g_m`; instance presentation
may express signed/indexed forms such as `+g_m1`, `−gₘL`, or another safe
formula without changing the symbol's A/Y electrical identity.

The trapezoid, leads, background, hit bounds, and route endpoints share the
adaptive Signal Flow layout. Long formulae and explicit minimum dimensions grow
the body on the 10-unit grid; they never clip or shrink 12-unit formula text.
The block is behavioral and manual-only: neither its formula nor coefficient
implies a SPICE primitive or automatic device mapping.
