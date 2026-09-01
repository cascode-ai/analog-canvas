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
