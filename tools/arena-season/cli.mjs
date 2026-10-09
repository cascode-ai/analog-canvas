#!/usr/bin/env node
// The Owner's Season tool for AnalogArena (#1560). See README.md.
//
//   pnpm arena:season build --list ids.txt --export DIR --out DIR
//   pnpm arena:season check --list ids.txt --export DIR
//   pnpm arena:season submissions --tasks DIR --contestant DIR
//                                 --contestant-info info.json --out DIR
//   pnpm arena:season upload --out DIR
//
// Each run bundles season.mjs with the editor code it uses, from this
// checkout's sources, so the exporter, renderer and grader are always the
// ones of the commit the tool runs from; that commit's SHA is the
// rendererVersion every bundle carries.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const DEFAULT_INSTRUCTIONS = resolve(import.meta.dirname, "instructions.md");

const USAGE = `Usage:
  pnpm arena:season build --list FILE --export DIR --out DIR
                          [--split FILE] [--season S1] [--instructions FILE]
                          [--date YYYY-MM-DD]
  pnpm arena:season check --list FILE --export DIR [--split FILE]
  pnpm arena:season submissions --tasks DIR --contestant DIR
                                --contestant-info FILE --out DIR
  pnpm arena:season upload --out DIR

build    Checks the Owner's list against the Gallery export and, when no id
         has a problem, writes the Task pack, the human-reference,
         grid-baseline and check-copy bundles and season-exclusions.json to
         --out. The report is printed and kept as --out/build-report.json.
check    The same checks only, printed.
submissions
         Renders, exports and grades every T###.icproj.json in --contestant
         against the Task pack and writes the bundle to --out/<slug>/.
upload   Not available yet: #1559 has no upload interface to call.

The list holds one Gallery id per line; optional tab-separated columns give
the circuit name and the function class. --split is #1524's private test
split, when it exists. --date (default today, UTC) dates the three built
bundles; --instructions defaults to tools/arena-season/instructions.md.`;

const COMMANDS = new Set(["build", "check", "submissions", "upload"]);
const VALUED = new Set([
  "--list",
  "--export",
  "--out",
  "--split",
  "--season",
  "--instructions",
  "--date",
  "--tasks",
  "--contestant",
  "--contestant-info",
]);
const REQUIRED = {
  build: ["--list", "--export", "--out"],
  check: ["--list", "--export"],
  submissions: ["--tasks", "--contestant", "--contestant-info", "--out"],
  upload: ["--out"],
};

function parseArguments(argv) {
  const options = {};
  let command;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--") continue;
    if (flag === "--help" || flag === "-h") return { help: true };
    if (VALUED.has(flag)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`${flag} needs a value\n\n${USAGE}`);
      options[flag] = value;
      index += 1;
    } else if (flag.startsWith("--"))
      throw new Error(`Unknown option ${flag}\n\n${USAGE}`);
    else if (command === undefined && COMMANDS.has(flag)) command = flag;
    else throw new Error(`Unexpected ${flag}\n\n${USAGE}`);
  }
  if (!command) throw new Error(`Name a command\n\n${USAGE}`);
  for (const flag of REQUIRED[command])
    if (!options[flag]) throw new Error(`${command} needs ${flag}\n\n${USAGE}`);
  if (options["--date"] && !/^\d{4}-\d{2}-\d{2}$/u.test(options["--date"]))
    throw new Error("--date reads YYYY-MM-DD");
  return { command, options };
}

/** The commit this tool runs from; a changed renderer must be committed. */
function rendererVersion() {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const changed = git("status", "--porcelain", "--", "apps", "packages");
  if (changed)
    console.error(
      "Warning: apps/ or packages/ differ from the commit; the bundles name the commit, not these edits.",
    );
  return git("rev-parse", "HEAD");
}

/** season.mjs and the editor code it imports, as one Node module. */
async function loadSeason() {
  const { build } = await import("vite");
  const { version } = JSON.parse(
    readFileSync(join(root, "config/agent-mcp-distribution.json"), "utf8"),
  );
  const outDir = mkdtempSync(join(tmpdir(), "arena-season-"));
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    define: { __ANALOG_CANVAS_MCP_VERSION__: JSON.stringify(version) },
    resolve: { conditions: ["development"] },
    ssr: {
      noExternal: true,
      resolve: {
        conditions: ["development"],
        externalConditions: ["development"],
      },
    },
    build: {
      ssr: resolve(import.meta.dirname, "season.mjs"),
      outDir,
      emptyOutDir: true,
      target: "node24",
      minify: false,
      rollupOptions: {
        output: { entryFileNames: "season.mjs", codeSplitting: false },
      },
    },
  });
  process.on("exit", () => rmSync(outDir, { recursive: true, force: true }));
  return import(pathToFileURL(join(outDir, "season.mjs")).href);
}

const readText = (path) => readFileSync(resolve(path), "utf8");

async function main(argv) {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  const { command, options } = parsed;
  if (command === "upload") {
    // The upload seam. #1559 will take the Task pack and each Contestant
    // bundle in --out (the folders README.md describes) over its HTTP
    // interface; until that interface exists, the Owner drops the folders
    // on Arena's upload page by hand.
    console.error(
      `Upload is not available yet: Arena's Season set-up (#1559) has no upload interface to call. Upload ${resolve(options["--out"])}'s task-pack and bundle folders through Arena's Owner page instead.`,
    );
    return 2;
  }
  const season = await loadSeason();
  if (command === "submissions") {
    const result = await season.submitContestant({
      taskPackDir: resolve(options["--tasks"]),
      contestantDir: resolve(options["--contestant"]),
      contestant: JSON.parse(readText(options["--contestant-info"])),
      outDir: resolve(options["--out"]),
      rendererVersion: rendererVersion(),
    });
    for (const item of result.manifest.items)
      console.log(
        `${item.taskId}  ${item.status}${item.reason ? `  ${item.reason}` : ""}`,
      );
    for (const name of result.unknownTasks)
      console.log(`${name}  left out: no such Task in the pack`);
    for (const name of result.ignored)
      console.log(`${name}  ignored: not named <Task id>.icproj.json`);
    console.log(
      `\nWrote ${result.bundle}: ${Object.entries(result.counts)
        .map(([status, count]) => `${count} ${status}`)
        .join(", ")}.`,
    );
    return 0;
  }
  const listText = readText(options["--list"]);
  const exportDir = resolve(options["--export"]);
  const splitText = options["--split"]
    ? readText(options["--split"])
    : undefined;
  if (command === "check") {
    const { report } = await season.checkSeason({
      listText,
      exportDir,
      splitText,
    });
    process.stdout.write(season.formatReport(report));
    return report.ok ? 0 : 1;
  }
  const instructions = options["--instructions"] ?? DEFAULT_INSTRUCTIONS;
  if (!existsSync(instructions))
    throw new Error(`No instructions file at ${instructions}`);
  const report = await season.buildSeason({
    listText,
    exportDir,
    outDir: resolve(options["--out"]),
    splitText,
    season: options["--season"] ?? "S1",
    instructions: readText(instructions),
    date: options["--date"] ?? new Date().toISOString().slice(0, 10),
    rendererVersion: rendererVersion(),
  });
  process.stdout.write(season.formatReport(report));
  console.log(
    report.status === "built"
      ? `\nBuilt the Season in ${resolve(options["--out"])}.`
      : "\nBlocked: nothing was built. Resolve the problems above and run again.",
  );
  return report.status === "built" ? 0 : 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
