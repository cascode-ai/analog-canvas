# MCP simulation tools

## Simulation

Connecting from the editor includes `simulation.run`; there is no per-run
approval or mandatory helper-reading gate. GUI and MCP use the same source,
File and Run resources.

1. `simulation` / `capabilities` discovers the Profile, qualified analyses,
   parser support, declared rawfile collection and resource limits without
   starting an execution. Read the actual engine and language, not a remembered
   ngspice default. Follow the [shared engine rules](../shared/simulation.md).
2. `simulation_folder` lists, gets, creates, clones, renames and removes saved
   source experiments. Omit the root Cell to create a graphless experiment.
   A saved setup v4 owns authored files, its entry/config paths, generated
   Circuit bindings and declared dependencies. It does not contain another
   structured analyses list. Ordinary Project edits own DUTs, formal ports,
   independent sources and wiring.
3. Use `simulation_files` to read and edit source/config. For code-authoritative
   experiment config version 2, native code owns analyses, saves, parameters,
   options and measurement logic. `simulation` / `authoring-help` exposes the
   current native syntax and Python reporting helpers. Config owns environment
   and collection; an MCP tool name does not select a simulator dialect.
   JSON output/measurement/device-OP helpers are for legacy config version 1
   only. Inspect the actual version before choosing a helper. Warnings and
   invalid drafts remain repairable; they are not session revocations.
4. `prepare` with
   `source:{kind:"project-folder",folderId,expectedStructureRevision}` freezes the
   input and returns `prepared.id`, `digest`, vectors and artifacts.
   Inspect the returned prepared input artifacts, entry and source maps;
   do not invent an artifact name or file extension for another engine.
5. `start` uses `preparedId` and `digest`, returning `run.id` immediately.
   Reuse the same outer request ID and payload for a transport retry.
   `read` / `cancel` use `runId`; each new poll has a new request ID.
   `inputStatus` reports later edits without rewriting that run's evidence.
6. `export` lists artifact references. `simulation_files` with
   `request:{action:"artifact",artifactId}` reads paged content; `outputPath`
   saves complete bytes after length/SHA-256 verification. Deck, rawfile,
   JSON, log and CSV share this File Resource. Large receipts set
   `resultPreview`; full result/output artifacts remain available.
   For result fields, measurement verdicts and canonical output files, read
   [Spec rules](../simulation-specs.md). Browser visibility, archival limits
   and durable delivery follow [result handoff](../simulation-result-handoff.md).
   A preview receipt is not the complete result.

### File ownership and editing

For saved experiments use `owner:{kind:"project-folder",folderId}`. Updates use
the Project structure revision and ordinary undoable transactions. `read`
returns exact text, a SHA-256 `textDigest`, and generated instance/parameter
spans when applicable. `update` accepts writes/removes or UTF-16 range patches
with that digest. `circuitEdits:[{path,textDigest,text}]` maps only reported
editable numeric fields to normal parameter transactions; topology edits go
through Canvas APIs. Project file writes require `project.import`; mapped
circuit changes additionally require connectivity editing authority.

For an expiring graphless session workspace, call File `create`, then
`update` with `owner:{kind:"session-workspace",workspaceId}`,
`expectedRevision`, `entry`, and authored files including a valid config.
Prepare using `source:{kind:"workspace",workspaceId,expectedRevision}`.
Environment belongs to the config, not a second prepare argument. Use
`simulation_folder` instead when this work must survive Project save/reload.

Files and dependencies are virtual-root-relative. Environment owners resolve
declared dependency identities/digests; arbitrary host paths and startup
configuration are not writable. Complete user code owns its analyses and
capture statements. ngspice ASCII/appendwrite snippets are not VACASK syntax.
Use the actual native helper and collection contract. Native repeated plots stay
separate records, never an implicit managed Batch.

### Batch and evidence

`prepare-batch` freezes 1–16 saved-setup items at one structure revision.
`prepare-sweep` uses saved Run Plan axes or explicit corner, temperature,
variable or exact-parameter axes. Nominal values come from source; point
projections do not mutate the Project. Both become an ordinary sequential
batch consumed by `start-batch`, `read-batch`, `cancel-batch` and per-run
`read`/`export`. Reuse start request identity after an uncertain response.

Read `error.code`, `stage`, `recovery` and located diagnostics, repair input,
and continue. Missing models, busy executors, timeouts and failed simulations
do not revoke the session. An uncertain accepted execution is `lost`, never
automatically resubmitted.
