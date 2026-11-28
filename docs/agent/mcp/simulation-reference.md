# MCP simulation detailed contracts

MCP specifics of the [shared simulation workflow](../shared/simulation.md). A
saved setup v4 owns authored files, entry/config paths, generated Circuit
bindings and declared dependencies, not a structured analyses list; Project
edits own DUTs, ports, sources and wiring. `simulation` / `authoring-help`
gives the engine's syntax and reporting helpers; the config version decides
whether native source or legacy JSON helpers own outputs. Simulation tools
accept `request.action` or `request.operation`.

## Prepare and start

`prepare` with `source:{kind:"project-folder",folderId,expectedStructureRevision}`
freezes input and returns `prepared.id`, `digest`, vectors and artifacts; read
artifacts and source maps only to investigate a discrepancy, and use returned
references, never invented names. `start` with `preparedId`/`digest` returns
`run.id`; a transport retry reuses the request ID and payload (also during
preparation; a retry never rereads a changed circuit). `read`/`cancel` take
`runId`, each poll a new request ID. `inputStatus` reports later edits without
rewriting that run's evidence. Read `error.code`, `stage`, `recovery` and
located diagnostics; an uncertain accepted execution is never resubmitted
automatically ([response semantics](../response-semantics.md)).

`prepared.deviceOperatingPoints` matches `documentId`, `instanceId` and
`occurrence`; join each `values[].acquisitionId` to `prepared.vectors[].probeId`
for the exact vector (the value record gives parameter and unit). Several
primitive records are candidates, not addends. The mapping is not a complete
parameter inventory: inspect model/engine facts before authoring a missing
one; never guess an internal path. Use raw/result JSON or analysis CSV for
arrays, keeping vector names, axes, complex values and unknown units intact.

## Source files

Saved experiments use `owner:{kind:"project-folder",folderId}`; updates use the
Project structure revision and undoable transactions. `read` returns exact
text, a SHA-256 `textDigest` and generated instance/parameter spans. `update`
takes writes/removes, UTF-16 range patches, or (preferred for small edits)
`replacements:[{path,textDigest,oldText,newText}]`: each nonempty `oldText`
must match exactly once in the original file (whitespace and line endings
included), all against the original text; zero or multiple matches, stale
digests and overlaps reject the batch. `circuitEdits:[{path,textDigest,text}]`
maps reported editable numeric fields to parameter transactions; topology goes
through Canvas. File writes need `project.import`; mapped edits also need
connectivity authority.

The returned project-folder `source.revision` is the Project
`structureRevision`: pass it as the next `expectedRevision` or prepare's
`source.expectedStructureRevision` (not the folder `version` or a Cell
revision). A stale prepare returns `currentRevision`; review the intervening
changes before retrying. For `session-workspace`, pass `source.revision` as
`expectedRevision`. `update` reports `changed`, created/updated/removed files
with new digests and byte lengths, and `mappedCircuitPaths`; entry/config/draft
changes may be `changed:true` with no files; no-op saves keep the revision. Do
not reread after success. Listings advertise `editing`: `text`,
`mapped-parameters` or `read-only`. Failures give `fileEdit.applied:false`,
the path, and for replacements the index and match count; conflicts give
expected/current revisions. Invalid native code still saves; prepare validates.

`update` returns invalid Spec lines of each saved file as `specWarnings`
([Spec rules](../simulation-specs.md)); a file that changed again before the
read-back is not checked.

Graphless session workspace: File `create`, then `update` with
`owner:{kind:"session-workspace",workspaceId}`, `expectedRevision`, `entry` and
files including a valid config; prepare with
`source:{kind:"workspace",workspaceId,expectedRevision}` (environment lives in
the config). Use `simulation_folder` when work must survive Project save.
Paths and dependencies are virtual-root-relative; host paths and startup
configuration are not writable.

## Local evidence

`sync` picks its base from `basePath`, a remembered Project path, an absolute
`ANALOG_CANVAS_TASK_DIR` (scoped `.analog-canvas/` child), then user
application data, never the working directory. Bases are isolated per server
and Project copy (Cloud ID, or browser workspace ID for a draft; saving a draft
starts a new base and old files stay). Choices persist across processes, apart
from credentials; an unusable path fails rather than moving. The reply gives
absolute base/index/work paths on filesystem `mcp-host`, which must be shared
with your analysis tools. Run directories are flat; `work/` holds scripts and
plots. `fileIds`, `analysisIndex` and `roles` intersect; a shared raw file
downloads whole; verified files are reused. `action:"workspace"` inspects a
base offline too, so a new conversation can continue from its path. Nothing is
moved or deleted automatically.

`action:"download",artifactId` saves one verified file resumably
(`outputPath` overrides); `action:"artifact"` without `outputPath` is a
preview. `catalog` gives axes, signals, scalar descriptors, units, selectors
and roles without samples. `read` is for status, not waveform transfer.

Discovery is reused for 30 s by folder creation, finished directories by
sync/plot; explicit calls and `refresh:true` bypass it and pairing/Project
changes invalidate it. Downloads prepare up to 32 missing files per batch and
run up to eight in parallel within ~32 MiB in flight; on failure no new file
starts and completed files and the index stay. `sync.transfer` counts
selected, downloaded, reused and remaining files; per-file `timing.elapsedMs`
and `timing.remoteWaitMs` (preparation and GET headers, not body).

## Batch and history

`prepare-batch` freezes 1–16 saved-setup items at one structure revision.
`prepare-sweep` takes a legacy Run Plan or explicit corner, temperature,
variable or exact-parameter axes for ngspice folders; `variableId`
names one unconditional top-level `.param` declaration. Corners target the Profile's model library; ambiguous
declarations are rejected first; points never mutate the Project. Both run
through `start-batch`, `read-batch`, `cancel-batch` and per-run `read`/`export`.
`read-batch` gives each item's outcome, dataset and diagnostic counts and
`point` axis values (use `point`, not labels); `signals:["v(vref)"]` adds the OP
value or final/min/max per item. Native repeated plots are separate records,
never an implicit Batch.

`simulation_results` `history` returns 10 entries per page (`nextCursor`) with
ownership, logical bytes and saved/cache/catalog-only/session-only status;
`unverified` means protection is unknown, so deletion may not be safe.
`history-usage` reports Project file counts/bytes, unreferenced bodies and
limits. `history-delete` with `runId,dryRun:true` previews; omit `dryRun` to
delete; saved or unclassified archives need `includeSaved:true`. Local
downloads stay; physical reclamation may wait for an Editor lease.

## Noise and plots

A single ngspice Noise analysis must save both plots (after `noise` the current
plot is the integral); further analyses add pairs with their own names:

```spice
set filetype=ascii
set appendwrite
noise v(out) Vinput dec 20 10 10Meg
setplot noise1
write out.raw all
setplot noise2
write out.raw all
```

`prepare-plot` presets (`preset:{kind:"ac",analysisIndex:0,signals:[…]}`):
DC/TRAN linear, AC log frequency with magnitude and phase, Noise log
frequency/density. It copies an editable template and `plot.json` into
`plots/<name>/`, never overwriting (edit it or choose a new name), and runs
nothing; `execution.check` is the one-time dependency check. Panels set `x`,
labels, ranges, scales, title, legend; signals set `unit`, `label` and complex
`component` (real, imag, magnitude, phase). PNG default; `formats` adds
SVG/PDF. Incompatible units and invalid log points fail: use separate panels.
`decibels:{factor:20,reference:1,referenceUnit:"V"}` projects amplitude
(factor 10 for power); it is not gain; edit the script for ratios.
`cursors:{A:1000,B:10000,unit:"Hz"}` snaps to nearest samples without
interpolating; `cursors.json` records positions, indices, units and B−A.
Relative paths let the base move; the template runs without a connector.
Samples never enter MCP output.
