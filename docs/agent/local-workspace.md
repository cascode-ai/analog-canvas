# Local workspaces for drawing without a browser

For batch work or an Agent drawing with no editor page open (dataset redraws,
Gallery batch checks, build-server jobs). Internal tool (#1498): no stability
promise, not shipped as an MCP resource.

`analog-canvas-mcp --local <dir>` serves every MCP tool from one Project file,
`<dir>/project.icproj.json`, through the editor's own Agent host in the MCP
process: no browser, relay, sign-in, network or daily limit. Calls plan and
commit as a paired page would, on the `.icproj.json` the editor opens and
saves. A `focus` in `apply_actions` is skipped (`VIEW_STEP_SKIPPED` warning).

- `--new` creates a workspace with one empty top Cell `main` when none exists;
  `--name` names the Project; `--reference <file.sp>` copies a netlist to
  `<dir>/reference.sp`. An existing workspace opens unchanged, so a restarted
  worker resumes; without `--new` a missing one is refused. `--process`
  (`abstract`, `sky130` default, `sg13g2`, `custom`) sets
  the Process for new transistors; keep one per workspace.
- As an MCP server (`node <package>/bin/analog-canvas-mcp.mjs --local /abs/jobs/opamp-12 --new`)
  `connect` needs no claim and no tool needs `connect` first; each change
  writes the file atomically; the process holds the workspace until it ends.
- As a command line, `--http <tool>` with JSON on stdin
  ([shared-client CLI](http-cli.md)) opens, runs, writes and releases per
  command; `--http batch` runs one call per line in one process.

```sh
mcp="node <package>/bin/analog-canvas-mcp.mjs"
echo '{}' | $mcp --local ws --new --reference opamp.sp --http connect
echo '{"actions":[...]}' | $mcp --local ws --http apply_actions
jq -n --rawfile text ws/reference.sp '{expectedNetlist:{text:$text}}' \
  | $mcp --local ws --http verify
```

`render` returns the formal SVG, `netlist_code` `{"action":"read"}` the
netlist, `export_file` `{"artifact":"project"}` a Project copy. Refused:
simulation (`SIMULATION_UNAVAILABLE`), Gallery, Cloud and tabs
(`gallery_circuits`, `project_cells`) and figure exports, which need a page
(`WEBSITE_REQUIRED`).

One process holds a workspace (`<dir>/.lock`; another opener is refused "in use
by process N"; a dead process's lock is taken over), so give each worker its
own directory. SIGINT, SIGTERM and SIGHUP write the file and release the lock.

Download `analog-canvas-headless-<version>.mjs` from the matching
[MCP release](https://github.com/cascode-ai/analog-canvas/releases) and verify
its digest against `SHA256SUMS.txt`. Set `ANALOG_CANVAS_HEADLESS` to the
downloaded file. Existing installations can continue using their adjacent
`analog-canvas-headless.mjs`. In a checkout run `pnpm build` and
`pnpm headless:package`.
Scripts can import the workspace API from `apps/editor/src/headless`.
