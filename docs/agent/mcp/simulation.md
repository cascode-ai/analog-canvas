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

Read [detailed contracts](simulation-reference.md) only when needed for device
mapping, file editing, Batch, or recovery. Basic native OP/DC/AC/TRAN
needs no helper-reading gate. One hosted simulation slot means sequential starts
or Batch. Check execution, collection, per-analysis diagnostics and requested
measurements independently; completion is not proof of every requested result.
