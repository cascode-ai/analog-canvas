# Changelog

Notable changes to Analog Canvas. Entries describe what changed for the person
using the product, not the commits that got there.

## 0.9.2 (Preview candidate)

### Wiring

- Keep an existing loose wire endpoint under direct mouse control when it is
  extended. Automatic routing no longer inserts an extra turn or changes the
  direction chosen by the user.
- Join Nets when a dragged wire segment reaches an existing wire endpoint,
  while leaving an ordinary crossing through the middle of another wire
  electrically separate.

Project schema 57 makes a locally authored VDD Power Rail an explicit formal
Cell Pin. Opening a schema-56 Project attaches a stable terminal to each local
Rail's existing label without changing its physical Net or drawing geometry.

## 0.9.1 (Preview candidate)

### Netlist export

- Put `VDD` and `VSS` first on every Canvas-authored module and matching
  hierarchy call. Legacy VDD Power drawings acquire the same interface during
  export without rewriting the saved Project.
- Connect a manually authored PMOS with no explicit Bulk or No Connect to the
  selected profile's PMOS substrate, `VDD` by default. Explicit and imported
  connections remain authoritative.

### Editor interaction

- Let attached Net Labels move freely while retaining their electrical Net.
- Preserve the automatic route shown in the wire preview when finishing with a
  double-click, without reversing the elbow direction.

Project schema 56 is unchanged. Existing Projects are not rewritten when opened.

## 0.9.0 (Preview candidate)

### Netlist and device controls

- Keep SKY130 SCS output in native Spectre syntax without an extra SPICE
  language line, and arrange the compact Format, Process, device-target, copy,
  and Default controls around the live code editor.
- Choose reviewed NMOS, PMOS, resistor, capacitor, and inductor targets for
  SKY130, TSMC 28, and TSMC 180. The editor grows with short netlists, retains
  line numbers, and scrolls once it reaches its useful height.

### Drawing and presentation

- Keep annotation text, fractions, formulas, and polarity symbols upright when
  their attached drawing rotates; attachment positions continue to rotate with
  the drawing.
- Render transistor W/L fractions with the same typeface and a tighter bar that
  follows the actual numerator and denominator width.
- Remove the unintended Capacitor Section symbol from the component library.

### Site operation

- Keep first-party analytics pages, routes, styles, client reporting, and
  Durable Object handling in one module while preserving the existing data
  namespace and stored counters.

Project schema 56 is unchanged. Existing Projects are not rewritten when opened.

## 0.8.0 (Preview candidate)

### Project authoring

- Open complete Project Code and a live Netlist from the main toolbar. Both
  editors show line numbers and syntax colors; Project Code applies validated
  JSON as one undoable edit and protects drafts when the Canvas changes.
- Edit component and drawing Style as concise JSON. The toolbar keeps Gallery
  and Library on the left and Project Code and Netlist on the right, while
  drawing tools remain in the Library instead of taking permanent toolbar
  space.
- New blank circuits use `dut` as the Cell and netlist module name. Existing
  authored Cell names and real Testbench Cells keep their names.

### Netlist export

- Choose Format and Process independently in the live Netlist panel, edit the
  selected NMOS and PMOS targets directly, and restore every cached preset with
  one Default action. Copy uses a compact icon and never downloads a file.
- Keep SKY130 SCS exports entirely in Spectre syntax, including a native
  `include` declaration for the configured model library.
- Put `VDD VSS` first in generated Cell interfaces and hierarchical calls,
  including blank circuits without drawn supply symbols. Unconnected MOS bulk
  terminals use those module supplies, and generated supplies stay out of the
  Canvas probe list.
- Keep visible VDD Power connectivity explicit and editable through component
  property JSON. Built-in OTA labels retain their route positions instead of
  falling back to the upper-left corner.

Project schema 56 is unchanged. Existing Projects are not renamed or rewritten
when opened.

## 0.7.0 (Preview candidate)

### Netlist export

- Choose compact Abstract, SKY130, TSMC 28, TSMC 180, or Custom presets in
  the live Netlist panel. The last choice and edited profile remain cached in
  the browser.
- Export TSMC 28 MOS devices with `nch_ulvt_mac` / `pch_ulvt_mac` and `multi`,
  or TSMC 180 MOS devices with `nch` / `pch` and `m`. NPN and PNP devices also
  support an authored multiplier.
- Recover `0` and `VDD` from visible power markers in older and copied
  drawings. Unnamed internal networks use stable `net0`, `net1`, ... names,
  skipping authored name collisions without guessing meaning from device pins.

### Drawing repair

- Find historical wire segments whose angles are neither orthogonal nor 45
  degrees in Properties Issues, then straighten every repairable segment in
  the current Cell with one undoable action. Protected trunk and locked routes
  remain listed for manual review.

Project schema 56 is unchanged. Existing drawings are not rewritten by
opening them; the angled-wire repair runs only when selected from Issues.

## 0.6.0 (2026-09-15)

### Drawing and properties

- Choose each arrow endpoint independently: small, medium or large arrow,
  a dot, or no marker; existing open arrows remain available.
- Edit shared component parameters and colors together in Properties Code.
  Common values are shown, differing values are blank, and an explicit new
  value applies to the selection in one undoable edit.
- See Smart Snap alignment guides while placing copied components, including
  rotated, mirrored and multi-component copies.
- Mirror attached reference/value text positions with their components while
  keeping the lettering readable. Shorten both Port styles by one grid cell.
- Place DACs and other components reliably when clicking their preview text.
  Cycle from the alternate orthogonal wire corner to diagonal routing without
  an extra redundant corner step.

### Agent and Simulation

- Click Agent once for full editing access and a compact copyable connection
  message. Normal local development starts its Agent relay automatically.
- Recover dropped connections correctly instead of remaining stuck at
  Connected while Agent requests report the editor offline.
- Expire sessions after 30 idle minutes; Agent operations and manual edits
  renew them, so active work has no absolute session time limit.
- Keep manual editing and Agent editing available together during local
  development. Place both Port styles with their actual Cell terminal and Net.
- Display magnetic parameters independently through the shared Agent command.
  Show Simulation files directly under their experiment and initially expand
  only the active experiment.

Project schema 55 adds independent arrow endpoint styles. Existing Projects
remain importable; drawings affected by shortened Port contacts may need manual
route repairs. The currently published MCP 0.9.0 targets schema 54; use the
current HTTP Agent Kit or a compatible adapter for this Preview candidate.

## 0.5.0 (2026-09-13)

### Drawing and properties

- Place text with a cursor-following preview. Mix stacked fractions with other
  text, with centered numerator/denominator and a bar sized to the wider part.
  New text boxes default to bold, and text alignment uses precise text bounds.
- Edit annotations through live property JSON with inline option menus.
  Rectangles and circles have independent border/fill colors and front/back
  layers; rotation and arrow/line styles have discoverable choices.
- Show transformer and T-Coil coupling and inductance parameters independently.
  Swap Analog Block input and output polarities independently in Properties.
- Use consistent equilateral Analog Block triangles, grid-aligned left edges
  and balanced output leads. Digital gate bodies also align from the left;
  selection frames follow their visible artwork.
- Connect visible component pins crossed by a Power Rail when drawing or
  adjusting that rail.

Project schema 54 adds independent magnetic parameter visibility. Existing
Projects remain importable; some older drawings affected by the new symbol
geometry or pin columns may need manual layout or route repairs.

## 0.4.1 (2026-09-13)

### Agent authoring and simulation results

- Place components with native, attached reference/value annotations and real
  power connections. MCP 0.8.0 adds `set-instance-display` to control visibility
  without duplicate text. Net Labels name their Net and attach to its route.
- See Agent-started Project-folder runs, batches and sweeps in the GUI without
  changing the active folder or stealing focus. Open completed results without
  running the simulation again.
- Automatically preserve verified results in this browser's Saved results.
  Export a Project + results evidence ZIP when a verified input snapshot is
  available. Ordinary Project files remain source-only; browser archives are
  not Cloud Save, and storage failures are reported explicitly.
- Keep selected simulation Run targets explicit, avoid duplicate OP/MOS result
  displays, and use consistent names when placing hierarchical Cells.
- Start from four complete simulation example Projects with explicit replacement
  confirmation and source-aware guidance. Maximize Simulation to reclaim the
  application chrome while preserving editor state on restore.

Project schema 53 and the API 3.0 source-workspace contracts are unchanged.
The independently published MCP adapter advances to 0.8.0; existing pinned
installations must update separately.

## 0.4.0 (2026-09-13)

### Simulation and Agent

- Open the Simulation workspace on the public site to edit saved source
  experiments, run the hosted ngspice/SKY130 environment, inspect results,
  and export data. Qualified analyses include OP, DC, AC, TRAN, and Noise.
- Connect an Agent from the public editor through the existing revocable
  Claim Code workflow. The published MCP 0.7.0 adapter and HTTP Kit use the
  same editing and simulation contracts as the Preview channel.
- Hosted runs use bounded queues and owner-scoped results. Production keeps
  its own queue, records, and artifact store; Preview accounts and Projects
  remain separate. Both channels share the existing operator simulator.

### Properties

- Put Placement, Appearance, and Display first, and keep Netlist name and
  Netlist target together at the end of the property code.
- Show a netlist target name once, with a small arrow for choosing another
  model. Direct JSON editing and copying remain available.

Digital Timing remains unavailable on both hosted channels. Project schema 53
and the independently versioned MCP 0.7.0 distribution are unchanged.

## 0.3.0 (2026-09-13)

### Schematic authoring

- Edit component properties through one code surface, including multi-selection,
  visual variants, and compact color controls. Netlist identity and visual labels
  are presented separately; ordinary text selection remains available.
- Rotate components by 90 degrees with the standard controls. Explicit 45-degree
  orientations remain supported, with connected wires following the chosen
  orientation. Horizontal and vertical mirrors are independent.
- Move selected text and mixed selections together, and copy circuit selections
  between Cells and browser tabs.
- Place depletion NMOS and PMOS variants, resettable D flip-flops, and refined
  switch, amplifier, ADC, and DAC symbols from the component library.
- Preserve supply-marker ownership when editing or opening older projects;
  improve Net Label placement, composite wire landing, and terminal approaches.

### Compatibility and release channels

- The editor, portable host, and release package now report product version
  0.3.0. Project files use schema 53 and retain the supported migration chain.
- Production receives the current core editor. Analog Simulation and Agent
  connection controls remain Preview features; Digital Timing stays disabled
  on both hosted channels. Preview and Production accounts and private Projects
  remain isolated.
- The separately versioned MCP adapter remains at 0.7.0.

## 0.2.0

### Simulation

Analog Canvas is no longer only an editor. A circuit drawn here can now be
simulated without leaving it.

Until this release the product's own description ended with "not a simulator",
and that was accurate: you exported a netlist, went to another tool for the
answer, and came back to edit. The loop that matters most in analog design was
the one loop the product did not close.

**What runs.** A circuit whose every instance resolves to a PDK device model,
hierarchy included. A `.subckt` made of transistors is simulatable, and so is
a subcircuit of subcircuits of transistors.

**What does not.** A circuit containing an abstract block, such as a
signal-flow element or a behavioural amplifier, has no device model behind that
block and is refused. The refusal names the blocks responsible rather than
failing vaguely, so the way forward is visible: replace them with device-level
implementations.

**The testbench is yours.** Analog Canvas supplies the circuit and runs the
simulator. Stimulus, loads, analysis statements, and sweeps come from you. We
ship no templates and infer no intent, because a testbench encodes what you are
trying to prove and guessing it would produce confident answers to questions
you never asked.

**Where it runs.** Simulation runs on a hosted simulator (the same container
image, on a server we operate), which means the circuit netlist is uploaded
to run. If your circuit is not yours to upload, the
local host runs the same simulation on your own machine against your own PDK
version, and returns the same results.

**This release covers DC operating point and AC analysis.** Transient, sweeps,
and corner runs follow once this path is proven.

**A Project remembers its simulation setup.** Which Cell is the testbench,
which analyses and probes to run, and which simulator profile to use are saved
in the Project file beside the circuit (schema 37) and follow save, undo, and
the Gallery like everything else; voltage and current sources gain AC magnitude
and phase fields for the small-signal stimulus, and results themselves are
never saved.

### Drawing

**Move a part without dragging its wires along.** `Shift+M` arms the move and
the next click picks the part up; `Shift+drag` does it with the pointer. This
is the Virtuoso distinction: plain `M` stretches the wires with the part,
`Shift` leaves them where they were. The shortcut panel lists it, because a
capability nobody can find is one that does not exist.

**A dragged wire shows the path it will take.** The preview used to pull a
diagonal out of a wire whose far end stayed put, which is not a shape a
schematic wire can have.

**Wire ends that meet, join.** Dragging a wire so its end lands on another
conductor merges the two into one net, and so does dragging a part until its
pin lands on a wire. A wire that merely crosses another still does not
connect, and no longer complains about it. That distinction is the point: the
end you place deliberately is intent, the crossing is not.

**Arrows point both ways.** An arrow chooses whether its head sits at the end,
at the start, or at both, alongside the existing choice of head style.

### Symbols

**Switches reach their wire in one grid cell.** The leads on the three switch
symbols ran nearly two cells; the bodies are untouched. Two more switches
join the library: a plain-line switch without contact circles, and a
single-pole double-throw. The plain switch carries the double-throw as an
option rather than a sixth tile.

**Amplifiers can carry the letter their stage is named by**, editable per
instance, and ADC and DAC blocks join them with their own editable text. The
two converters sit next to each other in the Library, where alphabetical
order had put four tiles between them.

**The crossed differential amplifier is a state, not a second part.** Its
outputs already swapped from the properties panel, so the separate tile was
a duplicate of a control that existed.

**The comparator's glyph clears its body outline**, which it had been
overlapping by about a stroke width, and the quantizer is square rather than
half again as wide as it is tall.

### Text and labels

**A label with no text no longer sits on the canvas as an invisible target.**
Twenty-eight of the palette's parts had no designator to display, so their
labels rendered empty yet stayed clickable. Parts with nothing to show now
also drop the Reference toggle, which had been switching a thing that was
not there.

**Formatting a net name works.** Applying bold or underline to a bound name
used to be refused, because the name was compiled in a way that dropped
characters and the result no longer matched the name it was bound to. The
compiler now preserves every authored character, which also means underscores
and letter case stay as written rather than being reinterpreted.

**A label attached to something other than a part can be dragged.** A power
rail's label hangs off its junction and a drafting label off its rectangle;
neither could be moved, and the gesture silently did nothing.

### Gallery

**The docked Gallery pages, counts, searches, and filters like the wall
does**, through the same code, so the two cannot answer the same question
differently.

**A withdrawn circuit stays in your recycle bin while it is among your 25
most recent withdrawals.** Nothing expires on a clock, so the card states the
rule rather than naming a removal date it cannot honour.

### Reliability

**A failed deploy rolls itself back.** Post-deploy verification already
checked the live site; when it failed it left the site failing. It now
restores the previous version instead.

**A project saved before a schema change still opens.** The loader accepted
only the two most recent versions, which refused files saved the week before;
it now accepts anything the upgrade chain can carry forward.

**A missing code chunk answers with a refresh rather than a stack trace**, and
a stuck page can get itself unstuck.

### Labels

**A component can wear any label.** A Reference still follows its device
prefix — a resistor is `R…` — because the netlist prints it as the element
token. Typing something else over the Reference label, such as `gm`, no longer
ends in a refusal: the editor offers to keep the Reference for the netlist and
show the typed text as a label in its place. Properties gains a `Label` field
for the same free text on any placed component, including blocks that have no
Reference at all. The label is presentation only; it never reaches the
netlist.

### Unchanged

The electrical model is untouched. Connectivity is still explicit, a crossing
is still not a connection, and wires are still drawing. Simulation reads your
circuit and never writes it: a result cannot alter a net, and nothing about a
simulation is saved into the project file.

Existing project files are unaffected. There is no schema change and no
migration. A file that opened yesterday opens identically today.

See the [simulation architecture decision](docs/adr/simulation.md) for the
reasoning behind the scope change and the alternatives weighed against it.

## 0.1.0

The connectivity-aware schematic editor: structural SPICE import, a typed
circuit model persisted as one `.icproj.json` file, formal SVG, PNG, and PDF
export, deterministic SPICE and Spectre design netlists, a published gallery,
and an Agent API that edits the same live project as the human interface.
