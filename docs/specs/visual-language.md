# Visual Language

Status: `accepted`

Primary owner: `packages/render-svg`, `apps/editor`

One formal scene, text/formula composition and transient overlays feed the
canvas, Gallery thumbnails and SVG/PNG/PDF. [Razavi](razavi-visual-contract.md)
owns artwork, profile values and node presentation; [export](export.md#validation)
owns file formats, fonts and cross-format acceptance.

```text
SchematicDocument + Symbol Resolver + optional bounds → validate
→ deterministic formal scene → SVG
```

## Formal scene

- Formal SVG has stable groups for routes, Junctions, symbols and
  annotations; grid, selection, hit targets, previews, flightlines and
  diagnostics stay outside it (an export containing `hit-target`,
  `selection`, `editor-overlay` or a grid pattern fails). SVG is derived,
  never connectivity or persistence truth.
- Unknown profile IDs are blocking render errors; no silent substitution.
- Branch dots come from [confirmed contacts](connectivity-and-routing.md#derived-read-models),
  never from appearance.
- A crossing that is not a connection draws plain. With the Document's
  `presentation.crossingStyle: "hop"`, a horizontal run arcs over a vertical
  run it crosses with a 4-unit semicircle above the wire, on canvas and in
  every export. A crossing hops only at least 8 units from the horizontal
  run's ends, 4 units inside the vertical run's, and away from every contact
  point; a power rail never hops, and a hop overlapping the previous one on
  its run stays plain. Hops are ink only: hit geometry, selection and
  connectivity keep the straight centerline. Set in Canvas settings
  (`crossings`) or beside a selected wire.
- Ordering is deterministic by stable ID and fixed layer order. Export bounds
  are placed geometry plus an explicit integer margin; viewport bounds may
  differ.
- Transforms: rotation, then independent screen-space mirrors, then
  translation; mirroring never rewrites rotation. Instance and pin text is
  emitted outside component transforms; text, formulas, fractions and
  polarity marks stay upright, except free drawing text at a quarter turn
  (`rotation` 90 or 270, no polarity), which reads down or up the page,
  turned about its anchor with its box. Negative-polarity bars stay horizontal, marked
  by `upright-*-polarity-negative` parts; adder signs are Instance notation
  ([Razavi](razavi-visual-contract.md#signal-flow-adder-signs)).
- The Document persists `styleProfileId`, placement, annotations and
  presentation intent; scenes, XML, grid, viewport and overlays are
  transient. Goldens use original fixtures, not copied textbook artwork.

## Style overrides

`presentation.styleOverrides` stores scale intent (typography, Wire, symbol,
annotation strokes, Junction radius; each 0.5–2, absent = 1;
[schema](../../packages/model/src/schema/presentation.ts)), composed once by
`resolveDocumentStyleProfile`. Invalid scales reject, never clamp; clearing
restores the base without rewriting objects. An object's `documentStyle`
(kept from a copy's source) replaces the Document overrides for that object in
rendering, measurement and hit geometry. A Junction without one, or a derived
dot, draws like the objects it joins when they all share one style. Changing
Document overrides leaves kept styles alone.

A Junction's optional `styleOverride.color` overrides only its dot. Without it,
one shared incident Wire color wins; mixed or absent Wire colors use the contact's
foreground. Setting a generated terminal-contact dot's color materializes one
stable Junction in the same transaction, preserving the contact's shared kept
style; Auto clears the override. Color never
creates a visible dot or changes connectivity. Canvas and SVG/PNG/PDF share this
resolution. Save/reload, undo/redo and copy/transform preserve the override.
The [workflow test](../../apps/editor/src/features/clipboard/junction-color-workflow.test.ts)
and [browser flow](../../apps/editor/e2e/drawing-style.spec.ts) cover this lifecycle.

## Text

- Instance text comes only from annotations and their bindings, never IDs;
  paint follows the [schematic model](schematic-model.md#presentation-authority).
  Plain text has no electrical meaning. Current annotations rotate their
  arrow but keep text upright.
- Bound names compose into `<tspan>` runs by the
  [names and labels](names-and-labels.md) rules; case/slant actions keep
  color, weight and bars; electrical readers use bound names, never text.
- A RichText overbar is one decoration over its span; scripts under it get no
  extra bars. The whole line is measured before alignment, so continuation
  text cannot shift the anchor or escape export bounds.
- New instance names keep 4 units between ink and artwork on any side. Name
  reads first with the value under it; above the part the value takes the
  nearest row (a W/L fraction clear of it) and the name a row over; a lone
  name or value takes the nearest row.
  Label coordinates are whole units; saved placements are kept, and a label
  exactly where an earlier rule put it counts as untouched. Dragged labels
  keep their anchor; Net labels keep their binding, route markers their route.

## Formulas

- A formula is the atomic RichText alternative: bounded LaTeX plus
  `inline`/`block`. Profile `analog-canvas-math-v1` allows the reviewed base,
  AMS and cases commands and rejects external resources, HTML/style
  injection, packages and dynamic definitions; `\differentialD` renders as an
  upright operator.
- Formulas are set in label type (label family, weight and size; letters
  italic; digits, operators, capital Greek, function names and scripts
  upright), matching adjacent labels. The Formula editor refuses LaTeX label
  type cannot set, naming the command (e.g. `\boxed`, `\color`); older stored
  ones are drawn by the typesetter as path-only SVG.
- Rules and radicals use the text's weight (a radical runs into its
  overbar). Each symbol run is one text element on the real face's advances,
  kept against its neighbours, so a narrower face leaves spare width only at
  row edges or operator spacing. Drafting weight/slant apply; LaTeX font
  commands keep their meaning; stored source is never rewritten. One layout
  serves measurement and drawing, embedded in the formal scene, never
  rasterized or persisted.

## Visual diagnostics

- Findings declare `category`, `confidence`, `gateEligible`: structural ones
  are high-confidence model/topology/constraint conditions; visual
  observations are heuristics needing inspection and never automatic layout
  objectives. Diagnostics never mutate geometry.
- Covered: unplaced/unresolved symbols, symbol/label overlap (free text by
  word ink; polarity marks excluded), names or values on one row closer than
  a figure, labels or free text struck by a wire (text over a part outline is
  fine), Routes through symbols, collinear same-Net overlap, a Route leaving a
  pin backward or a one-pin symbol from a side no other wire meets, terminals
  on another Net's Route (structural warning outside the gate), short
  segments, ambiguous Junction dots, unsatisfied constraints, optional page
  bounds. Unresolved symbols and ambiguous dots block; wire angles alone never
  warn. Overlap uses the active variant's visible geometry; a part's box ends
  at its visible pins, so pin-to-pin parts do not overlap.
