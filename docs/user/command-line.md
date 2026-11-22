# Command line

Draw a schematic and export its PNG, SVG and netlist with no browser, from a
script or an Agent. A workspace is one directory holding one Project file,
`project.icproj.json`, which the web editor opens too.

The command line follows each MCP release and changes often. Scripts that must
keep working pin a release with `--version` (or `ANALOG_CANVAS_VERSION`).

## Setup

Needs Node.js 24 or newer. Download the one-file tool:

```sh
curl -LO https://raw.githubusercontent.com/cascode-ai/analog-canvas/main/scripts/canvas-local.mjs
```

Its first run downloads the current MCP release from GitHub into
`~/.analog-canvas` and checks it against the release's `SHA256SUMS.txt`;
`node canvas-local.mjs setup` does that alone. `node canvas-local.mjs help`
lists every command.

## Draw one circuit

You write the drawing as action files, each `{"actions": [...]}`, and apply
them in order. The [common-source example](examples/common-source/) draws an
NMOS stage: parts ([place.json](examples/common-source/place.json)), wires
([wire.json](examples/common-source/wire.json)), then the textbook labels
([labels.json](examples/common-source/labels.json)).

```sh
node canvas-local.mjs new cs --name "Common-source amplifier"
node canvas-local.mjs apply cs place.json wire.json labels.json
node canvas-local.mjs png cs
node canvas-local.mjs netlist cs
```

`apply` prints one line per file: `ok` with any warnings, or why it was
refused. A refused file changes nothing, and `apply` stops there. `png`
writes `cs/schematic.png`, `svg` writes `cs/schematic.svg`, `netlist` writes
`cs/netlist.sp`; give a path to write elsewhere. `netlist --format spectre`
writes Spectre; `--process abstract|sky130|sg13g2|ics55|gpdk045` writes that Process
without changing the Project. A blocked netlist lists each reason and writes
nothing. PDF needs the web editor.

## Draw a sub-circuit (Cell)

A Cell is a sub-circuit with its own sheet. `--cell <id or name>` makes
`apply`, `png`, `svg`, `netlist` and `call` work on it instead of the top
Cell. The [divider-cell example](examples/divider-cell/) draws a divider in a
Cell `half` and uses it in the top Cell:

```sh
node canvas-local.mjs new dv
node canvas-local.mjs apply dv 1-cell.json
node canvas-local.mjs apply dv 2-half-parts.json 3-half-wires.json --cell half
node canvas-local.mjs apply dv 4-top-cell.json 5-top-ports.json 6-top-wires.json
node canvas-local.mjs cells dv
node canvas-local.mjs png dv --all
node canvas-local.mjs netlist dv
```

`1-cell.json` creates the Cell (`create-cell`); its ports become the Cell's
pins. `4-top-cell.json` places it (`place-cell`). `cells` lists each Cell's
id and name. `png --all` writes one PNG per Cell (`schematic-half.png`
beside `schematic.png`); `netlist` writes every subcircuit the top Cell uses.

## Writing actions

- Part names, pin names and pin positions: `node canvas-local.mjs catalog cs
nmos,resistor`.
- Exact fields of an action: `node canvas-local.mjs help-action cs
place-component,connect`.
- Place parts in one file and wire them in the next; a file that mixes steps
  needing separate calls is refused with the order to send them in.
- Positions sit on a 10-unit grid; a tap on a wire (`wire-at`) on a 2-unit
  grid.
- `call <dir> <tool> <json>` (or `@file.json`) runs any tool of the
  [MCP adapter](../agent/README.md) and prints its whole JSON reply, e.g.
  `call cs inspect '{"detail":"parts","target":{"kind":"document"}}'` lists
  the parts, and `verify` compares the drawing with an expected netlist.

Simulation, the Gallery and Cloud Projects need the website. Open the
workspace's `project.icproj.json` in the web editor (**File → Import →
Project File…**) to continue there. [Local workspaces](../agent/local-workspace.md)
describe the underlying mode.
