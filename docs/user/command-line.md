# Command line

Draw a schematic and export its PNG, SVG and netlist with no browser, from a
script or an Agent. Each workspace is one directory holding one Project file,
`project.icproj.json`, which the web editor opens too.

The command line follows each MCP release and changes often. Scripts that must
keep working pin a release with `--version` (or `ANALOG_CANVAS_VERSION`).

## Setup

Needs Node.js 24 or newer. Download the one-file tool and the example:

```sh
curl -LO https://raw.githubusercontent.com/cascode-ai/analog-canvas/main/scripts/canvas-local.mjs
```

```sh
curl -LO https://raw.githubusercontent.com/cascode-ai/analog-canvas/main/docs/user/examples/common-source/place.json -LO https://raw.githubusercontent.com/cascode-ai/analog-canvas/main/docs/user/examples/common-source/wire.json -LO https://raw.githubusercontent.com/cascode-ai/analog-canvas/main/docs/user/examples/common-source/labels.json
```

Its first run downloads the current MCP release from GitHub into
`~/.analog-canvas` and checks it against the release's `SHA256SUMS.txt`;
`node canvas-local.mjs setup` does that alone.

## Draw and export

The common-source example draws an NMOS stage in three calls: parts
([place.json](examples/common-source/place.json)), then wires
([wire.json](examples/common-source/wire.json)), then the textbook labels
([labels.json](examples/common-source/labels.json)).

```sh
node canvas-local.mjs new cs --name "Common-source amplifier"
node canvas-local.mjs call cs apply_actions @place.json
node canvas-local.mjs call cs apply_actions @wire.json
node canvas-local.mjs call cs apply_actions @labels.json
node canvas-local.mjs png cs
node canvas-local.mjs netlist cs
```

`png` writes `cs/schematic.png`, `svg` writes `cs/schematic.svg`, and
`netlist` writes `cs/netlist.sp`; give a path to write elsewhere.
`netlist cs --format spectre` writes Spectre. The PNG is drawn at 3× in the
same fonts as the web editor's export and cropped to what the drawing shows.
PDF needs the web editor.

## Writing actions

`call <dir> <tool> <json>` runs one tool of the
[MCP adapter](../agent/README.md); `@file.json` reads the arguments from a
file. Each call answers with JSON, `"ok": false` and a message when refused.
A refused call changes nothing.

- Part names and pin positions: `call cs resource
'analog-canvas://catalog/builtins?symbols=nmos,resistor'`.
- Exact action fields: `call cs describe_tool
'{"tool":"apply_actions","operations":["place-component","connect"]}'`.
- Place parts, then wire them, in separate `apply_actions` calls. Positions
  sit on a 10-unit grid; a tap on a wire (`wire-at`) on a 2-unit grid.
- `netlist_code` `{"action":"read"}` shows the netlist and why it is blocked;
  `verify` compares it with an expected netlist.

Simulation, the Gallery and Cloud Projects need the website. Open the
workspace's `project.icproj.json` in the web editor (**File → Import →
Project File…**) to continue there. [Local workspaces](../agent/local-workspace.md) describe the
underlying mode.
