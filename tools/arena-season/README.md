# Season tool (AnalogArena, #1560)

An Owner-run, local-only tool. It turns the Owner's list of chosen Gallery
circuits into a Season's Task pack and the three Project sets every Season
shows, and turns a model's folder of drawings into its Contestant bundle.
Arena (#1559) reads what it writes; the layout is fixed by the
[Season bundle contract](#season-bundle-contract-fixed-by-the-orchestrator-2026-10-09) below.

The tool never chooses circuits. It does not add, drop or replace any id:
every problem is reported against the Owner's line, and a list with a
problem builds nothing.

## Commands

```sh
pnpm arena:season check --list ids.txt --export EXPORT_DIR [--split SPLIT]
pnpm arena:season build --list ids.txt --export EXPORT_DIR --out SEASON_DIR \
  [--split SPLIT] [--season S1] [--instructions FILE] [--date YYYY-MM-DD]
pnpm arena:season submissions --tasks SEASON_DIR/task-pack \
  --contestant MODEL_DIR --contestant-info info.json --out SEASON_DIR
pnpm arena:season upload --out SEASON_DIR
```

Each run bundles `season.mjs` with the editor code it uses from this
checkout, so the netlist exporter, the Gallery preview renderer and the
#1524 grader are those of the commit the tool runs from. That commit's SHA
is the `rendererVersion` of every bundle; commit before building, since
uncommitted edits under `apps/` or `packages/` only earn a warning.

### Inputs

- **The Owner's list**: one Gallery id per line, in the Season's order.
  Optional tab-separated columns give the circuit name and the function
  class; the name overrides the entry's own. Blank lines, `#` comments and a
  header row whose first column is `id` are skipped. The tool only reads it.
- **A Gallery export**, such as the 2026-10-08 public export: each entry in
  `circuits/<id>/` with `entry.json`, `project.icproj.json` and `netlist.sp`.
- **`--split`**: #1524's private test split, once it exists. Its format is
  not settled; the tool reads JSON (this tool's `season-exclusions.json`, or
  an array of ids, graph hashes or objects with `id`/`gallery`/`graphHash`)
  or text with an id or graph hash first on each line.
- **`--instructions`**: the drawing instructions for model runners. The
  draft is `instructions.md` beside this file; edit it, or pass your own.

### Checks, per id

`check` prints them; `build` prints them and keeps them in
`SEASON_DIR/build-report.json`.

- an unknown id (not in the export);
- not exactly one Cell;
- a netlist the current exporter cannot produce, or refuses as an
  unfinished drawing (the Gallery's gate);
- a netlist the structural SPICE import cannot read, so there can be no
  Grid Baseline (on 2026-10-09 it lacks behavioural sources, which the
  ideal blocks' models use, ideal switches, and generic MOS models with no
  `.model` card);
- a size outside 5–49 devices, counted by the #1524 grader;
- an AI-account author (the display names in `AI_SEATS`,
  `worker/auth-do.ts`, current and former);
- the same id twice, or a duplicate of an earlier id by graph hash (a shared
  hash counts only when the grader also finds the netlists equal);
- membership of #1524's private test split (by id or graph hash);
- no circuit name.

Notes do not block: a current netlist that differs from the export's
`netlist.sp` (the Task always uses the current one), or an export without
`netlist.sp`. The totals give the count per size tier (5–14, 15–49) and per
function class (`(none)` when the list gives none).

### What `build` writes

```
SEASON_DIR/
  task-pack/        manifest.json, instructions.md, tasks/T###.sp
  human-reference/  the author's Project, unchanged, with its SVG and netlist
  grid-baseline/    the Task netlist's structural SPICE import, joined by labels
  check-copy/       the Human Reference with its parts scattered
  season-exclusions.json   chosen Gallery ids and graph hashes, for #1524
  build-report.json
```

- **Task ids** are `T001`… in the list's order.
- **Grid Baseline**: the editor's structural SPICE import of the Task
  netlist, which sets the devices on a grid with the Cell Pins beside them;
  every drawn device pin then gets a two-step stub carrying a Net Label with
  its Net's name. Nothing else joins the devices.
- **Check copy**: the Human Reference's parts moved, one by one, to a
  shuffled partner's place or to random places over an area half again as
  large as the drawing, by a generator seeded from the Gallery id. The
  editor moves each part with its wires; a move is kept only if the netlist
  stays equivalent to the Task's, so a part no place suits stays put.
- **Verification**: the three sets go through the same pipeline as a
  model's files (below). Every item must be `valid`; anything else is
  reported in `build-report.json` and blocks the build.
- **Writing**: everything is drawn in a staging folder and replaces the
  previous build only when it is complete. The editor's fresh IDs are seeded
  per Task, so the same inputs give the same files byte for byte (the
  built-in bundles carry `--date`, which defaults to today in UTC).

### What `submissions` writes

For each `T###.icproj.json` in the model's folder: the SVG rendered as the
Gallery renders previews, the netlist from the editor's exporter, and the
#1524 grade against the Task netlist with source polarity on. A file whose
netlist differs from the Task's is `not-equivalent`, with the grader's
reason. A file that is not a Project, cannot be rendered, or whose netlist
export is blocked is `unreadable`, with the reason (agreed with #1559). A
Task with no file is `missing`. Files named after no Task in the pack, and
files not named after a Task, are reported and left out. The bundle goes
to `SEASON_DIR/<slug>/`, replacing one this tool wrote there before.

Device values are optional (Owner, 2026-10-09); Voters judge them. The
exporter on main refuses a drawing that leaves out a required value, such
as a resistor with no value. When missing required values are the export's
only errors, the drawing is graded on the editor's draft netlist
(`createDraftNetlistPreview`), which prints each missing value as `?`: it
is `valid` when its structure matches the Task and `not-equivalent`
otherwise. Its `netlist` file is that draft, whose first comment line
names the missing values. Any other blocking export error stays
`unreadable`.

`info.json` holds the `contestant` object of the contract below.

### Graph hash

`wl1:` and 64 hex digits: colour refinement of the device–net graph read
under #1524's rules with bodies and source polarity ignored
(`graph-hash.mjs`). Netlists the grader calls equal always share a hash.
The grader's reading is private to `apps/editor/src/headless/grade.ts`, so
`graph-hash.mjs` restates it; duplicates are confirmed by the grader.

### Upload

Not implemented: Arena's upload (#1559) has no interface yet. The seam is
the `upload` command in `cli.mjs`, which exits with status 2 and says so;
until then, upload `task-pack/` and each bundle folder through Arena's
Owner page.

## Season bundle contract (fixed by the orchestrator, 2026-10-09)

The Owner's local Season tool (#1560) writes bundles on disk. Arena (#1559) reads them: the Owner upload page takes a dropped bundle folder, and the HTTP API takes the same content. All text files are UTF-8. Paths are relative to the bundle folder.

### Task pack: `task-pack/manifest.json`

```json
{
  "kind": "analog-arena/task-pack",
  "version": 1,
  "season": "S1",
  "instructionsVersion": "<short id of instructions.md content, e.g. sha256 first 12 hex>",
  "instructions": "instructions.md",
  "tasks": [
    {
      "id": "T001",
      "circuitName": "Two-stage Miller OTA",
      "functionClass": "amplifier",
      "sizeTier": "5-14",
      "devices": 9,
      "netlist": "tasks/T001.sp",
      "netlistHash": "sha256:<hex of the netlist file bytes>",
      "source": { "gallery": "<gallery entry id>" }
    }
  ]
}
```

- `sizeTier` is one of `"5-14"` or `"15-49"`.
- `functionClass` may be `null`.

### Contestant bundle: `<contestant-slug>/manifest.json`

One bundle per Contestant, including the three built-in sets.

```json
{
  "kind": "analog-arena/submissions",
  "version": 1,
  "season": "S1",
  "taskPackHash": "sha256:<hex of task-pack/manifest.json bytes>",
  "contestant": {
    "slug": "claude-opus-5-5",
    "role": "model",
    "name": "Claude Opus 5.5",
    "provider": "Anthropic",
    "modelId": "claude-opus-5-5",
    "reasoning": "xhigh",
    "harness": "Claude Code 2.x + analog-canvas MCP --local",
    "date": "2026-10-12",
    "protocolDeclaration": "Netlist and circuit name only; one attempt; no human edits; instructions <instructionsVersion>; 15-minute limit."
  },
  "rendererVersion": "<Analog Canvas commit SHA the tool ran from>",
  "items": [
    {
      "taskId": "T001",
      "status": "valid",
      "reason": null,
      "project": "T001.icproj.json",
      "svg": "T001.svg",
      "netlist": "T001.sp"
    }
  ]
}
```

- `role` is one of `"model"`, `"tool"`, `"grid-baseline"`, `"human-reference"` or `"check-copy"`. `"check-copy"` is never ranked and is used only for Check Battles.
- `status` is one of `"valid"`, `"not-equivalent"`, `"unreadable"` or `"missing"`. For `missing`, `project`, `svg` and `netlist` are `null`; for `unreadable`, `svg` and `netlist` may be `null`.
- A `valid` item may lack device values (Owner, 2026-10-09): validity is structural equivalence to the Task, and values are optional. Its `netlist` file is then the editor's draft netlist, with each missing value printed as `?` and a first comment line naming them.
- `items` holds exactly one entry per Task in the pack. Files named after an unknown Task id are reported by the tool and left out of the bundle.
- Every bundle in a Season must carry the same `rendererVersion` and `taskPackHash`. Arena rejects a bundle whose renderer version differs from the Season's, with a clear message. Changing the renderer means rebuilding every bundle.
