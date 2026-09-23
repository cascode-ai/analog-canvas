# MCP simulation detailed contracts

This resource maps the [shared simulation workflow](../shared/simulation.md) to
MCP calls. The shared guide owns engine selection, native capture and result
interpretation; the sections below contain only MCP-specific file, run and
evidence details.

## Simulation calls

1. `simulation` / `capabilities` discovers Profiles, qualified analyses,
   collection support and resource limits without starting an execution.
2. `simulation_folder` lists, gets, creates, clones, renames and removes saved
   source experiments. Omit the root Cell to create a graphless experiment.
   A saved setup v4 owns authored files, its entry/config paths, generated
   Circuit bindings and declared dependencies. It does not contain another
   structured analyses list. Ordinary Project edits own DUTs, formal ports,
   independent sources and wiring.
3. Use `simulation_files` to read and edit source/config. `simulation` /
   `authoring-help` exposes the selected engine's current syntax and reporting
   helpers. The returned config version determines whether native source or the
   legacy JSON helpers own outputs and measurements.
4. Normally submit `run` with
   `source:{kind:"project-folder",folderId,expectedStructureRevision}` (or the
   revisioned workspace source). It freezes, compiles and submits once, returning
   `run.id`. An uncertain retry uses the same request ID and payload, including
   while preparation is in flight. It never rereads a changed circuit on retry.
   Optional `prepare` with
   `source:{kind:"project-folder",folderId,expectedStructureRevision}` freezes the
   input and returns `prepared.id`, `digest`, vectors and artifacts.
   When choosing explicit preparation, proceed to start. Read input artifacts and source
   maps when investigating a discrepancy, not as a mandatory second check.
   Use returned references rather than inventing artifact names or extensions.
5. `start` uses `preparedId` and `digest`, returning `run.id` immediately.
   Reuse the same outer request ID and payload for a transport retry.
   `read` / `cancel` use `runId`; each new poll has a new request ID.
   `inputStatus` reports later edits without rewriting that run's evidence.
6. Use `simulation_files` with `request:{action:"sync",runId}` to obtain the
   catalog and download complete files into a local base. No path question is
   required: choose explicit `basePath`, then a remembered Project path, then
   the host's explicitly configured absolute `ANALOG_CANVAS_TASK_DIR`, otherwise
   the user's application-data directory. A task directory receives a scoped
   `.analog-canvas/` child. The default never assumes the process working directory
   is writable or appropriate. Bases are isolated by server and active Project
   copy: a saved Project uses its Cloud ID; an unsaved draft uses its browser
   workspace ID. The display/structural `Project.id` alone is not unique.
   Successful choices are persisted across MCP/CLI processes, separately from
   credentials; a changed authorization session does not move downloaded evidence.
   An unusable selected path reports failure rather than silently changing location.
   Older local indexes remain inspectable by supplying their path; they are not
   silently merged into a newly scoped Project base. Saving a draft gives it a
   new Cloud identity and hence a new default base; its draft files remain at
   their previous absolute path. Nothing is moved or deleted automatically.
   The reply gives the
   absolute base/index/work paths and identifies the filesystem as `mcp-host`.
   That host must share a filesystem with the Agent's local analysis tools;
   a remote MCP path is not automatically accessible from the Agent runtime.
   Optionally set `basePath` once to select or reuse an existing base.
   Files are flat within each run directory, and `work/`
   is for scripts and plots. Use ordinary local tools for analysis afterwards.
   Set `fileIds` to select stable file IDs or current artifact IDs; `[]` updates
   only the directory. Verified existing files are reused without re-downloading.
   `analysisIndex` selects one dataset and `roles` selects producer file roles;
   these intersect with `fileIds` when combined. `roles:["table"]` downloads CSV.
   Raw/result files can represent multiple analyses; selecting one analysis still
   downloads the complete shared file, never silently slices it.
   `request:{action:"workspace"}` inspects the base, even offline when its path
   is known. A new MCP conversation can provide that path to continue. Local
   files survive disconnect; the host, not the browser, controls their retention.
   This is not an automatic source upload or a second circuit authority.
7. For an individual file, `request:{action:"download",artifactId}` saves it
   into the base; `outputPath` overrides its destination. Downloads stream to a
   resumable partial file and only publish complete verified bytes, without
   replacing unrelated files. `request:{action:"artifact",artifactId}` without
   `outputPath` remains an optional text preview. `simulation` / `catalog` gives
   dataset axes, signals, scalar result descriptors, units, exact representation
   selectors and file roles without copying samples. For example, a Noise dataset
   registers available integrated input/output noise and points each scalar at its
   canonical `result.json` field.
   `read` is for status and diagnostics, not the primary waveform transfer.
   For result fields, measurement verdicts and canonical output files, read
   [Spec rules](../simulation-specs.md). Browser visibility, archival limits
   and durable delivery follow [result handoff](../simulation-result-handoff.md).
   Read a complete artifact when needed; do not download a second copy of data
   already returned in full. After interruption, resume reading the same run.

### Device facts and numerical results

Use `prepared.deviceOperatingPoints` to match `documentId`, `instanceId` and
`occurrence`. For each acquisition expression in `values`, join its
`acquisitionId` to `prepared.vectors[].probeId` to obtain the exact vector.
The value record supplies the parameter and unit. Multiple primitive records
are separate candidates, not quantities to sum. This is the known mapping,
not a complete inventory of every model parameter. Missing entries do not prove
a parameter is unsupported: inspect model/engine facts before authoring it.
Do not guess an internal path from a display reference.

Use raw/result JSON/analysis CSV for arrays rather than printed log tables. Keep
full vector names, original axes, complex values and unknown units intact.

### File ownership and editing

For saved experiments use `owner:{kind:"project-folder",folderId}`. Updates use
the Project structure revision and ordinary undoable transactions. `read`
returns exact text, a SHA-256 `textDigest`, and generated instance/parameter
spans when applicable. `update` accepts writes/removes or UTF-16 range patches
with that digest. `circuitEdits:[{path,textDigest,text}]` maps only reported
editable numeric fields to normal parameter transactions; topology edits go
through Canvas APIs. Project file writes require `project.import`; mapped
circuit changes additionally require connectivity editing authority.

For small edits prefer `update.replacements:[{path,textDigest,oldText,newText}]`.
Each nonempty `oldText` must match exactly once in the original file, including
whitespace and line endings. Multiple replacements use the same original text,
not each other's output. Zero/multiple matches, stale digests and overlapping
edits reject the whole batch. Full writes and UTF-16 patches remain available.
For `project-folder`, the returned `source.revision` is the Project
`structureRevision`: pass it directly as the next update's `expectedRevision`
or prepare's `source.expectedStructureRevision`. It is not the folder's
`version` or a Cell/document revision. A stale prepare returns
`currentRevision`; compare the intervening Project changes before retrying.
For `session-workspace`, pass `source.revision` as `expectedRevision`.
`update`
reports `changed`, actual created/updated/removed files and their new digests and
byte lengths (removed files have no digest). `mappedCircuitPaths` separately
reports generated paths involved in parameter changes. Entry/config/draft-only
changes may have `changed:true` with no file entries. No-op saves do not advance
revision. Do not reread solely to verify a successful commit.
Listings advertise `editing`: `text`, `mapped-parameters`, or `read-only`.
Located edit failures include `fileEdit.applied:false` and the path when known;
replacement failures also identify the replacement array index and match count
when applicable. Revision conflicts return expected/current revisions when
available. Invalid native code can still be saved; prepare performs validation.

For a graphless session workspace, call File `create`, then
`update` with `owner:{kind:"session-workspace",workspaceId}`,
`expectedRevision`, `entry`, and authored files including a valid config.
Prepare using `source:{kind:"workspace",workspaceId,expectedRevision}`.
Environment belongs to the config, not a second prepare argument. Use
`simulation_folder` instead when this work must survive Project save/reload.

Files and dependencies are virtual-root-relative. Environment owners resolve
declared dependency identities/digests; arbitrary host paths and startup
configuration are not writable. Native repeated plots stay separate records,
never an implicit managed Batch.

### Batch and evidence

`prepare-batch` freezes 1–16 saved-setup items at one structure revision.
`prepare-sweep` uses saved Run Plan axes or explicit corner, temperature,
variable or exact-parameter axes. Nominal values come from source; point
projections do not mutate the Project. Both become an ordinary sequential
batch consumed by `start-batch`, `read-batch`, `cancel-batch` and per-run
`read`/`export`. Reuse start request identity after an uncertain response.

Read `error.code`, `stage`, `recovery` and located diagnostics. Follow
[response semantics](../response-semantics.md) for retries and conflicts; an
uncertain accepted execution is never automatically resubmitted.

## Timing, Noise and plot details

`sync.transfer` counts this request's selected, downloaded, reused and remaining
files; `workspaceFileCount` counts files registered across local history.
Each synced file includes `timing.elapsedMs` (first local check through index save,
including publication rescheduling) and
`timing.remoteWaitMs` (download preparation/publication wait and GET headers).
The latter excludes streamed body transfer; the difference is not pure disk
time. Publication backoff counts as remote wait, but extra local queue time does
not. Reused files have zero remote wait. Up to eight rolling download slots refill
independently while the largest selected file keeps aggregate in-flight bytes near
32 MiB; larger files reduce concurrency and one oversized file may run alone. On
failure, no new files start and already-started downloads settle before return.

Terminal `run.details.timing` separates `executionWaitMs`,
`resultMaterializationMs`, `catalogSaveMs` and `totalMs`. For managed runs,
managed runs additionally report `serverQueueMs`, `serverExecutionMs`,
`serverRunTotalMs`, `resultFetchMs`, `clientWaitMs`, `pollCount` and
`pollSleepMs`. `result.durationMs` covers the spawned
simulator process only; compare it with these stages instead of calling the
difference simulation time.
The managed client polls the existing result endpoint directly. A terminal
response carries both result bytes and server run timestamps, avoiding a final
metadata read followed by a second result request. Missing timing headers from
an older deployment only omit those optional server fields; result decoding and
recovery semantics remain unchanged.
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

For plots, `simulation_plot` supports `prepare-plot`: supply `runId`, a new
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
Check the chosen local Python's version and matplotlib availability once per
working environment before plotting; a prepared script is not a rendered image.
The response separates `dataStatus`, `scriptStatus` and `imageStatus`; use
`execution.check` with your chosen Python for the one-time dependency check.
It neither installs dependencies nor executes the plot automatically.
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
The copied template also works standalone with CSV paths in its JSON config.
Newly prepared configs use paths relative to the plot directory, so moving the
whole local base keeps data links intact; existing absolute-path configs still
work in place.
no live connector is needed after preparation. Run samples never enter MCP output.
