# Shared simulation workflow

[Spec and raw-output rules](../simulation-specs.md) own measurements,
acceptance annotations, verdicts and result files;
[result handoff](../simulation-result-handoff.md) owns browser visibility,
retention and export. Never claim a result was saved merely because a run
started or the source Project was exported.

Hosted runs are for the Analog Canvas team only. For any other account,
`run`/`start` refuse `hosted-simulation-team-only`: keep authoring the
Project's Testbench (`simulation_folder` `template:"testbench"`,
`simulation_edit`) and tell the user to export the netlist and run it with
their own simulator. Never retry the refusal.

## Select the actual engine

Read the returned Profile and source language; config version alone does not
identify a simulator. VACASK owns native `parameters`, analyses, saves and
Python postprocessing: get current helper text from `simulation` /
`authoring-help` (especially `embed` and `postprocess`) and emit scalars with
`report_measurement`. Never put ngspice `.param`, `.temp`, `meas`, `let` or
rawfile snippets into VACASK; ngspice uses its own SPICE source, measurement
commands and rawfile collection. Never convert silently.

For config version 2, author analysis, saving and measurement in the native
language; collection does not replace authored output. Version 1's JSON
output/measurement/device-OP helpers are legacy-only; read the returned config
version and schema before choosing a helper. Helpers are optional, never an
execution prerequisite or a limit on authorized native edits.

## Folders, runs and results

Results the human should see need a `project-folder` source: create it with
`upsert_simulation_folder` in `transact.structureEdits` (MCP
`simulation_folder`) and save setup v4 files through File `simulation-input`
`update` with a `project-folder` owner (MCP `simulation_files`), each at the
current structure revision. Submit `run`, then `read` to completion;
`prepare`/`start` is for inspecting or reusing frozen input. Never invent
Profiles, analyses, output IDs or revisions. Preparation is not execution and
a started run is not a result. The hosted service allows one active run per
session (see `capabilities`): serialize starts or use a sequential Batch.

Treat analyses independently: one failed analysis or measurement does not
invalidate completed data, and a failed run outcome does not mean empty
results. Run reads are sample-free: `resultPreview` means file-backed details;
`run.details` gives execution, collection, Spec and diagnostic counts when
known (missing counts on a restored run mean unknown). Complete diagnostics
and samples are in registered files; real truncation is reported separately.
`catalog` lists datasets, units and representations; page a large one with
`section:"files"|"datasets"`, `offset`/`limit` until `page.nextOffset` is null
(a section page omits other sections and signalTargets). `capabilities` takes
`detail:"summary"` and `profileId`; `discovery.fullRequest` gets complete model
facts (HTTP defaults to full, MCP to summary). `export` retries evidence
publication after a storage failure and never reruns.

## Native ngspice capture

`save` selects vectors, `print` writes log text, `write` creates the rawfile the
collector reads. Save device parameters explicitly before an OP or DC sweep to
get one value per point; `save all` does not include internal device
parameters. Adapt to verified names (`V1` is an example):

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

Write after each analysis to collect; the collector takes one literal relative
path, with appendwrite for several plots. A log-only task needs no write. The
executor inserts no capture commands. A preparation's device/vector mapping is
discovery; the collected signals show what was saved. This is not VACASK
syntax.

Compute derived metrics in native code or scripts and state formula, units and
validity: VGS − VTH is not vgsteff; gm/(2π·Cgg) is a quasi-static fT estimate
that depends on the model's Cgg. Never silently take absolute values, drop
points or merge axes by row index.
