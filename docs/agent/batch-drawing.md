# Batch drawing (repository only)

`pnpm draw:batch` draws many circuits without a browser (#1498): one
workspace per task, an Agent command per workspace, then the drawing's
netlist and figure and a name-insensitive grade against the task's reference
netlist (#1524). It is an internal tool for reference-dataset redraws and
batch checks, not a published interface.

The workspace is the editor's own Agent host over a Project file
(`apps/editor/src/headless`), bundled into `output/headless/` by
`node scripts/package-headless.mjs`; the runner builds that bundle when it is
missing. Agents reach the workspace through the analog-canvas MCP server in
local mode, which the runner configures per task.

## Run a batch

```sh
pnpm draw:batch tasks.jsonl --out runs/pilot --jobs 4 --timeout 15m \
  --agent 'claude -p --output-format json --mcp-config {mcpConfig} --strict-mcp-config --allowedTools "mcp__analog-canvas,Read"' \
  --second-agent 'claude -p --output-format json --mcp-config {mcpConfig} --strict-mcp-config --allowedTools "mcp__analog-canvas,Read"' \
  --instructions STYLE-INSTRUCTIONS.md
```

| Option                | Meaning                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--out DIR`           | Where every task's workspace and the batch results go. A directory that already holds the batch is refused unless `--resume` is given. |
| `--agent "COMMAND"`   | The drawing Agent, run by a POSIX shell in the task's workspace with the prompt on stdin.                                              |
| `--second-agent`      | Optional. Redraws a drawing that does not match or exports no netlist, independently, in `DIR/<id>/second/`.                           |
| `--jobs N`            | Tasks drawn at a time (default 1).                                                                                                     |
| `--timeout`           | Per Agent run: seconds, or `15m`, `1h` (default 900 s). The Agent's whole process group is stopped; what it drew is still graded.      |
| `--resume`            | Skip tasks that have a `verdict.json`. A task stopped mid-way is moved to `DIR/.interrupted/` and drawn again.                         |
| `--mcp-command`       | The MCP server `mcp.json` starts. Default: the packaged MCP (`pnpm mcp:package`) as `node …/analog-canvas-mcp.mjs --local {dir}`.      |
| `--instructions FILE` | Text added to every prompt; `--second-instructions` replaces it for the second Agent.                                                  |
| `--body`              | Body rule of the grade: `auto` (default), `compare` or `ignore`.                                                                       |
| `--source-polarity`   | Grade independent-source polarity (for figures that mark it).                                                                          |
| `--bundle FILE`       | Another headless bundle.                                                                                                               |

Command templates take these placeholders, replaced shell-quoted: `{dir}`
(the task's workspace), `{id}`, `{image}`, `{reference}`, `{mcpConfig}`,
`{prompt}`, `{role}` (`first` or `second`), `{bundle}` (the headless bundle)
and `{cwd}` (the directory the batch was started from). The same values are
in the Agent's environment as `ANALOG_CANVAS_BATCH_*` and
`ANALOG_CANVAS_HEADLESS`.

The prompt names the figure, the workspace and the reference netlist, then
adds `--instructions` and the task's own instructions. The workspace holds
`reference.sp`, so instructions decide whether the Agent may check its
drawing against it.

## Manifest

One JSON object per line:

| Field          | Meaning                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| `id`           | Required. Letters, digits, `.`, `_`, `-`; names the task's directory.                        |
| `image`        | The figure to draw. `figure` is read the same way, so the redraw task lists run as they are. |
| `reference`    | The reference netlist: a path, or the netlist itself when the text holds a line break.       |
| `name`         | The Project's name (default: the id).                                                        |
| `instructions` | Added to this task's prompt.                                                                 |

Paths resolve against the manifest's directory. Other fields are ignored.
References are SPICE, or structural Spectre as AnalogGenie writes it
(`M0 (D G S B) nmos4`, passives without values), which is read as SPICE and
kept beside it as `reference.scs`. Other formats (a CircuitThink answer) must
be turned into SPICE first.

## What a task leaves

```
DIR/<id>/
  project.icproj.json   the drawing, openable in the editor
  netlist.sp            its SPICE netlist, when it exports one
  figure.svg            its formal SVG
  reference.sp          the reference (reference.scs: its Spectre original)
  input.<ext>           a copy of the figure
  mcp.json, prompt.md   what the Agent was given
  agent.log             the Agent's stdout and stderr, exit and time
  verdict.json          the grade and the pipeline's decision
  second/               the second drawing, when there is one
DIR/summary.json
DIR/review-queue.jsonl
```

## Verdict

`verdict.json` records:

- `path`: which branch the task took (below), `accepted` (`first`, `second`
  or null), `datasetSuspect`, and a `reason` when a person must look.
- `reference`: `spice`, `spectre` or null; `referenceProblems` when the
  reference cannot be graded against itself.
- `first` and `second`, one per drawing: `outcome`, `messages`, `grade`,
  `byName` (the by-name comparison MCP verify makes, topology only) and
  `agent` (`exitCode`, `signal`, `timedOut`, `wallSeconds`, `usage`).
- `firstVsSecond`: how the two drawings compare with each other.

An outcome is `match`, `mismatch`, `blocked` (nothing drawn, or the netlist
export is blocked; `messages` says why), `ungradable` (the reference cannot
be graded), `no-reference`, or `error`.

`usage` is read from the Agent's output: Claude Code's result object
(`--output-format json` or `stream-json`: cost, turns, tokens) or the
`turn.completed` events of `codex exec --json`. Otherwise it is null and only
wall time is known.

## Grade

`gradeNetlists(actual, reference)` decides `exact` by device–net bipartite
graph isomorphism:

- Device, net, Cell and port names are ignored; hierarchy is flattened.
- Ground (`0`, `GND…`, `VSS…`, `AGND`, `DGND`) is one fixed net. Supplies
  (`VDD…`, `VCC…`, `VEE…`, `AVDD`, `DVDD`, `VPWR`) are fixed: a supply maps
  only to a supply.
- A device's type is its kind (resistor, nmos, pnp, …), read from the element
  letter, `.model` types, or model and master names.
- The ends of R, C and L are interchangeable, as are those of independent
  sources unless `--source-polarity` is set. MOS drain and source are
  interchangeable.
- Bodies (MOS bulk, BJT substrate, a PDK device's substrate terminal) are
  ignored when one side omits them: every body on that side is unwritten or
  on its conventional rail (n-channel on ground, p-channel on a supply), which
  is what an undrawn body exports to. Otherwise they count. `--body` forces
  either way.

`mode` is `strict` when the match holds even with drain and source and every
body held apart, `lenient` otherwise. A netlist line the reader cannot take
keeps `exact` false. Partial scores use the same rules: `deviceTypeF1` over
device-type counts, and `connectionF1` over connections, each a pair of
device terminals on one ordinary net (`nmos.g~resistor.t`), a terminal on a
rail (`nmos.ds@ground`), or a net's only terminal (`…@open`). `details` gives
the device and net counts, the types whose counts differ, and `bodiesOnly`
when bodies alone decided a mismatch.

## Checking pipeline

| First drawing              | Second drawing                    | Path        | Accepted |
| -------------------------- | --------------------------------- | ----------- | -------- |
| match                      | —                                 | `first`     | first    |
| no reference               | —                                 | `unchecked` | none     |
| reference cannot be graded | —                                 | `review`    | none     |
| mismatch, blocked or error | none (`--second-agent` not given) | `review`    | none     |
| mismatch, blocked or error | match                             | `second`    | second   |
| mismatch                   | mismatch, isomorphic to the first | `agreed`    | first    |
| mismatch, blocked or error | anything else                     | `review`    | none     |

`agreed` sets `datasetSuspect`: two independent drawings agree with each
other and not with the reference, so the reference may be wrong.
`review-queue.jsonl` lists every `review` task with its reason, in manifest
order; it is appended as tasks finish and rewritten at the end.

`summary.json` gives task counts by first outcome and by path; the exact rate
of first drawings with a Wilson 95 % interval and the accepted rate, both over
tasks drawn against a gradable reference; the dataset-suspect and review
counts; mean F1 scores; and cost, tokens and Agent time in total and per
task.

## Try it without a model

`scripts/lib/draw-batch-script-agent.mjs` is a scripted Agent that draws a
known circuit through the same headless editor. A task's instructions choose
the circuit per role, for example `script-agent first=divider-short
second=divider`:

```sh
pnpm draw:batch tasks.jsonl --out /tmp/batch --jobs 4 \
  --agent "node {cwd}/scripts/lib/draw-batch-script-agent.mjs {bundle} {dir} {role}" \
  --second-agent "node {cwd}/scripts/lib/draw-batch-script-agent.mjs {bundle} {dir} {role}"
```

## Import into the Gallery

Accepted drawings go into the dataset's own reference store (#1510), never
the community wall. `pnpm gallery:import-batches RUN_DIR --source KEY`
(`KEY` from `config/gallery-sources.json`, e.g. `analogretriever`) writes
`RUN_DIR/gallery-import/KEY-0001.json`, …: ten entries a file, each with the
id `<prefix>-<task id>`, the manifest's `name` (`--manifest TASKS.jsonl`),
and the accepted drawing. Drawings accepted only because two redraws agreed
against the dataset's netlist need `--include-suspect`; what is left out,
and why, is in `left-out.json`. The Owner posts each file from a signed-in
Gallery page to `POST /api/gallery/sources/KEY/entries`; importing the same
id again replaces it.
