# Analog simulation — Code workspace

Use the top **Simulation** button to open Code beside the ordinary Canvas.
Opening the Editor alone does not load the code editor or start ngspice. This
workspace is separate from the development-only Digital tool.

Before setup, Simulation shows a three-step Agent guide: connect your Agent,
describe your goal, and review the results. A prominent status card shows the
connection state and next action. **Connect Agent** opens the same connection
panel as the editor's **Agent** button; connected sessions offer **Connection details**.
State changes never open dialogs or start work by themselves. After setup,
the Agent entry stays compact in the toolbar, including when maximized.
**Set up manually** creates the same source starter yourself, and
**Explore examples** expands the optional example projects.
Save, Run and file operations remain usable without an Agent.

## Circuit, source and files

Sim Code and Properties occupy independent right-side panes and remember their widths.
**Explorer** opens a narrow project tree beside the code. Code files appear
directly under each experiment, without an extra Source directory. On opening a
Project, only the active experiment is expanded; the others start collapsed.
The **Run** row, tagged `tmp`, is collapsed by default and
contains expandable **Results** (raw/CSV) and **Logs** groups. Preparation
snapshots and internal evidence are not shown in the everyday file tree.
Source paths also form expandable directories. Choose an experiment there, or
create, clone, rename or delete one. Multiple experiments can use the same drawn
Testbench; a different topology is an ordinary separate Cell.

A generated Circuit file is marked with a diamond. Its topology and device
identity belong to Canvas. You can edit mapped numeric parameters, but changing
nodes or adding/removing devices must happen on the schematic. A structural
paste is rejected in full. Properties and mapped code changes use the same
undoable Instance edit.

Other SPICE files are authored source. You or an authorized Agent can edit
them directly, use completion/hover help, or insert a template. The entry file
is the Run target even while viewing another file. Invalid SPICE or JSON can
be saved; preparation reports what needs repair rather than losing the draft.

**New experiment** asks for a name and, when multiple Profiles are available,
an environment. It uses the current Canvas Cell and an OP starter.
Helper offers analysis commands and argument hints without adding
text to the saved file until you explicitly insert or type it.

The compact Save and Run icons share the toolbar with Explorer. **Save source**
applies pending files in the current simulation folder to the current Project,
without signing in or making a cloud request. Ctrl+S inside the code editor does
the same. Its icon and tooltip distinguish pending, applying, applied and failed
states; a failed apply retains the draft for repair and retry. Applied source is
covered by the Project's browser recovery, not a cloud backup. **File → Save**
(or the project-level shortcut outside code) still saves the entire Project to
the signed-in cloud account.

Available environments come from the configured executor. Production offers
ngspice and VACASK Profiles; each uses its own native source language.
Their internal `experiment.json` is hidden from Source and file tabs, but
retained in Project backups. Legacy or damaged configurations and pending
configuration drafts stay visible for compatibility and repair; they are not a
new environment picker.
Hover a folder to see its bound Cell without adding text to the file row.
Use file/folder context menus to copy, download or create files. Right-click a
file tab (or press Shift+F10 while it is focused) to close it, close other tabs,
or close all tabs. Closing tabs retains files and pending drafts. Native analyses,
acquisition, measurements and nominal temperature belong in SPICE. Older
experiments retain their legacy configuration until explicitly migrated through
Helper. This example runs OP and AC and retains both plots:

```spice
.control
set filetype=ascii
set appendwrite
op
write out.raw
ac dec 20 1 1G
write out.raw
.endc
.end
```

An existing entry already has its own control/end block: edit that block rather
than pasting a second complete program. Native `write` captures the current
plot only. Noise templates capture density and integrated plots explicitly.
New templates use `out.raw`. Current source-native experiments collect the
single literal path declared by native `write` commands; dynamic or multiple
paths need repair. Legacy configurations retain their explicit collection path.
The selected executor must support the declared capture contract.

Code has local Undo while typing. Save commits through the Project edit path;
Project Undo/Redo owns committed changes. Switching files retains local text
history, caret, selection and scroll. Run/Prepare and File Save/Export flush
pending source first. **Check and Save** checks and saves that same captured
snapshot. Another writer's conflicting edit keeps your draft visible and asks
for repair; it is not silently overwritten.

## DUT and Testbench

1. Define the DUT Cell's formal ports on its canvas. Its generated Symbol is
   ready for placement without a separate review step.
2. Use **Manage Cells… → New Cell** to create an ordinary Testbench Cell, then
   use **Place Cell** to place the DUT there. The Project top remains unchanged.
3. Draw sources and loads, then create an experiment for that Testbench. Its
   generated binding prints the drawn topology; source text owns the analyses.
4. Alternatively, use a generated subcircuit binding and write the DUT call,
   sources and loads in authored text. Fully textual experiments need no Canvas.

Independent V/I sources keep DC, AC and transient parameters on their Instance.
PULSE/SIN/PWL and AC can coexist because they apply to different analyses.
VDD/GND markers are not voltage sources. Current output direction is positive
entering the selected terminal; **Pick current on Canvas** uses the actual pin
endpoint. **Pick Net on Canvas** adds a voltage output with its concrete
hierarchy occurrence.
Ambiguous occurrences are reported instead of guessed. New experiments save
acquisitions in native source (`save`/`.probe`); model-specific current and
operating-point vectors require a supported mapping. Older experiments may
retain advanced output bindings in their legacy configuration.

Authorized Cloud Project Cell reuse still uses **Import Cell** and the common
Cell-closure planner; Agents use `project_cells`. Imports are independent
Project-local copies, not live remote references.

## Try the existing OTA

The bundled five-transistor SKY130 example contains ordinary DUT/Testbench
Cells and saved OP/DC/AC/TRAN/Noise, bias-detail, corner and waveform experiments.
They are authored native VACASK source for the `vacask-sky130-candidate`
environment offered by the hosted service. A local editor without that Profile
can still open/edit the example but cannot execute it there.

Open the repository's
`apps/editor/src/examples/five-transistor-ota-sky130.icproj.json` with
**File → Import Project File…**, or visit
`/editor?example=five-transistor-ota-sky130`. For ngspice, use the separate
`netlists/ngspice-ota-qualification/source.icproj.json` acceptance Project;
changing only a Profile ID does not translate native source between engines.
Reference results apply to their declared circuit, models and environment,
not automatically to a modified example or another simulator.

## Prepare, run and recover

**Preview input netlist…**, in the active experiment's context menu, compiles
without executing and opens the prepared input read-only.
**Run** captures source and starts the
ordinary run. A legacy configuration's saved Run Plan can instead start its
sequential sweep batch. **Cancel run**
requests cancellation; closing/minimizing a presentation is not cancel.
Input errors affect that operation, not the Project or Agent session. Correct
the code and run again. A missing local executor is a configuration issue;
it does not block editing or saving.

Legacy version-1 configurations retain `runPlan` sweeps over corner,
temperature, named variable or exact Instance parameter axes; preview shows
combinations before execution. New version-2 experiments own parameter and
temperature sweeps in native SPICE. Multi-experiment batch selection,
cancel/retry and ordinary per-item results reuse the same Run service.

The current qualified analysis/corner set comes from capabilities/Profile.
Point-count estimates warn about likely output limits without rejecting an
Agent merely for a large estimate. An actual safety/capacity limit can still
refuse a run with a repairable explanation.

## Results, history and exports

**View executed netlist…** opens the actual deck captured for the selected run,
not a newly compiled version of the current source. **Export diagnostic bundle…**
exports that run's complete evidence, including preparation snapshots, source
maps, environment/result metadata and execution artifacts. These commands are
available from the active folder/Run context menus.
Before any run, the diagnostic export uses the latest prepared input instead.
Ordinary file-tree downloads contain only the selected visible source/output
files; hiding diagnostics does not delete them or remove Agent access.

Specs and Console share the row below Code. Specs shows **Spec / Sim result /
Expected / Judgment**, evaluated by the shared service from the captured run
input. There are no built-in Plot, Compare or OP presentation views. Native OP,
AC, DC, TRAN and Noise execution and complete raw/CSV remain available.

Write uniquely named native measurements and ordinary comment annotations:

```spice
meas tran peak MAX v(out)
* @spec peak <= 1.8 unit=V
```

These comments are ICM acceptance rules, not SPICE commands. Helper can insert
an editable example; Agent or manual authoring uses identical files. See the
[Spec protocol](../agent/simulation-specs.md) for range/target rules and units.
Missing measurements and invalid rules are Not evaluated, never fabricated
zeros or Failed. Measured values without a rule have no judgment. Editing input
marks the previous report stale; it is never reevaluated against live edits.

Explorer contains source files and a run directory. Ctrl/Cmd-select or Shift
select files, right-click Download, or download a directory with its descendants.
Raw, full analysis CSV and specs.csv are visible for external plotting and
analysis. The machine report specs.json remains available through File Resource
and diagnostic exports, not as an everyday tree item. The Agent reads the same
report and artifacts without opening a panel.
The legacy simulation-plot export returns SIMULATION_PLOT_RETIRED.

Run history is in Explorer. Completed runs are retained in this browser, not
embedded in the Project or Cloud-synchronized. Open a saved result without
rerunning it; the Run/folder context menu offers Archive current run, Download
complete run, and (for an opened archive) Download project + results. Diagnostic
exports retain the captured netlist, source maps and other evidence without
showing internal directories in the ordinary tree.

Sim Code is an independent right workspace alongside Library/Gallery and
Properties. Its minimize, resize and full-window maximize do not close Properties
or discard editor state. Maximize results temporarily uses the workspace;
Restore returns to the editor. Completion updates compact status without moving
keyboard focus or opening a dialog. Use Cancel to stop a run.

Closing a tab is not reliable cancellation of an admitted hosted run. Use Cancel.
Replacing the Project ends its presentation scope; revoking an Agent affects its
own scope, not a human run.

## Agent parity and acceptance

The same File Resource reads/updates authored files and mapped numeric spans;
simulation helpers produce source/config edits rather than a private deck.
Agents can create an unbound experiment, author files, recover from an error,
prepare, start/read/cancel, run a batch and export artifacts without a special
GUI-only setup step.

Browser regression tests use a controlled executor to verify interaction.
They do not certify numerical correctness. Real GUI and public MCP journeys
must identify the tested commit/Profile and actual results; deployment smoke
checks alone do not establish that every interaction was tested.
