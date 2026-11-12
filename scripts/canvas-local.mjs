#!/usr/bin/env node
// Draw Analog Canvas schematics from the command line, with no browser.
// One file, Node 24 or newer, no dependencies: it downloads the released MCP
// adapter and its headless drawing engine once, checks both against the
// release's SHA256SUMS.txt, and runs them in local mode on a workspace
// directory (one Project file). See docs/user/command-line.md.
//
//   node canvas-local.mjs new <dir> [--name <name>] [--process <id>]
//   node canvas-local.mjs call <dir> <tool> [<json> | @<file.json>]
//   node canvas-local.mjs call <dir> resource <uri>
//   node canvas-local.mjs png <dir> [<out.png>]
//   node canvas-local.mjs svg <dir> [<out.svg>]
//   node canvas-local.mjs netlist <dir> [<out.sp>] [--format spice|spectre]
//   node canvas-local.mjs setup [--version <x.y.z>]
//
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
  call <dir> <tool> [<json> | @<file.json>]    run one MCP tool on it, e.g. apply_actions
  call <dir> resource <uri>                    read a reference, e.g. the part catalog
  png <dir> [<out.png>]                        export the top Cell as PNG
  svg <dir> [<out.svg>]                        export the top Cell as SVG
  netlist <dir> [<out.sp>] [--format spice|spectre]
                                               export the top Cell's netlist
  setup [--version <x.y.z>]                    download and check a release now

Options: --version <x.y.z> (or ANALOG_CANVAS_VERSION) pins the release.
Default outputs go into <dir>: schematic.png, schematic.svg, netlist.sp.`;

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
    if (argument.startsWith("--")) {
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

function topDocument(dir) {
  const path = join(resolve(dir), "project.icproj.json");
  if (!existsSync(path))
    fail(`${dir} is not a workspace; create one with: canvas-local new ${dir}`);
  return JSON.parse(readFileSync(path, "utf8")).topDocumentId;
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
} else if (command === "call") {
  const [tool, argument = "{}"] = rest;
  if (!tool) fail("call needs a tool name, e.g. apply_actions");
  const input = argument.startsWith("@")
    ? readFileSync(argument.slice(1), "utf8")
    : argument;
  report(call(adapter, dir, tool, input));
} else if (command === "png" || command === "svg") {
  const outputPath = resolve(rest[0] ?? join(dir, `schematic.${command}`));
  mkdirSync(dirname(outputPath), { recursive: true });
  report(
    call(
      adapter,
      dir,
      "export_file",
      JSON.stringify({
        artifact: command,
        documentId: topDocument(dir),
        outputPath,
      }),
    ),
  );
} else if (command === "netlist") {
  const format = flags.format ?? "spice";
  const result = call(
    adapter,
    dir,
    "netlist_code",
    JSON.stringify({ action: "read", format }),
  );
  const netlist = result?.netlist;
  if (
    !netlist ||
    netlist.status !== "ready" ||
    typeof netlist.text !== "string"
  )
    report({ ...result, ok: false });
  const outputPath = resolve(
    rest[0] ?? join(dir, format === "spectre" ? "netlist.scs" : "netlist.sp"),
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, netlist.text);
  report({ ok: true, format, outputPath });
} else fail(`Unknown command ${command}\n\n${USAGE}`);
