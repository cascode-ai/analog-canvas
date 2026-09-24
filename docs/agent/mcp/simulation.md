# MCP simulation tools

## Normal task

Use the focused tool's displayed arguments directly. Query `describe_tool` for
an unfamiliar field only; no full-contract or authoring-help prerequisite.

1. Discover `simulation_run` capabilities once; choose an advertised Profile
   and its engine. Read `netlist_code`/the relevant Cell interface for a drawn DUT,
   not the entire drawing. Profile-managed model loads need no duplicate `.lib`.
   Full capabilities (optionally `profileId`) are for detailed model facts.
2. Create a saved `simulation_folder`, or reuse the current folder.
   Creation returns its source owner, revision and paths. Use `simulation_edit`
   for native code; `simulation_source` reads only text you need to preserve.
   Reuse successful update revisions/digests without a confirmation reread.
3. Normally call `simulation_run` with `request:{operation:"run",source:...}`
   and optional outer `waitMs:20000`. Use a project-folder source with `folderId`
   and `expectedStructureRevision` from the latest source update (or a workspace
   source with `workspaceId` and `expectedRevision`). This captures input before
   network waits, prepares and submits once. Keep the same request ID and payload
   on uncertain retries. Explicit `prepare` → `start` remains optional when you
   want to inspect or reuse a frozen input; it is not a normal prerequisite.
   The normal path holds the run submission within one bounded Agent relay
   request; a still-running receipt can be continued with a bounded read.
   This wait never starts another run.
   Continue a running result with `read` and the same run ID, never another start.
   Preserve an uncertain start's request ID. One hosted slot means sequential
   starts or `simulation_batch`.
4. For a graph, call `simulation_plot` `prepare-plot` directly with `runId`,
   a new `name`, and `panels:[{analysisIndex:0,signals:[{signal:"v(out)"}]}]`
   or a DC/AC/TRAN/Noise preset. It fetches the selected tables itself:
   **no preceding sync is needed**. Check Python >=3.10 and matplotlib once per
   local environment, execute the returned argument vector, and inspect the image.
   `dataStatus`, `scriptStatus`, `imageStatus` distinguish downloaded data,
   prepared code and actual rendering. Nothing installs or executes automatically.
5. For custom analysis use `simulation_data` `sync`, selecting `analysisIndex`
   and `roles:["table"]` if appropriate. Omit selectors for complete final
   handoff; `fileIds:[]` updates only the directory. Local files are reused.
   The default receipt keeps current-task counts and up to 16 file paths/timings;
   larger selections use `filesOmitted` and the local index. Outer `detail:"full"`
   retains every file and history. Explicit `workspace` lists local runs.
   Full identities, units and dataset mapping remain in the returned local index.
   `simulation_results` `catalog` is the explicit full remote directory, not
   a mandatory extra step. Read data locally rather than paging waveform previews.

Iteration: edit → run/wait → plot or selected sync. Do not repeat
connection, discovery, folder creation, environment checks or full archive
downloads when their inputs have not changed. Final sync archives all files.
For styling-only iterations, edit and execute the existing local plot script;
no connection, sync or new plot preparation is needed.

## Results and freshness

Check execution, collection, per-analysis diagnostics and requested measurements
independently; completion does not prove every analysis produced data.
`run.details` summarizes collection/Specs and separates executor wait, result
materialization and catalog-save time. Managed runs additionally report server
queue/execution, result fetch and client polling. Simulator-only time remains
`result.durationMs`; do not treat it as end-to-end latency. Registered files hold
complete evidence.
Run summaries reference the catalog instead of repeating its file list; outer
`detail:"full"` retains the complete run metadata response.
`export` retries failed evidence saving on the same run without executing again.

For history management, `simulation_results` `history` lists Run IDs, source
ownership (when recorded), logical evidence bytes, and whether each run is
saved, generated cache, catalog-only, or session-only. An unavailable archive
index is reported as `unverified`: history stays readable, but deletion cannot
assume the Run is unprotected. History defaults to 10 entries; continue with
`nextCursor` or choose a larger `limit` when needed. `history-usage` reports
actual Project evidence file count/bytes, unreferenced bodies and limits;
unreferenced does not imply
immediate reclaim while an Editor holds a lease. `history-delete` with
`runId` and `dryRun:true` previews an exact deletion; omit `dryRun` to remove
it. Saved or unclassified legacy archives require explicit
`includeSaved:true`. Deletion does not remove Agent-local downloads and may
report deferred physical reclamation while an Editor tab holds evidence.
New automatically captured Project-run archives and new unarchived Run catalogs
each retain the latest 30 per Project when cleanup can run; manually saved
results and older unclassified archives are not automatically pruned.

Internal folder creation reuses matching capability discovery for at most
30 seconds. Sync/plot reuse only complete, finished directories for that window;
pending/partial directories are fetched again. Explicit capabilities/catalog calls
always refresh; outer `refresh:true` on sync/plot bypasses directory reuse, and
folder `refresh:true` refreshes discovery too. Pairing/Project-context changes
invalidate reuse. A cached directory does not assert remote file availability:
actual downloads retain authorization, publication and integrity checks.

Download preparation batches up to 32 missing-file descriptors, independently
reporting ready/pending/failed files. Pending publication releases its slot so
ready files proceed; bytes use up to eight rolling slots with a 32 MiB aggregate
in-flight target. Large files automatically reduce concurrency and one oversized
file can still progress. Existing files are verified
locally once per sync, without descriptors; unchanged index records are not rewritten.
Partial failures preserve completed files and the
local index. `transfer` counts selected/downloaded/reused/remaining files in
this sync; `workspaceFileCount` covers local history. Detailed timing definitions
and advanced features are in [detailed contracts](simulation-reference.md).

Prepare's default summary points to complete `preparation.json`; outer
`detail:"full"` exposes it inline. OP mappings describe available vectors, not
captured values; explicitly save needed device parameters (`save all` is not
every parameter). Native source remains authoritative.

Read [detailed contracts](simulation-reference.md) only for native Noise capture,
OP mappings, patch semantics, Batch, plot units/cursors or recovery.
`simulation` and `simulation_files` remain compatible broad entries sharing
the same implementation. There is no new protocol or permission gate.
