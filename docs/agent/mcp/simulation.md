# MCP simulation tools

## Quick path

1. Discover `simulation` capabilities once and select the advertised Profile/engine.
   MCP requests compact capabilities by default. Follow `discovery.fullRequest`
   (optionally selecting `profileId`) for devices, dependencies and model symbols.
   For a basic simulation, read `netlist_code` and the required Cell interface;
   a full drawing Snapshot and all authoring help are unnecessary.
2. Create a saved `simulation_folder` for results the user should keep. Read and
   update native source with `simulation_files`; reuse successful update receipts'
   revisions/digests instead of rereading to confirm the save.
   Creation returns `source` with its owner, revision and file paths: write the
   intended source directly, or read just the file whose existing text you need.
3. `prepare` freezes that source. On success, `start` directly with its ID/digest
   and optional outer `waitMs:20000`. MCP polls the same run internally with
   fresh read IDs. A still-running receipt can continue with `read` and `waitMs`.
   The budget bounds polling; an in-flight request retains its network timeout.
   Preserve the start request ID on an uncertain start; when a run ID is known,
   resume reading that run. Waiting never repeats execution.
   Prepare defaults to a compact MCP response with a complete `preparation.json`
   artifact; outer `detail:"full"` exposes the original complete mapping inline.
4. On completion, `simulation_files` `sync` with `runId` obtains the directory
   and downloads results into a local Project base. It transfers at most two
   files concurrently and returns local paths, preserving completed files on
   partial failure. Read/analyze these local files. Separate `catalog`/`export`
   calls are needed only to select or investigate particular evidence.
   For one plot, set `analysisIndex` and `roles:["table"]` on `sync`; the tool
   resolves file IDs internally. Omit selectors for all files, or use `fileIds:[]`
   for directory only. Waveform arrays and logs are never inlined by run reads.
   `run.details` reports collection and Spec counts; the catalog locates complete
   reports and diagnostics. If storage failed, `export` on the same run retries
   saving retained evidence without executing the simulation again.

`sync.transfer` counts this request's selected, downloaded, reused and remaining
files; `workspaceFileCount` counts files registered across local history.
Argument validation failures return `INVALID_TOOL_INPUT` with field paths and
`recovery:"fix-input"`; correct the arguments rather than reconnecting.

For a single native ngspice Noise analysis in a fresh process, save both plots
(the current plot after `noise` is the integral, not the spectrum):

```spice
set filetype=ascii
set appendwrite
noise v(out) Vinput dec 20 10 10Meg
setplot noise1
write out.raw all
setplot noise2
write out.raw all
```

Use your actual output node and input source. Multiple Noise analyses create
additional plot pairs; select their actual names, not always `noise1/noise2`.

Read [detailed contracts](simulation-reference.md) only when needed for device
mapping, file editing, Batch, or recovery. Basic native OP/DC/AC/TRAN
needs no helper-reading gate. One hosted simulation slot means sequential starts
or Batch. Check execution, collection, per-analysis diagnostics and requested
measurements independently; completion is not proof of every requested result.

For plots, `simulation_files` supports `prepare-plot`: supply `runId`, a new
`name`, and `panels:[{analysisIndex:0,signals:[{signal:"v(out)"}]}]`.
Alternatively supply `preset:{kind:"ac",analysisIndex:0,signals:[{signal:"v(out)"}]}`
instead of `panels`. DC/TRAN default to linear axes, AC to log frequency and
separate magnitude/phase panels, Noise to log frequency/density. Compatible
display units group together; unknown units stay separate. All four presets use
the same template, not four independent scripts.
It downloads only the selected tables and copies an editable Python template
plus `plot.json` into the local base's `plots/<name>/`. Execute the returned
argument vector with an available Python >=3.10 / matplotlib environment, then
inspect the image. MCP prepares files; it does not run Python or install packages.
Existing plot directories are never overwritten: edit the local config/script
or use a new name. This also preserves customizations across MCP upgrades.

Each panel can set `x`, axis labels/ranges/scales, title and legend; each signal
can set `unit`, `label`, and explicit complex `component` (real, imag, magnitude,
phase). PNG is default; `formats` also accepts SVG/PDF. Display conversion changes
both values and units; incompatible units and invalid log points fail clearly.
Use separate panels for different units/axes. Optional signal
`decibels:{factor:20,reference:1,referenceUnit:"V"}` explicitly projects amplitude
relative to 1 V; factor 10 is for positive power. This is not automatically gain.
For gain ratios, normalization or other calculations edit the copied script,
not the installed MCP package.

Set `cursors:{A:1000,B:10000,unit:"Hz"}` on a panel or preset for shared A/B
markers. Values use the displayed x unit when `unit` is omitted. Cursors snap to
actual nearest samples (log-distance on a log x axis); they do not interpolate
crossings or clamp outside the domain. The graph marks sampled points and local
`cursors.json` records requested/actual positions, sample indices, units and
B−A deltas. Empty cursor reports overwrite stale reports on rerender. All
readouts use the displayed projection, including dB/phase when selected.
The copied template also works standalone with CSV paths in its JSON config;
no live connector is needed after preparation. Run samples never enter MCP output.
