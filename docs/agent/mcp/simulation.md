# MCP simulation tools

Use the focused tools' displayed arguments; query `describe_tool` only for an
unfamiliar field. Engine and capture rules: [shared workflow](../shared/simulation.md).

## Normal task

1. Discover `simulation_run` capabilities once when you need a non-default
   Profile (VACASK, say) or engine facts; `profileId` gives detailed model
   facts. For a drawn DUT read `netlist_code` or the Cell interface, not the
   whole drawing. Switch clock phases the DUT does not drive are its last pins
   (`EN EN_bar`, `PHI1 PHI2`): give each a clock source, a complementary pair
   opposite pulses with dead time when they must not overlap. Profile-managed
   models need no duplicate `.lib`.
2. Create a `simulation_folder` or reuse the current one. With
   `rootDocumentId`, a Cell with pins becomes the DUT of a `testbench.spice`
   shell (`XDUT`, ports in order) where you write the sources; a Cell without
   pins is a drawn testbench and runs as the deck's top; `dut` wraps either; no
   root Cell gives a graphless experiment. Without `profileId`, create takes the
   one Profile whose listed qualified devices include every reviewed PDK device
   the root Cell and its sub-Cells use (SKY130 16 V/20 V DMOS count for SKY130
   ngspice; a Profile listing none, as VACASK, is never the default). The
   receipt's `folder` names the Profile and engine; with several or none, the
   folder is the author's Testbench with no Profile, and
   `folder.profileCandidates` names them. `template:"testbench"` asks for that
   Testbench directly: one `testbench.spice` entry with the DUT call, for the
   user's own simulator.
   Edit native code with `simulation_edit`; `simulation_source` read
   `detail:"text"` reads it, `detail:"mapped"` adds parameter mappings. Reuse
   update revisions/digests without rereading.
3. `simulation_run` `request:{operation:"run",source}` with optional outer
   `waitMs` (0–20000): `source:{kind:"project-folder",folderId,expectedStructureRevision}`
   from the latest source update, or `{kind:"workspace",workspaceId,expectedRevision}`.
   It captures input before waiting, prepares and submits once; the wait never
   starts another run. Continue a running result with `read` and the same run
   ID. Retry an uncertain submission with the same request ID and payload.
   One hosted slot: start sequentially or use `simulation_batch`.
4. Graph: `simulation_plot` `prepare-plot` with `runId`, a new `name` and
   `panels:[{analysisIndex:0,signals:[{signal:"v(out)"}]}]` or a preset; pick
   indices from `run.details.analyses`. Axis labels omit units. It fetches its
   tables itself (**no sync needed**). Check Python ≥3.10 and matplotlib once
   per environment, run the returned argument vector, inspect the image.
   `dataStatus`, `scriptStatus`, `imageStatus` separate data, code and
   rendering; nothing installs or executes automatically.
5. Custom analysis: `simulation_data` `sync`, e.g. `analysisIndex` and
   `roles:["table"]`; omit selectors for a complete archive; `fileIds:[]`
   updates only the directory. Local files are reused; the receipt keeps
   counts and up to 16 paths (`filesOmitted`; outer `detail:"full"` lists all).
   `simulation_results` `catalog` is the explicit full directory, not a
   required step. Read data locally rather than paging previews. Evidence
   retries never rerun a solver; on storage or download failure see
   [evidence recovery](../simulation-evidence-storage.md).

Iterate edit → run → plot or selected sync, without repeating connection,
discovery, folder creation, environment checks or full downloads whose inputs
did not change. For styling, edit and rerun the local plot script.

## Results

Check execution, collection, per-analysis diagnostics and measurements
separately ([shared workflow](../shared/simulation.md)). `run.details` times
executor wait, materialization and catalog save (managed runs add server queue,
execution, fetch, polling); `result.durationMs` is simulator time only. Outer
`detail:"full"` returns complete metadata and inline `preparation.json`.
[Detailed contracts](simulation-reference.md) cover file editing, OP mapping,
Batch, history, caches, Noise and plot options; `simulation` and
`simulation_files` are compatible broad entries.
