#!/usr/bin/env node
// Draw Analog Canvas schematics from the command line, with no browser.
// One file, Node 24 or newer, no dependencies: it downloads the released MCP
// adapter and its headless drawing engine once, checks both against the
// release's SHA256SUMS.txt, and runs them in local mode on a workspace
// directory (one Project file). Full guide: docs/user/command-line.md.
//
// Quick start: the files are in docs/user/examples/common-source/.
//
//   node canvas-local.mjs new cs                                # workspace cs/
//   node canvas-local.mjs apply cs place.json wire.json labels.json
//   node canvas-local.mjs png cs                                # cs/schematic.png
//   node canvas-local.mjs netlist cs                            # cs/netlist.sp
//
// An action file is {"actions":[{"kind":"place-component", ...}, ...]}.
// Place parts in one file and wire them in the next: `apply` says when a
// file mixes steps that need separate calls.
// Part names and pins: `node canvas-local.mjs catalog cs nmos,resistor`.
// Exact fields of an action: `node canvas-local.mjs help-action cs connect`.
//
// A sub-circuit is a Cell (docs/user/examples/divider-cell/): create it,
// draw inside it with --cell, place it in the top Cell, export each:
//
//   node canvas-local.mjs apply dv 1-cell.json                  # create-cell "half"
//   node canvas-local.mjs apply dv 2-half-parts.json 3-half-wires.json --cell half
//   node canvas-local.mjs apply dv 4-top-cell.json 5-top-ports.json 6-top-wires.json
//   node canvas-local.mjs cells dv                              # id, name, top
//   node canvas-local.mjs png dv --all                          # one PNG per Cell
//   node canvas-local.mjs netlist dv                            # both subcircuits
//
// Every command:
//
//   new <dir> [--name <name>] [--process <id>]
//   apply <dir> <file.json>... [--cell <id|name>]
//   cells <dir>
//   png|svg <dir> [<out>] [--cell <id|name> | --all]
//   netlist <dir> [<out.sp>] [--cell <id|name>] [--format spice|spectre] [--process <id>]
//   catalog <dir> <symbol,symbol>
//   help-action <dir> <kind,kind>
//   call <dir> <tool> [<json> | @<file.json>] [--cell <id|name>]
//   call <dir> resource <uri>
//   setup [--version <x.y.z>]
//
// `apply` prints one line per file and stops at the first refusal; a refused
// file changes nothing. `call` runs any MCP tool and prints its whole reply.
// The interface follows each release and changes often; pin one with
// --version or ANALOG_CANVAS_VERSION for repeatable scripts.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SITE = "https://analog-canvas.tokenzhang.com";
const RELEASES =
  "https://github.com/cascode-ai/analog-canvas/releases/download";
const HOME = resolve(
  process.env.ANALOG_CANVAS_HOME ?? join(homedir(), ".analog-canvas"),
  "mcp",
);
const ADAPTER = "analog-canvas-mcp.mjs";
const HEADLESS = "analog-canvas-headless.mjs";

const USAGE = `Analog Canvas from the command line (docs/user/command-line.md)

  new <dir> [--name <name>] [--process <id>]   create a workspace (one Project file)
  apply <dir> <file.json>... [--cell <c>]      run each file's {"actions":[...]} in order
  cells <dir>                                  list the Cells: id, name, which is top
  png <dir> [<out.png>] [--cell <c> | --all]   export a Cell (default: the top) as PNG
  svg <dir> [<out.svg>] [--cell <c> | --all]   export a Cell as SVG
  netlist <dir> [<out.sp>] [--cell <c>] [--format spice|spectre] [--process <id>]
                                               export a Cell's netlist
  catalog <dir> <symbol,symbol>                part names, pins and their positions
  help-action <dir> <kind,kind>                exact fields of apply_actions actions
  call <dir> <tool> [<json> | @<file.json>] [--cell <c>]
                                               run one MCP tool, print its whole reply
  call <dir> resource <uri>                    read a reference
  setup [--version <x.y.z>]                    download and check a release now

<c> is a Cell's id or name (see cells). Options: --version <x.y.z> (or
ANALOG_CANVAS_VERSION) pins the release. Default outputs go into <dir>:
schematic.png, schematic-<cell>.png, schematic.svg, netlist.sp.`;

/** A file's text, or a plain message when it cannot be read. */
function readInput(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return fail(`Cannot read ${file}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Positional arguments and --flags (each flag takes one value). */
function parse(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") flags.all = true;
    else if (argument.startsWith("--")) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        fail(`${argument} needs a value`);
      flags[argument.slice(2)] = value;
      index += 1;
    } else positional.push(argument);
  }
  return { positional, flags };
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) fail(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function latestVersion() {
  const response = await fetch(`${SITE}/api/agent/mcp-manifest.json`, {
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (response?.ok) return (await response.json()).version;
  // Offline: the newest release already downloaded.
  const installed = existsSync(HOME)
    ? readdirSync(HOME)
        .filter((version) => existsSync(join(HOME, version, ADAPTER)))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  if (installed.length === 0)
    fail(`Cannot reach ${SITE} to find the current release`);
  return installed.at(-1);
}

/** The adapter to run: a pinned or current release, downloaded once. */
async function install(version) {
  if (process.env.ANALOG_CANVAS_MCP)
    return resolve(process.env.ANALOG_CANVAS_MCP);
  version ??= process.env.ANALOG_CANVAS_VERSION ?? (await latestVersion());
  if (!/^\d+\.\d+\.\d+$/u.test(version))
    fail(`Not a release version: ${version}`);
  const directory = join(HOME, version);
  const adapter = join(directory, ADAPTER);
  if (existsSync(adapter) && existsSync(join(directory, HEADLESS)))
    return adapter;
  const base = `${RELEASES}/mcp-v${version}`;
  console.error(`Downloading Analog Canvas MCP ${version} …`);
  const sums = new Map(
    (await download(`${base}/SHA256SUMS.txt`))
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.trim().split(/\s+/u).reverse()),
  );
  const checked = async (name) => {
    const bytes = await download(`${base}/${name}`);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (!sums.get(name) || sums.get(name) !== digest)
      fail(`${name} does not match the release's SHA256SUMS.txt`);
    return bytes;
  };
  const archive = await checked(`analog-canvas-mcp-server-${version}.tgz`);
  const headless = await checked(`analog-canvas-headless-${version}.mjs`);
  const code = execFileSync("tar", ["-xOzf", "-", `package/bin/${ADAPTER}`], {
    input: archive,
    maxBuffer: 64_000_000,
    windowsHide: true,
  });
  mkdirSync(directory, { recursive: true });
  // Written under temporary names, then moved, so a stopped download never
  // leaves a half file that looks installed.
  writeFileSync(`${adapter}.part`, code);
  writeFileSync(join(directory, `${HEADLESS}.part`), headless);
  renameSync(join(directory, `${HEADLESS}.part`), join(directory, HEADLESS));
  renameSync(`${adapter}.part`, adapter);
  console.error(`Installed in ${directory}`);
  return adapter;
}

/** One MCP tool call on a workspace; the tool's JSON reply. */
function call(adapter, dir, tool, input = "{}", extra = []) {
  const run = spawnSync(
    process.execPath,
    [adapter, "--local", resolve(dir), ...extra, "--http", tool],
    { input, encoding: "utf8", maxBuffer: 256_000_000, windowsHide: true },
  );
  if (run.status !== 0 && !run.stdout)
    fail(run.stderr.trim() || `${tool} failed`);
  let reply;
  try {
    reply = JSON.parse(run.stdout);
  } catch {
    fail(run.stdout.trim() || run.stderr.trim() || `${tool} gave no reply`);
  }
  const text =
    reply?.content?.find?.((part) => part.type === "text")?.text ??
    (typeof reply?.text === "string" ? reply.text : undefined);
  if (text === undefined) return reply;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: !reply.isError, text };
  }
}

function project(dir) {
  const path = join(resolve(dir), "project.icproj.json");
  if (!existsSync(path))
    fail(`${dir} is not a workspace; create one with: canvas-local new ${dir}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Every Cell of the workspace, the top one first. */
function cells(dir) {
  const { topDocumentId, documents = [] } = project(dir);
  return documents
    .map((document) => ({
      id: document.id,
      name: document.name ?? document.id,
      top: document.id === topDocumentId,
    }))
    .sort((left, right) => Number(right.top) - Number(left.top));
}

/** The Cell `--cell` names, by id or name; the top Cell without it. */
function cell(dir, wanted) {
  const all = cells(dir);
  if (wanted === undefined) return all[0];
  const found =
    all.find((candidate) => candidate.id === wanted) ??
    all.filter((candidate) => candidate.name === wanted);
  if (!Array.isArray(found)) return found;
  if (found.length === 1) return found[0];
  fail(
    `${found.length ? "Several Cells are" : "No Cell is"} named ${wanted}; the Cells are:\n${all
      .map((candidate) => `  ${candidate.id}  ${candidate.name}`)
      .join("\n")}`,
  );
}

/** A tool's arguments with the Cell `--cell` names, unless they name one. */
function inCell(dir, input, wanted) {
  if (wanted === undefined) return input;
  let argument;
  try {
    argument = JSON.parse(input);
  } catch {
    fail("The arguments are not JSON");
  }
  return JSON.stringify({ documentId: cell(dir, wanted).id, ...argument });
}

/** One line for an apply_actions reply: what changed, or why it was refused. */
function summary(file, result) {
  if (result?.ok === false)
    return `${file}: refused, nothing changed: ${result.message ?? result.text ?? JSON.stringify(result)}`;
  const added = result?.diagnosticDelta?.added ?? [];
  const notes = added
    .filter((item) => item.code)
    .map((item) => `\n  ${item.code}: ${item.message}`)
    .join("");
  return `${file}: ok, revision ${result?.revision ?? "?"}${notes}`;
}

function report(result) {
  console.log(JSON.stringify(result, null, 2));
  if (result?.ok === false) process.exit(1);
}

const { positional, flags } = parse(process.argv.slice(2));
const [command, dir, ...rest] = positional;
if (!command || command === "help" || command === "--help") {
  console.log(USAGE);
  process.exit(0);
}
if (command === "setup") {
  console.log(await install(flags.version));
  process.exit(0);
}
if (!dir) fail(USAGE);
const adapter = await install(flags.version);

if (command === "new") {
  report(
    call(adapter, dir, "connect", "{}", [
      "--new",
      ...(flags.name ? ["--name", flags.name] : []),
      ...(flags.process ? ["--process", flags.process] : []),
    ]),
  );
} else if (command === "apply") {
  if (!rest.length) fail("apply needs one or more action files");
  for (const file of rest) {
    const input = inCell(dir, readInput(file), flags.cell);
    const result = call(adapter, dir, "apply_actions", input);
    console.log(summary(file, result));
    if (result?.ok === false) process.exit(1);
  }
} else if (command === "cells") {
  for (const { id, name, top } of cells(dir))
    console.log(`${id}\t${name}${top ? "\t(top)" : ""}`);
} else if (command === "catalog") {
  if (!rest[0]) fail("catalog needs symbol names, e.g. nmos,resistor");
  report(
    call(
      adapter,
      dir,
      "resource",
      `analog-canvas://catalog/builtins?symbols=${encodeURIComponent(rest[0])}`,
    ),
  );
} else if (command === "help-action") {
  if (!rest[0]) fail("help-action needs action kinds, e.g. connect");
  report(
    call(
      adapter,
      dir,
      "describe_tool",
      JSON.stringify({ tool: "apply_actions", operations: rest[0].split(",") }),
    ),
  );
} else if (command === "call") {
  const [tool, argument = "{}"] = rest;
  if (!tool) fail("call needs a tool name, e.g. apply_actions");
  const input = argument.startsWith("@")
    ? readInput(argument.slice(1))
    : argument;
  report(
    call(
      adapter,
      dir,
      tool,
      tool === "resource" ? input : inCell(dir, input, flags.cell),
    ),
  );
} else if (command === "png" || command === "svg") {
  const targets = flags.all ? cells(dir) : [cell(dir, flags.cell)];
  for (const target of targets) {
    const named = flags.all || flags.cell !== undefined;
    const outputPath = resolve(
      (!flags.all && rest[0]) ||
        join(
          dir,
          named && !target.top
            ? `schematic-${target.name.replace(/[^\w.-]+/gu, "_")}.${command}`
            : `schematic.${command}`,
        ),
    );
    mkdirSync(dirname(outputPath), { recursive: true });
    const result = call(
      adapter,
      dir,
      "export_file",
      JSON.stringify({ artifact: command, documentId: target.id, outputPath }),
    );
    if (result?.ok === false) report(result);
    console.log(`${target.name}: ${outputPath}`);
  }
} else if (command === "netlist") {
  const format = flags.format ?? "spice";
  const target = flags.cell === undefined ? undefined : cell(dir, flags.cell);
  const result = call(
    adapter,
    dir,
    "netlist_code",
    JSON.stringify({
      action: "read",
      format,
      ...(target ? { documentId: target.id } : {}),
      ...(flags.process ? { process: flags.process } : {}),
    }),
  );
  const netlist = result?.netlist;
  if (
    !netlist ||
    netlist.status !== "ready" ||
    typeof netlist.text !== "string"
  )
    fail(
      `Netlist blocked, nothing written:\n${
        (netlist?.diagnostics ?? [])
          .filter((item) => item.severity === "error")
          .map((item) => `  ${item.code}: ${item.message}`)
          .join("\n") || `  ${result?.message ?? JSON.stringify(result)}`
      }`,
    );
  const ext = format === "spectre" ? "scs" : "sp";
  const outputPath = resolve(
    rest[0] ??
      join(
        dir,
        target && !target.top
          ? `netlist-${target.name.replace(/[^\w.-]+/gu, "_")}.${ext}`
          : `netlist.${ext}`,
      ),
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, netlist.text);
  console.log(`${(target ?? cell(dir)).name}: ${outputPath}`);
} else fail(`Unknown command ${command}\n\n${USAGE}`);
