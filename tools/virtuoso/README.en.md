# Export Virtuoso schematics to Analog Canvas

[中文](README.md) | English

This local tool converts one schematic level into an editable `.icproj.json`. Unmapped devices use boxes retaining external pins. It does not expand hierarchy or guarantee simulation equivalence. No LLM or Bridge is required.

## Build

Install under `tools/virtuoso` in an Analog Canvas checkout. Requirements: Node 24+, pinned pnpm 11.16.0, Python 3.9+ and Virtuoso for native menu use. A user-local Node installation is sufficient.

From the Canvas root, after the workspace lockfile has been updated for these new packages:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @icm/virtuoso-tool test
```

Dependency installation requires network access, an internal mirror or suitable cached dependencies.

## Load the menu

Keep using your usual Virtuoso working directory. The tool location is independent. Replace all example paths with actual absolute paths.

For an already-running Virtuoso, enter in CIW:

```lisp
setShellEnvVar("VC_ROOT=/absolute/path/analog-canvas/tools/virtuoso")
getShellEnvVar("VC_ROOT")
load(strcat(getShellEnvVar("VC_ROOT") "/skill/virtuoso_canvas_ui.il"))
```

Otherwise export `VC_ROOT` in your usual launch terminal or launch script before starting Virtuoso, then load the menu in CIW. Changes in another terminal do not reach an already-running process. For a Node installation outside PATH/default nvm, also set `VC_NODE_PATH` to its executable (or use `setShellEnvVar("VC_NODE_PATH=/absolute/path/bin/node")` in CIW).

## Export

Save the schematic, open Schematic to Canvas, and click Scan devices. Edit mapping selects a Canvas symbol and explicit pin/parameter assignments. Extra source pins are ignored only when explicitly requested. Use this run is temporary; Save personal applies and persists the rule. Select an output directory and filename, then Export project. Existing filenames require overwrite confirmation.

Scale controls coordinate scaling. Space-separated Power/Ground names determine supply markers and simplifications. Bundled bus mode draws one line without verifying bitwise equivalence. Disabled instances controls retaining/skipping disabled devices; Show instance names controls labels instead. Isolated pins controls removal of unwired standalone pins.

Open Analog Canvas opens the built local editor, but does not import the exported project automatically. Personal files default to `~/.config/virtuoso-canvas/config.json` and `mappings.json`. Set `VC_PERSONAL_DIR` before loading to reuse an existing personal directory.

## CLI

In CIW, load `skill/export_schematic.il` using `VC_ROOT`, then export a snapshot:

```lisp
VCExportCell("myLib" "myCell" "schematic" "/tmp/design.snapshot.json")
```

From the Canvas root:

```bash
node tools/virtuoso/dist/cli/main.js prepare /tmp/design.snapshot.json --out /tmp/design-settings
```

Review/edit the generated `mappings.json`, then:

```bash
node tools/virtuoso/dist/cli/main.js convert /tmp/design.snapshot.json --mappings /tmp/design-settings/mappings.json --out /tmp/design-canvas
```

Successful output contains `project.icproj.json` and `report.json`. Add `--preview` for SVG or `--debug` for intermediate diagnostics. Failures publish diagnostics only, not projects or previews. Use `--help` for all options.

The original tool code is [MIT licensed](LICENSE.md). Analog Canvas retains its AGPL license and third-party terms; MIT does not remove those obligations. Neither Virtuoso nor PDKs are distributed here.
