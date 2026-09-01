# Changelog

Notable changes to Analog Canvas. Entries describe what changed for the person
using the product, not the commits that got there.

## 0.2.0 (unreleased)

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

**Where it runs.** Simulation runs on hosted containers, which means the
circuit netlist is uploaded to run. If your circuit is not yours to upload, the
local host runs the same simulation on your own machine against your own PDK
version, and returns the same results.

**This release covers DC operating point and AC analysis.** Transient, sweeps,
and corner runs follow once this path is proven.

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

### Unchanged

The electrical model is untouched. Connectivity is still explicit, a crossing
is still not a connection, and wires are still drawing. Simulation reads your
circuit and never writes it: a result cannot alter a net, and nothing about a
simulation is saved into the project file.

Existing project files are unaffected. There is no schema change and no
migration. A file that opened yesterday opens identically today.

See ADR 0055 for the reasoning behind the scope change and the alternatives
weighed against it.

## 0.1.0

The connectivity-aware schematic editor: structural SPICE import, a typed
circuit model persisted as one `.icproj.json` file, formal SVG, PNG, and PDF
export, deterministic SPICE and Spectre design netlists, a published gallery,
and an Agent API that edits the same live project as the human interface.
