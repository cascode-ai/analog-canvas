# Shared simulation workflow

Read [Spec and raw-output rules](../simulation-specs.md) for engine-specific
measurements, acceptance annotations, verdicts and canonical result files.

## Select the actual engine

Read the returned Profile and source language; config version alone does not
identify a simulator. VACASK owns native `parameters`, analyses, saves and Python
postprocessing. Use `simulation` / `authoring-help` (especially `embed` and
`postprocess`) for the shared current helper text. Compute scalar metrics in
authored Python and emit them with the supplied `report_measurement` helper.
Do not insert ngspice `.param`, `.temp`, `meas`, `let` or ASCII/appendwrite
snippets into VACASK. Conversely, historical ngspice runs use their own SPICE
source, measurement commands and rawfile collection. Do not silently convert.

For results the human should inspect in the Project, use a `project-folder`
source, not a private session workspace. Create a canonical folder with
`upsert_simulation_folder` inside `transact.structureEdits` (MCP
`simulation_folder`), using the current Project structure revision and the
published folder schema. Save setup v4 source/config files through File Resource
`simulation-input` / `update` with a `project-folder` owner (MCP
`simulation_files`). Read the actual input revision before writing.

Use the sibling Simulation resource: `capabilities`, `prepare` with the
folder and current structure revision, `start` with the returned prepared ID
and digest, then `read` to completion. Preserve returned IDs; do not invent
profiles, analysis records, output IDs or revisions. Preparation is not execution,
and a started run is not a successful result. Read diagnostics and outputs, then
perform the requested measurements. For code-authoritative experiment config
version 2, author analysis, saving and measurement logic in the selected native
language; collection is not a substitute for authored output. Config version 1's JSON output/measurement/
device-OP helpers are legacy-only, not the version 2 authoring path. Read the
returned config version and schema before choosing a helper.

Read concurrency from `capabilities`; the current hosted service advertises one
active run per session. Serialize independent starts or use a sequential Batch.
Treat analyses independently: one failed analysis or measurement does not
invalidate completed analysis data, and a failed run-level outcome does not mean
the result is empty. Inspect per-analysis data and diagnostics before reporting.

For browser visibility, archival limits and source/result export, follow
[result handoff](../simulation-result-handoff.md). Never claim a result was saved
merely because a run started or source Project was exported.

## Native capture and external analysis

Helpers are optional authoring assistance, never an execution prerequisite or a
restriction on authorized native source edits. A successful prepare can go straight
to start. Run reads always return sample-free receipts; `resultPreview` means
file-backed details regardless of result size. `run.details` gives execution,
collection, Spec counts and diagnostic counts when known; missing counts on a
restored historical run mean unknown, not zero. Complete diagnostics and samples
are in the registered files. Actual file truncation is reported separately.
`catalog` lists datasets, units and representations. Use `section:"files"` or
`section:"datasets"` with `offset`/`limit` for a large directory; follow
`page.nextOffset` to null. A section page omits other sections and signalTargets;
the unfiltered catalog remains complete. Download chosen files for local analysis.
`capabilities` accepts `detail:"summary"` and optional `profileId`; its
`discovery.fullRequest` retrieves complete model facts. Default HTTP capabilities
remain full for existing clients; MCP requests summary automatically.
`export` is an optional inventory lookup and retries retained evidence publication
after a storage failure. It never starts another simulation.

For ngspice, `save` selects vectors, `print` produces log text, and `write`
creates the rawfile consumed by the existing JSON/CSV pipeline. A DC device
parameter sweep must save parameters before analysis to obtain one value per
sweep point. Adapt this native control fragment to verified source/vector names:

```spice
.control
set filetype=ascii
set appendwrite
save all
* Add verified internal device vectors to save before dc.
dc V1 0 1.8 0.005
write out.raw all
.endc
```

`V1` is an example source, not a discovered Project identity. `save all` alone
does not request every internal device parameter. Add resolved device expressions
explicitly for OP as well as sweeps. A preparation's device/vector mapping is
discovery, not proof of acquisition; the collected dataset's signals show what
was actually saved. Write after each analysis that should be collected; the current
ngspice collector supports one literal relative path, with appendwrite for
multiple plots. No write is valid for a log-only task. The executor does not
silently insert capture commands. This fragment is not VACASK syntax.

Compute derived metrics in authored native code or external scripts. Declare the
formula, units and validity conditions: VGS minus model VTH is not vgsteff;
gm/(2*pi*Cgg) is a quasi-static fT estimate whose meaning depends on the model's
Cgg definition. Do not silently take absolute values, drop invalid points or
merge different axes by row index. Plotting remains the consumer's choice.
