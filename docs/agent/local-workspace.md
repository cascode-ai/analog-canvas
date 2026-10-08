# Repository-only local workspaces: drawing without a browser

Read when batch work or an Agent draws circuits with no editor page open: the
reference-dataset redraws, Gallery batch checks, jobs on a build server. This
is an internal tool (#1498): no stability promise yet, and it is not shipped
as an MCP resource.

`analog-canvas-mcp --local <dir>` serves every MCP tool from one Project
file, `<dir>/project.icproj.json`, through the editor's own Agent host
running in the MCP process. There is no browser, relay, sign-in, network or
daily limit. Calls are planned and committed exactly as a paired page would
commit them, and the file is the `.icproj.json` the editor opens and saves,
so a drawing can be finished by hand in the editor, or published, and a
saved Project can be drawn on here.

## Create and open

- `--new` creates the workspace when the directory holds none: one empty top
  Cell, `main`. `--name <name>` names the Project; `--reference <file.sp>`
  copies a netlist to `<dir>/reference.sp` to check the drawing against.
- An existing workspace opens as it is, `--new` or not; its name and
  reference are never replaced. A restarted worker therefore resumes its
  drawing. Without `--new`, a missing workspace is refused.
- `--process <id>` chooses the Process new transistors are placed in:
  `abstract`, `sky130` (the editor's default), `sg13g2`, `tsmc28`, `tsmc180`
  or `custom`. Use the same one for every call on a workspace.

## Run it

As an MCP server, configure the host's command as, for example,
`node <package>/bin/analog-canvas-mcp.mjs --local /abs/jobs/opamp-12 --new`.
`connect` needs no claim code, and no tool needs `connect` first. Each call that changes the Project writes the file at once
(written beside it and renamed over it, so a reader never sees half), and
the process holds the workspace until it ends. `disconnect` keeps it.

As a command line, add `--http <tool>` and give the tool's JSON arguments on
standard input, as in the [shared-client command line](http-cli.md). Each
command opens the workspace, runs, writes the file and lets the workspace go:

```sh
mcp="node <package>/bin/analog-canvas-mcp.mjs"
echo '{}' | $mcp --local ws --new --reference opamp.sp --http connect
echo '{"actions":[...]}' | $mcp --local ws --http apply_actions
jq -n --rawfile text ws/reference.sp '{expectedNetlist:{text:$text}}' \
  | $mcp --local ws --http verify
```

`--http batch` runs one tool call per JSON line,
`{"tool":"apply_actions","args":{...}}`, in one process. `render` returns
the formal SVG, `netlist_code` `{"action":"read"}` the netlist, and
`export_file` `{"artifact":"project"}` a copy of the Project.

## Parallel workers

Give each worker its own directory. A workspace is held by one process at a
time: `<dir>/.lock` names it, and another process opening the same directory
is refused with "in use by process N" (a command line included, while a
server holds the workspace). A lock left by a process that no longer runs is
taken over. Different directories never contend, so workers parallelise
freely. A signal (SIGINT, SIGTERM, SIGHUP) writes the file and releases the
lock before the process ends.

## What a local workspace cannot do

- Simulation: refused as `SIMULATION_UNAVAILABLE`. Simulate in the editor, or
  locally with ngspice and the Process models.
- The Gallery, Cloud Projects and the editor's open tabs
  (`gallery_circuits`, `project_cells`): refused as `WEBSITE_REQUIRED`.
- Figure files (`export_file` svg, png, pdf), whose crop the editor measures
  in a page: refused as `WEBSITE_REQUIRED`. `render` gives the formal SVG.

## Where the drawing code comes from

The release package carries the editor's drawing code as
`bin/analog-canvas-headless.mjs`, beside `bin/analog-canvas-mcp.mjs`, and
loads it only in this mode; keep the two files together. In a checkout, run
`pnpm build` and `pnpm headless:package`: the workspace build
(`apps/mcp-server/dist/main.js`) then finds
`output/headless/analog-canvas-headless.mjs`. `ANALOG_CANVAS_HEADLESS=<path>`
names another bundle. Rebuild it after pulling, so a drawing matches the
editor of the same commit.

Scripts that need no MCP can import that module directly:
`createWorkspace`, `openLocalWorkspace` (whose `editor` answers Circuit, File
and Project requests), `workspaceNetlist`, `workspaceSvg` and
`compareNetlists` in `apps/editor/src/headless`.
