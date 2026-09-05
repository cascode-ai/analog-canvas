# Analog simulation — minimal Preview surface

Use the top **Simulation** button. Opening the editor alone does not contact
the simulator. The simulation drawer loads on demand and leaves the existing
canvas available; it is separate from the development-only Digital tool.

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
then set OP/AC, optional corner/temperature, and voltage probes. Existing
hierarchical and source-current probes authored by the Agent are preserved
and can be removed individually. Apply commits `set_simulation_setup` into
the Project; saving/exporting and reopening the Project retains this setup.

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
Cross-Project publication, a GUI hierarchy probe picker, structured TRAN and
multi-run comparison remain outside this slice. Raw/Agent workflows retain
their existing capabilities. Browser regressions use a controlled executor
to verify interaction/protocol behavior; they do **not** certify OTA numbers,
model qualification or the separate real Preview acceptance journey.
