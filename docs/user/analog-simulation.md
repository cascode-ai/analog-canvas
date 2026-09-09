# Analog simulation — minimal Preview surface

Use the top **Simulation** button. Opening the editor alone does not contact
the simulator. The simulation drawer loads on demand and leaves the existing
canvas available; it is separate from the development-only Digital tool.

## Try it: the bundled five-transistor OTA

The editor ships a Sky130 five-transistor OTA core, its diode-connected bias
replica, and two ordinary Testbench Cells sharing the same clean schematic
layout. The PULSE Testbench is the default; the second changes only VINP to a
SIN source so both structured waveform forms remain directly runnable. Its
saved setup collection retains the stable OP + DC + AC + TRAN numerical
acceptance run and adds a separate complete OP + DC + AC + TRAN + Noise run, a
focused bias-point run with NMOS/PMOS operating-point details and supply
current, a dense DC transfer sweep, TT/FF/SS/FS/SF AC setups, focused PULSE and
SIN transient runs, and a focused Noise run. Saved scalar measurements cover
Value, Value at, Minimum, Maximum, Peak to peak, Mean, and RMS. On the preview
channel open
`https://analog-canvas-preview.tokenzhang.com/editor?example=five-transistor-ota-sky130`,
press **Simulation**, then **Run** to execute the default qualified setup. The
operating point returns
v(vout) ≈ 0.75898 V, v(ibias) ≈ 0.60440 V, v(xdut.tail) ≈ 0.28487 V and
v(xdut.nleft) ≈ 0.75898 V. The DC sweep covers VINP from 0.86 V to 0.94 V,
the AC and Noise sweeps cover 1 Hz–1 GHz, and the PULSE transient source moves
VINP from 0.90 V to 0.91 V. The SIN Testbench applies a 10 mV, 1 MHz signal
around 0.90 V. The preview
deploy runs this same journey against the live simulator before it goes
green, so those numbers are also its acceptance evidence. The Gallery panel
lists published circuits, not bundled examples; the `?example=` link and
**File → Open** on `apps/editor/src/examples/five-transistor-ota-sky130.icproj.json`
are the two ways to reach it.

Independent voltage and current sources share four transient modes: None,
PULSE, SIN, and PWL. PWL accepts at least two comma-separated `time value`
pairs, for example `0s 0, 1ns 0, 2ns 1.8`. The same authored points print as
SPICE `PWL(...)` or Spectre `type=pwl wave=[...]`; AC magnitude and phase remain
an independent small-signal setting.

The five AC corner setups remain independent Project records. Select two or
more setups in the Setup menu and choose **Run selected** to prepare all of
them at the current Project revision and run them sequentially. The compact
batch strip shows queued, running, completed, failed, and cancelled members;
selecting a completed member opens its ordinary Run result. Batch coordination
is session-only and does not change the Project format.

One saved structured setup may also own Design Variables and a reusable Run
Plan. A variable gives one value a readable name and binds it to one or more
exact Instance parameters. Choose Nominal for one run, or Sweep to combine
corner, temperature, variable, and advanced exact-parameter axes. Settings
shows the Cartesian point count before execution. **View points** expands the
actual combinations. The plan reuses the bounded sequential batch and each
completed member opens through the common batch result strip.

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

Open **Setup**, create or select a named setup, then set OP/DC/AC/TRAN/Noise,
process corner, optional temperature, and outputs. The current SKY130
environment offers TT, FF, SS, FS, and SF. New setups use TT. The runtime
Profile is selected automatically and shown by a friendly environment name;
its stable ID remains saved in the Project and visible to Agent/API clients for
reproducibility. A Profile picker appears only when several compatible
environments are advertised or a saved environment is no longer available.
Noise asks for the positive output Net, an optional negative output Net
(Ground when omitted), the Testbench-root independent input source, and a
frequency sweep. Its result keeps output/input-referred density curves and
integrated totals together in one Noise analysis.
Voltage
outputs may target a Net at the Testbench root or in a concrete DUT occurrence;
current outputs may target circuit terminals. Each choice is written to the
same occurrence-aware output contract that Agent authoring uses. Apply commits an
`upsert_simulation_setup` into the Project. One Testbench Cell may have several
setups (for example bias search and AC response), while a different topology
uses a different ordinary Testbench Cell. Saving/exporting and reopening the
Project retains the whole named setup collection.

**Design Variables** and **Run Plan** live in the same Settings page. Variables
store their nominal value and explicit parameter bindings. The advanced direct
parameter axis remains available for expert exact-target control, but named
variables are preferable when the same control is reused or drives several
parameters. The Setup menu continues to select, clone, delete, and batch several
setups; it no longer owns a separate temporary Sweep command.

The optional **Measurements** section saves named scalar questions about those
outputs. Choose an enabled analysis, an Output, and Value, Value at, Minimum,
Maximum, Peak to peak, Mean, or RMS. A Value-at coordinate and every window use
the analysis's SI domain (sweep units, hertz, or seconds). Mean and RMS are
available for TRAN and require a time window. **Apply setup** saves these rules
with the Setup; it never freezes the number from the last run.

**Prepare deck** compiles the nominal input or every saved Run Plan point
without running. **Run** prepares the current saved setup and starts either its
single nominal input or its sequential Run Plan batch through the same service
as MCP. It
does not run unapplied form edits. Input diagnostics leave the Project and
session intact: correct the input and run again. Run failures keep available
evidence and never automatically resubmit work.

OP values and AC plots consume the shared structured result. For direct Net
voltage outputs, **Operating Point → Show on canvas** paints the value on the
exact authored Net and hierarchy occurrence; choose named/focused Nets or all
collected Nets. Derived expressions and raw node-name text are never guessed
back onto canvas objects. Editing the Project pauses these labels until a new
matching run completes. Console, diagnostics, input identity and downloadable
deck/raw/CSV artifacts are available alongside the result. The compact
**Export** menu in Results downloads the visible Plot as standalone SVG or
2× PNG (multiple visible charts are bundled), the complete authored-output
CSV files, or the complete run ZIP. Image export follows the current viewport,
trace visibility and markers; CSV remains the full numerical artifact.
Bounded result previews are labelled; export the complete artifacts when
needed.

Each structured run evaluates saved measurements and also derives conservative
automatic summaries from the complete evaluated outputs: OP value;
DC/AC/TRAN minimum, maximum and span; and time-weighted TRAN mean/RMS.
**Measurements** labels the two groups separately and stays as one compact
folded summary during normal review. If any metric lacks enough finite samples
it opens automatically and shows the reason; that local metric remains
unavailable without turning a successful simulator Run into a failure. The
same typed rows are returned to Agent clients and exported as
`measurements.csv`. Agents use `simulation_measurement` to list/upsert/remove
the same rules, or replace the complete typed Setup through
`advanced_transact`.

**Compare** can keep up to five completed structured results in the current
Simulation session and align saved rules by measurement ID and automatic
summaries by output identity, analysis, metric and unit. Keep a result, edit
the circuit or conditions, run again, and inspect the current and retained
columns. Compatible DC, AC, TRAN and Noise outputs are also overlaid on shared
waveform axes; incompatible domains or units remain separate rather than being
silently resampled. Completed batch items populate the same comparison view.
These comparison copies are transient.

Choose **Archive** on a completed result to keep its verified run files and
view locally in this browser. **Compare → Browser archives** can reopen or
delete up to ten archives for the Project after closing and reopening the
Editor. An archive is not embedded in the Project and is not synchronized to
Cloud Projects; use **Complete run · ZIP** for a portable copy. If browser
storage is unavailable or full, simulation and ZIP export remain usable.

Closing the drawer keeps a run alive. **Cancel run** asks the execution
service to cancel; it is not simulated by hiding a spinner. Replacing the
Project ends its browser-owned presentation scope. Closing a tab is not a
reliable cancellation operation: an admitted managed Preview run can continue,
with owner-scoped evidence retained for one day. Use Cancel explicitly. Revoking an
Agent affects its own scope, not a human run. Runtime receipts and results
are transient, not saved inside the Project.

## Current boundary

The current UI supports local DUT/Testbench reuse, named saved setups, and
independent Cell-closure imports from authorized Cloud Projects. The GUI uses
**Import Cell**; Agents use `project_cells`; both call the same import planner.
The [simulation roadmap](../roadmap/simulation-remaining-work.md) retains the
integrated cross-Project acceptance boundary rather than treating that
implemented flow as future functionality.
Persistent Project result archives are not provided by the session comparison
view. Raw/Agent workflows retain their advertised capabilities.
Browser regressions use a controlled executor
to verify interaction/protocol behavior; they do **not** certify OTA numbers,
model qualification or the separate real Preview acceptance journey.
