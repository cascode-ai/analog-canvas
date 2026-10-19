# RNL Interchange

Status: `proposed`

Primary owner: `@icm/rnl`

RNL (rich netlist, [rich-netlist/rnl](https://github.com/rich-netlist/rnl))
records how a circuit is drawn as statements in the comments of its SPICE or
Spectre netlist. This contract covers the editor's RNL export formats and RNL
import. The netlist they carry follows [netlist export](netlist-export.md);
the RNL language and its runtime belong to rnl.

## Rules

### Dependency

- The rnl runtime (`@rich-netlist/runtime`, WebAssembly in a Worker, loaded on
  demand) writes and reads every RNL statement. The editor never spells RNL
  syntax: it hands the runtime edit-transaction operations and reads its
  snapshot, so an rnl upgrade changes the written RNL without editor changes.
- WebAssembly stays out of packages the Worker and MCP bundles import
  (`@icm/netlist`, `@icm/symbols`, `@icm/derived`); only the editor loads it.
- Without the runtime, the RNL formats say so and copy nothing; the other
  formats are unaffected.

### Export formats

- The Netlist panel offers `SPICE+RNL` and `Spectre+RNL` beside `SPICE` and
  `SCS`. They print the same circuit with RNL records added; `SPICE` and `SCS`
  are unchanged. Another netlist dialect gets its own `<dialect>+RNL` format.
- An RNL format is read-only in the panel; Copy and Save take its text.
- Under an RNL format the panel carries an "About RNL" link to the
  introduction to RNL (<https://rich-netlist.github.io/rnl/en/>): a new tab in
  a browser, the system browser in the desktop app, which opens only its fixed
  list of links (`rnl` among them). The link is left out where the build links
  nowhere outside itself. The editor has one language, so there is one page.
- Bodies the netlist writes itself (ideal blocks, magnetics) print their ports
  in the terminal order of their RNL symbol: SPICE primitives in SPICE order,
  op-amps as their macromodels do (in+ in− V+ V− out), other blocks signals
  first and supplies last, transformers dotted end first. Comparators are
  drawn as `$COMPARATOR` (in+ in− out) and print as other blocks do: their
  bodies take no VSS, and the one with a numeric high level no VDD. A
  body's definition and its calls move together, so the circuit is the same;
  `SPICE` and `SCS` keep the editor's order.
- Each part is drawn with the RNL symbol the mapping table names, from a
  standard package or, for an appearance variant, the chopper or a 4-input
  gate, the `analog-canvas-extensions` package; it is placed at that symbol's
  registration point and turned by one of RNL's eight orientations. RNL's
  standard 4-input gates put their inputs on whole grid points, Analog
  Canvas's 0.8 apart, so its own (`$CANVAS_AND_4INPUT` and the rest) keep
  each wire as drawn.
- Diamond appearances of VCVS, VCCS, CCVS and CCCS export as the standard
  `$VCVS`, `$VCCS`, `$CCVS` and `$CCCS` symbols. Default circle appearances
  export as `$CANVAS_*_CIRCLE` from `analog-canvas-extensions`. Both preserve
  their appearance, pin positions and control connections through import.
- RNL's op-amp kinds (op-amps, comparators, differential transconductors) put
  - on top, at the inputs and at a differential op-amp's outputs. An Analog
    Canvas variant with − on top is that symbol flipped top to bottom: it is
    written as the symbol turned by its own orientation after `MX`.
- The header pins the standard series, `rnl-std` 0.3, and declares with its
  version each package the drawing uses that `rnl-std` does not bring in by
  itself, such as `rnl-std-functional` for an op-amp. A tool without that
  version then says so at the first statement.
- The header also uses `rnl-std-no-labels`, which clears the labels symbols
  bring with them (name, value, model), so the drawing shows only the labels
  the editor writes; formulas stay.
- Ground, supply and Cell Pin markers are written as `$GROUND`, `$SUPPLY` and
  `$IO_PORT`. Wires keep every bend. What the editor joins by contact (a wire
  through a junction or pin, touching endpoints) is joined explicitly, since
  RNL never connects by position; the dots the editor draws are written.
  Every marker and wire is written on the net the netlist prints it on: the
  netlist joins supply markers by name first (a copied ground glyph carries no
  claim of its own), and so does the export. A net's name is the one the
  netlist means: Spectre's escapes (`Vin\+`) are written plain (`Vin+`).
- A wire is written as drawn: a power rail bold, a body tie dashed, and a
  color or line style set on the wire as set. A wire through a junction stays
  one wire through it. A power label is written as a label on its net, named
  so the import knows it as a power label.
- Labels are written as the text they show, styled as shown; RNL cannot style
  part of a referenced name, so a written label does not follow a rename.
- A wire's direction arrow is an `$ARROW` mark on the wire, a current marker
  a `$CURRENT_ARROW` mark with its label hung on it, and a voltage marker its
  label with + and − beside it, all where the editor draws them. A floating
  symbol is a `$FIGURE` mark drawn with the part's RNL symbol.
- A drawn Cell's block is a symbol defined in the Cell's own level and set on
  the Cell itself, so every call is drawn with it; its pins name the printed
  ports and show their names. An external subcircuit's block is defined once
  in the file level, its pins numbered, and set on each call.
- Drawing objects are RNL shapes in their stacking order: rectangles,
  circles, lines and curves (a quadratic leg as the cubic that draws it),
  arrows with their heads, dots and outlines, leaders and callouts, and
  polarity marks; a rectangle or circle on the background plane is drawn
  under the circuit. Anything anchored to a part or a wire is written at its
  place. An object of a kind RNL has no form for (an arrow, a leader, a
  callout, a polarity text) is its shapes and texts named after it, each by
  its part: `%arrow3` its shaft or `%arrow3_outline`, `%arrow3_start` and
  `%arrow3_end` a head or dot, `%callout1_text`, `%polarity2_plus1`; the
  import joins them again.

### Failures

- Errors leave the RNL format without output and list in the panel's issues:
  a part turned by 45°, 135°, 225° or 315°; a part with no RNL symbol.
- Warnings keep the output and list there too, one per kind and drawing: a
  symbol from the `analog-canvas-extensions` package, labels written as fixed
  text, hidden labels left out, text placed along a
  wire written at a fixed place, formulas written as LaTeX source, tilted text
  written level, a floating symbol with no RNL symbol, a typography token
  written as its size, parts in the tray, a block whose artwork RNL cannot
  take drawn as RNL's stand-in box, a direction arrow on a slanted wire.

### Import

- File → Import → `RNL…` reads a rich netlist with its includes and package
  files. Project File, SPICE / SCS and Cadence SPICE are unchanged.
- The electrical import is the SPICE / SCS importer, called unchanged. The
  rnl runtime reads the same files (its snapshot, rnl-dev's editor-interface
  draft) and the drawing is laid over the imported circuit as a separate
  layer: CircuitIR never carries geometry ([circuit IR](circuit-ir.md)).
- Read back so far:
  - each part's place, orientation and variant, through the mapping table;
    a symbol two Analog Canvas variants draw, one flipped, reads back as the
    variant that needs no mirror: `$OPAMP_5TERM` turned `MX` becomes the
    default op-amp, unturned the inputs-swapped one; RNL's standard 4-input
    gates read back as Analog Canvas's own, their wires ending at its pins;
  - controlled sources as diamonds from the standard two-terminal symbols
    and the legacy `$CANVAS_*_DIAMOND` aliases, and as circles from
    `$CANVAS_*_CIRCLE`; legacy diamond aliases are read-only and export again
    as the standard symbols;
  - a Cell's block as the symbol the file defines for it: each pin's side and
    place, and the body;
  - Cell Pins, the importer's own, moved where RNL draws `$IO_PORT` (or a
    supply drawn on a port); ground glyphs on ground, supply glyphs claiming
    their net by its own name; a glyph anywhere else is drawn as a floating
    symbol, which the netlist does not read;
  - the ground pin the export adds (`VSS`, or `GND`, `GND__n`, drawn as
    ground rather than as a port) is ground again, and its callers stop
    passing a node to it, as before the export;
  - wires with every bend, a route from each pin or point to the next, a
    wire running straight through a point one route; a bold wire as a power
    rail, a dashed one to a MOS body as a body tie, any other line style or
    color as the wire's own; junctions at named points; wires of no length,
    which join what touches, are left to touching;
  - wire direction arrows, current and voltage markers (a label on a wire
    with + and − where the export puts them), and floating symbols;
  - labels where RNL shows them: a part's name and values bound to it, a
    Cell Pin's name, a net's name as a net label claiming the net by the
    name it has, or as a power label where the export wrote one, hung on the
    junction it was drawn at; any other text as a drawing text; a label a
    symbol alone gives is left to the symbol; a part the drawing places
    without its name or values keeps the editor's default labels for them
    hidden, in their usual place, since the export writes every label it
    shows, and so does a Cell Pin the drawing names only by a net label
    beside it;
  - a label as it was drawn: a part's name that is not its reference (M1 on
    the card XM1) is the label's own text; a net label stands on the Cell
    Pin it names when it is within four grid steps of one, else on the wire
    it stands beside (three grid steps), else where it stands; a current or
    voltage marker's label keeps its size and colour; scripts stand outside
    bold (`bold`, `italic`, then the scripts), so a subscript and the
    superscript after it stay stacked;
  - drawing shapes: rectangles (a closed line round a turned rectangle as a
    turned one), circles, lines and curves (a cubic leg as the quadratic it
    was raised from, or the nearest), arrows; the bottom layer is the
    background plane;
  - ellipses and arcs, which Analog Canvas does not draw itself: a round
    ellipse as a circle, any other ellipse or arc as the curve that draws it,
    legs of at most an eighth of a turn each the quadratic through its ends,
    an arc with a head as an arrow along it; a fill they have is left out,
    with a warning (`RNL_IMPORT_SHAPE_UNFILLED`).
- Analog Canvas's own bodies (an op-amp's, a gate's, an ideal block's) come
  back as the blocks that write them, as the SPICE / SCS import brings them
  ([SPICE frontend](spice-frontend.md)), in the port order the export wrote.
- Switches come back as their symbols show them. The SPICE / SCS import
  brings every switch Analog Canvas draws in with a CTRL pin, since each
  prints the same card; one RNL draws without a control pin (`$SWITCH`, its
  closed and simple kin) is the switch its label clocks again, its pins 1
  and 2, its label the text RNL shows, or, where RNL shows none, a hidden
  label naming the node its card's control met. A chopper's label is its
  clock's likewise. A card the conversion from Spectre renamed is found by
  its part's reference (`S1` for `XS1`) or by the name it was given (`XM1` for
  a SKY130 MOS `M1`); Spectre name escapes are decoded by the electrical
  importer, so net labels use the same plain name as RNL (`Vin+`).
- An object the export wrote as a named group comes back as that object, where
  its first shape stood: an arrow with each end's style (a filled head's size
  from the shaft's, the larger where both ends have one; an open head; a
  dot), an outlined arrow read from its outline and kept only where Analog
  Canvas draws the same outline again, a leader, a callout, a polarity text
  (marks alone as the sign they show). A group that does not read back as
  one stays as drawn, with a warning (`RNL_IMPORT_DRAWING_UNJOINED`).
- A part RNL does not place keeps the importer's placement, and a net it does
  not wire keeps its guide lines. A place or corner off Analog Canvas's grid
  (10 for a part, 2 for a corner) is moved onto it.
- The imported Project's netlist is electrically equal to the plain SPICE /
  SCS import of the same files; a drawing that would change it is left out,
  and the circuit comes in undrawn with an error saying so.
- The imported Project replaces the active one with recovery source
  `spice-import`; findings list in the import report.

## Contract

- Mapping table: `packages/rnl/src/symbol-list.json` — per Analog Canvas
  symbol and variant, its RNL symbol and package, the definition a glyph or
  drawing-only part draws, terminal order, registration offset, the flip
  (`MX`) when the variant draws the symbol upside down, and pins; a row with
  `import_only` (RNL's standard 4-input gates and legacy controlled-source
  aliases) only reads files back, its pins where the RNL symbol has them.
  Generated by rnl-dev's `build-symbol-list.mjs`; checked against the rnl
  runtime's published symbol catalog.
- Operations: `RnlOp` in `packages/rnl/src/export-ops.ts`, after rnl's
  editor-interface draft (snapshot and edit transaction).
- Codes: errors `RNL_ROTATION_NOT_QUARTER`, `RNL_NO_SYMBOL`; warnings
  `RNL_NOT_STANDARD_SYMBOL`, `RNL_TEXT_FIXED`, `RNL_TEXT_HIDDEN`,
  `RNL_TEXT_ALONG_WIRE`, `RNL_TEXT_FORMULA`, `RNL_TEXT_TILTED`,
  `RNL_DRAWING_NOT_EXPORTED`, `RNL_NOT_PLACED`, `RNL_BLOCK_STAND_IN`,
  `RNL_HIDDEN_PIN_WIRED`, `RNL_GLYPH_UNCONNECTED`, `RNL_NOT_NETLISTED`,
  `RNL_WIRE_UNNAMED`, `RNL_WIRE_ARROW`.

## Acceptance criteria

- The mapping table draws every built-in symbol, follows the registration
  rules and matches each symbol's pins (`packages/rnl/src/symbol-map.test.ts`).
- Every symbol of the mapping table is in the package the rnl runtime's
  catalog says defines it, with each pin where the runtime puts it and
  leaving the way it says, so an rnl upgrade that moves a pin fails there
  (`apps/editor/src/features/netlist-export/rnl-symbol-catalog.test.ts`).
- Orientations and registration put every pin where the editor draws it in all
  sixteen orientations (`packages/rnl/src/orientation.test.ts`).
- Reordered bodies keep every port-to-node connection and leave `SPICE` and
  `SCS` byte for byte (`packages/netlist/src/body-port-order.test.ts`).
- The simulation examples export with no error, every part, glyph, wire, dot
  and label written, and name no package; an op-amp names
  `rnl-std-functional`, an appearance variant `analog-canvas-extensions`
  (`packages/rnl/src/export-ops.test.ts`).
- Desktop and local hosts serve `.wasm` as `application/wasm` and allow
  WebAssembly compilation only (`apps/desktop/src/app-protocol.test.ts`,
  `apps/local-host/src/local-host.test.ts`).
- A file the export wrote imports with every part where it was drawn, its
  labels, block layout, marks and shapes, and the same netlist; 4-input gates
  are drawn with Analog Canvas's own symbols, every wire as drawn, and RNL's
  standard ones read back as Analog Canvas's; controlled sources drawn as
  circles or diamonds keep their appearance through their canonical symbols,
  and legacy diamond aliases remain readable (in Spectre the voltage-controlled
  ones, as the Spectre import reads no native `ccvs` or `cccs`); a Spectre netlist with
  a SPICE section keeps every record out of it
  (`apps/editor/src/features/netlist-export/rnl-round-trip.test.ts`).
- Each built-in block's body, in either dialect and in RNL's port order,
  imports as the block and exports again unchanged
  (`packages/netlist/src/built-in-bodies.test.ts`).
- In the built editor, the Netlist panel copies `SPICE+RNL` and `Spectre+RNL`
  as the runtime writes them in its Worker, and File → Import → `RNL…` brings
  the copied file back with every part where it was drawn and the same netlist;
  examples opened from the library, their devices bound to the process, come
  back through either format, in SKY130 and Abstract, with every part, ground,
  junction and wired pin, each wire drawn as it was (power rails, body ties, a
  wire through a junction as one) and each power label a power label
  (`apps/editor/e2e/rnl-interchange.spec.ts`; the same in Node, with the
  editor's entry step, in `rnl-round-trip.test.ts`).
- Under an RNL format the panel shows the "About RNL" link, to the
  introduction page in a new tab, and under no other format; the desktop app's
  list of links has it (`apps/editor/e2e/rnl-interchange.spec.ts`,
  `apps/desktop/src/external-links.test.ts`,
  `apps/editor/src/features/netlist-export/about-rnl-link.test.tsx`).
- The library's five examples (Common-Source Amplifier, Two-Stage Op Amp,
  Current-Mirror-Loaded Differential Pair, Fully Differential Two-Stage Op
  Amp, Five-Transistor OTA) in either process and either format come back
  with every label as it was drawn, in the editor and in Node: the same
  count (none shown twice), text, anchor point, alignment, turn, size and
  ink, anchored to the same kind of object, and a hidden label still hidden
  (`apps/editor/e2e/label-census.ts`, run by both). Source values, engineering
  suffixes and decoded Spectre names follow the SPICE frontend contract;
  their labels receive the same text and ink checks as other labels.
