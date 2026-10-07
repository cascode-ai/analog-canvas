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

An object's `documentStyle` is the Document style it kept from a copy's source.
`objectStyleProfile` resolves it in place of the Document's overrides for that
object alone, in rendering, text measurement and hit geometry alike. A Junction
without one draws like the Routes it joins when they all keep the same style,
and a derived contact dot draws like the objects it joins on the same terms.
Changing the Document's overrides leaves kept styles as they are.

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

Under `razavi-textbook-v1`, bound names are composed into deterministic SVG
`<tspan>` runs. By default `_` starts a subscript and a terminal `_bar` denotes
an overbar. Each Document can keep underscores literal, apply the leading-letter
subscript convention, and choose subscript case and independent initial/script
slant. The leading-letter convention and slant are presentation only; only an
explicit whole-drawing subscript case change updates electrical spelling along
with the labels. RichText overrides remain editable,
and case/slant actions preserve unrelated color, weight and bar decoration.
Simple analog-block body names share these rules; mathematical expressions
retain the formula renderer. Only the explicit Formula editor interprets LaTeX.
Electrical readers use bound names rather than flattened visible text; the same
composed formal SVG scene feeds canvas, Gallery thumbnails, SVG, PNG and PDF.

An authored formula is the atomic alternative to ordinary styled RichText,
not another text object type. Its persisted facts are bounded LaTeX source and
`inline`/`block` display intent. The `analog-canvas-math-v1` profile supports
the reviewed base, AMS, and cases command sets and rejects external resources,
HTML/style injection, package loading, and dynamic command definitions. The
formal profile recognizes MathLive's `\differentialD` source as an upright
differential operator, so source produced by the editor preview remains valid
without rewriting the persisted LaTeX.

Every formula is set in label type: the label font family, weight, and size,
letters italic, and subscripts, digits, operators, capital Greek, and function
names upright, with scripts at the profile's subscript scale and shift. A
formula and the label beside it therefore match glyph for glyph. Label type
sets everything the Formula editor offers and its common neighbours:
- letters, digits, Greek, operators and relations (including `\not`
  negations), scripts and primes;
- fractions and binomials, square and indexed roots, over- and underlines,
  and accents (`\hat`, `\vec`, `\dot`, `\ddot`, `\tilde` and the wide
  forms);
- large operators with their limits stacked in display style (sums,
  products, `\lim`, `\max`) or set aside (integrals);
- `\left…\middle…\right` and `\big` fences, matrices, cases and aligned rows;
- `\overset`/`\underset` stacks, extensible arrows, and blackboard,
  calligraphic and fraktur letters;
- spacing, lengths, phantoms, style switches, function names, and the font
  and class commands.

The Formula editor refuses LaTeX label type cannot set, naming the command
(for example `\boxed` or `\color`), rather than drawing it another way.
Fraction bars, overlines, and radical signs are drawn in the text's own
weight, as TeX's rules are, not the heavier stroke of schematic lines. A
radical sign is a drawn stroke that runs on into its overbar, so the two meet
exactly whatever face the viewer has. The layout measures with the label advance
tables, but a viewer may draw the font stack in another face, such as Arial
where DejaVu Sans is not installed. So each run of symbols with their scripts
is one text element whose glyphs follow one another by the real face's
advances, as a label's do; fractions, radicals, and fences are placed from the
layout. A one-run formula stands at its anchor as a label does. Otherwise each
run keeps against the box beside it: the first run in a row against what
follows, the last against what precedes, and a run inside fences or under a
radical against them. Fences and radical signs keep against what they enclose.
A narrower face therefore leaves its spare width at the rows' outer edges or
beside an operator's own space, never between a fraction and what touches it.
A formula stored before the editor refused such LaTeX, which label type still
cannot set, is drawn by the typesetter: standalone path-only SVG with
deterministic width, height, baseline, and source identity, letters and
numerals in bold sans-serif. Drafting text and callout weight/slant overrides also apply to
formulas; explicit LaTeX font commands retain their meaning. This is rendering
style, not a rewrite of the stored expression. Measurement and drawing use the
same layout, prepared before canvas, export, and server thumbnail rendering.
Formula artwork is embedded into the same formal scene used by canvas, SVG,
PNG, and vector PDF; it is never rasterized or persisted.

An ordinary RichText overbar is one explicit decoration over its authored
span. A subscript/superscript stack under that span does not inherit separate
bars, and text before or after the span neither breaks nor extends the bar.
The complete line is measured before start, center, or end alignment is
resolved, so continuation text cannot shift the anchor or escape export
bounds.

Derived visual diagnostics cover unplaced or unresolved symbols, symbol and
label overlap (free drawing text over a label included, measured by the ink
its words draw; polarity marks are left out), labels and free text struck
through by a wire (text over a part's outline is not reported: notes inside
a block are drawn there on purpose), Routes through symbols,
collinear same-Net Route overlap, a
Route leaving a pin backward or leaving a one-pin symbol from the side where no
other wire meets it, terminals resting on another Net's Route, short route
segments, ambiguous
Junction dots, unsatisfied layout constraints, and optional export-page
bounds. Diagnostics never mutate geometry. Unresolved symbols and ambiguous
Junction dots are blocking errors. Arbitrary wire angles are valid authoring
intent and produce no angle-only warning or error, including on protected
Routes. Explicit angle straightening remains an optional undoable operation,
not a diagnostic prerequisite. A terminal resting on another Net's Route is a
structural warning outside the gate. Spacing and other layout-quality findings
are observations. Text ink is what DejaVu Sans, the font stack's first face,
draws: across from the first glyph's outline to the last one's by the label
advance tables, side bearings included, and from capitals to subscripts.
Where a viewer draws Arial instead, text looks narrower than it is measured.

Every finding declares `category`, `confidence`, and `gateEligible`.
Structural findings describe high-confidence model, topology, or explicit
constraint conditions. Visual observations describe heuristic geometry and
require inspection of the formal render. A gate-ineligible observation must
never become an automatic layout objective merely because a quality policy
lists its code. Where deterministic primitive bounds exist, overlap analysis uses the
active symbol variant's visible geometry and clusters repeated overlaps. A
part's box ends at its visible pins, so two parts that meet pin to pin, one
lead continuing the other (a supply T or a coil on a transistor's source), do
not overlap.

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
  primitive part instead of relying on geometric guesses in the renderer. An
  adder's input signs are the Instance's own notation, laid out against its
  turn and mirror where they are made
  ([Razavi contract](razavi-visual-contract.md#signal-flow-adder-signs)).
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
- A new instance name keeps four units between its ink and the drawn artwork
  on whichever side it sits, the same for devices, gates, registers,
  converters and Analog Blocks. Beside the Symbol its capitals are centred on
  the body; below it they start one gap under the artwork; above it the
  subscript's descent is cleared first, so R₂ over a part never touches it.
  On every side a name reads first and its value under it (#1384): beside or
  below the part the value row is under the name's, and above it the value
  takes the row nearest the part, a W/L fraction far enough out to clear it,
  and the name stands a row over it. A name or a value shown alone takes the
  row nearest the part. Label coordinates are whole units, not
  connection-grid rounded; saved, authored placements are retained, and a
  label still exactly where an earlier rule placed it counts as untouched.
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
