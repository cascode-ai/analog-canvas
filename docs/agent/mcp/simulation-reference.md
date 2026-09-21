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
4. `prepare` with
   `source:{kind:"project-folder",folderId,expectedStructureRevision}` freezes the
   input and returns `prepared.id`, `digest`, vectors and artifacts.
   On a successful preparation, proceed to start. Read input artifacts and source
   maps when investigating a discrepancy, not as a mandatory second check.
   Use returned references rather than inventing artifact names or extensions.
5. `start` uses `preparedId` and `digest`, returning `run.id` immediately.
   Reuse the same outer request ID and payload for a transport retry.
   `read` / `cancel` use `runId`; each new poll has a new request ID.
   `inputStatus` reports later edits without rewriting that run's evidence.
6. Use `simulation_files` with `request:{action:"sync",runId}` to obtain the
   catalog and download complete files into a local base. No path question is
   required: the default lives under the MCP process working directory's
   `.analog-canvas/` and is isolated by server and Project within the MCP host's
   working directory. Reconnection or MCP restart reuses that default Project
   base; a changed authorization session does not move downloaded evidence.
   Explicit `basePath` choices are remembered per Project while the MCP process
   lives. Existing older session-named bases remain readable by supplying their
   path; nothing is moved or deleted automatically. The reply gives the
   absolute base/index/work paths and identifies the filesystem as `mcp-host`.
   That host must share a filesystem with the Agent's local analysis tools;
   a remote MCP path is not automatically accessible from the Agent runtime.
   Optionally set `basePath` once; this MCP session remembers it.
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
The returned `source.revision` is ready for the next update or prepare; `update`
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
