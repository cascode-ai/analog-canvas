# Analog simulation — minimal Preview surface

Use the top **Simulation** button. Opening the editor alone does not contact
the simulator. The simulation drawer loads on demand and leaves the existing
canvas available; it is separate from the development-only Digital tool.

## Try it: the bundled five-transistor OTA

The editor ships a Sky130 five-transistor OTA with its stimulus and a saved
OP + AC setup. On the preview channel open
`https://analog-canvas-preview.tokenzhang.com/editor?example=five-transistor-ota-sky130`,
press **Simulation**, then **Run**. The operating point returns
v(vout) ≈ 0.75898 V, v(ibias) ≈ 0.60440 V, v(xdut.tail) ≈ 0.28487 V and
v(xdut.nleft) ≈ 0.75898 V, and the AC sweep plots 1 Hz–1 GHz. The preview
deploy runs this same journey against the live simulator before it goes
green, so those numbers are also its acceptance evidence. The Gallery panel
lists published circuits, not bundled examples; the `?example=` link and
**File → Open** on `apps/editor/src/examples/five-transistor-ota-sky130.icproj.json`
are the two ways to reach it.

## DUT and testbench

1. Define the DUT Cell's formal ports. In **Edit → Manage Cells → Review
   Symbol**, review its derived symbol before placing its first instance.
2. With that DUT Cell active, choose **Simulation → New testbench from current
   Cell**. An ordinary Cell is created and the DUT is offered at the cursor.
   Click to place it; Escape cancels placement, not creation of the empty Cell.
   The Project top is unchanged. Both operations use normal Undo/Redo.
3. Place and wire sources on this testbench canvas. Edit their DC and AC
   parameters in the existing instance Properties. No second copy of source
   values is stored in the simulation setup.

You can also use the regular Cell Manager and Place Cell commands. On the
Agent side, public `create-cell` and `place-cell` authoring actions use that
same hierarchy, followed by the existing simulation configure operation.

## Setup, run and results

Open **Setup**, choose the testbench Cell and advertised environment Profile,
then set OP/AC, optional corner/temperature, and probes. Voltage probes may
target a Net at the Testbench root or in a concrete DUT occurrence; current
probes may target voltage sources. Each choice is written to the same
occurrence-aware probe contract that Agent authoring uses. Apply commits
`set_simulation_setup` into the Project; saving/exporting and reopening the
Project retains this setup.

**Prepare deck** compiles without running. **Run** prepares the current saved
setup and starts that immutable input through the same service as MCP. It
does not run unapplied form edits. Input diagnostics leave the Project and
session intact: correct the input and run again. Run failures keep available
evidence and never automatically resubmit work.

OP values and AC plots consume the shared structured result. Console,
diagnostics, input identity and downloadable deck/raw/CSV artifacts are
available alongside the result. Bounded result previews are labelled; export
the complete artifacts when needed. Editing the Project marks older results
as belonging to an earlier revision.

Closing the drawer keeps a run alive. **Cancel run** asks the execution
service to cancel; it is not simulated by hiding a spinner. Replacing the
Project or closing its editor ends that browser-owned scope. Revoking an
Agent affects its own scope, not a human run. Runtime receipts and results
are transient, not saved inside the Project.

## Current boundary

This is the B/C local-DUT and minimal human interface slice, not completion
of all F1R/F5 requirements in the [v13 plan](../roadmap/simulation-vertical-integration-plan-v13.md).
Cross-Project publication, structured TRAN and multi-run comparison remain
outside this slice. Raw/Agent workflows retain their existing capabilities.
Browser regressions use a controlled executor
to verify interaction/protocol behavior; they do **not** certify OTA numbers,
model qualification or the separate real Preview acceptance journey.
