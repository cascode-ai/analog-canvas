#!/usr/bin/env node
// Turn a draw:batch run (#1498) into import batches for a reference dataset's
// Gallery store (#1510): every accepted drawing as one entry, ten per file,
// in the body POST /api/gallery/sources/<key>/entries takes. Posting them is
// the Owner's, from a signed-in Gallery page; this script only writes files.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BATCH = 10;
const NAME_LIMIT = 120;
const PROJECT_LIMIT = 2 * 1024 * 1024;
const USAGE = `usage: node scripts/gallery-import-batches.mjs RUN_DIR --source KEY [--out DIR] [--manifest TASKS.jsonl] [--include-suspect]

Writes DIR/KEY-0001.json, … (default DIR: RUN_DIR/gallery-import), each
{"entries": [...]} with at most ${BATCH} accepted drawings, and lists what
it left out and why. --include-suspect also takes drawings accepted because
two redraws agreed against the dataset's netlist.`;

export function parseArguments(argv) {
  const options = { includeSuspect: false };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--include-suspect") options.includeSuspect = true;
    else if (["--source", "--out", "--manifest"].includes(argument)) {
      const value = argv[(index += 1)];
      if (!value) throw new Error(`${argument} takes a value`);
      options[argument.slice(2)] = value;
    } else if (argument.startsWith("--"))
      throw new Error(`Unknown option ${argument}`);
    else rest.push(argument);
  }
  if (rest.length !== 1 || !options.source) throw new Error(USAGE);
  return { ...options, run: rest[0] };
}

/** The dataset a source key names, from the configuration the Worker reads. */
export function datasetSource(root, key) {
  const config = JSON.parse(
    readFileSync(join(root, "config/gallery-sources.json"), "utf8"),
  );
  const source = config.sources.find((candidate) => candidate.key === key);
  if (!source)
    throw new Error(
      `No dataset source "${key}"; config/gallery-sources.json has ${config.sources.map((candidate) => candidate.key).join(", ")}`,
    );
  return source;
}

/** The Gallery id of a task: the source's prefix and the task id, made safe. */
export function entryId(prefix, taskId) {
  const safe = String(taskId)
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^[-_]+/u, "")
    .slice(0, 48);
  if (!safe)
    throw new Error(`Task id "${taskId}" has nothing usable for an id`);
  return `${prefix}-${safe}`;
}

/**
 * The drawing a verdict keeps, or why none goes in: only an accepted one,
 * and one the pipeline accepted against the dataset's own netlist only when
 * asked for.
 */
export function keptDrawing(verdict, includeSuspect) {
  if (verdict.accepted !== "first" && verdict.accepted !== "second")
    return { skip: verdict.reason ?? `not accepted (${verdict.path})` };
  if (verdict.datasetSuspect && !includeSuspect)
    return {
      skip: "two redraws agree against the dataset's netlist (--include-suspect)",
    };
  return {
    project:
      verdict.accepted === "first"
        ? "project.icproj.json"
        : "second/project.icproj.json",
  };
}

export function importBatches(options, root) {
  const run = resolve(options.run);
  const source = datasetSource(root, options.source);
  const names = new Map();
  if (options.manifest)
    for (const line of readFileSync(options.manifest, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const task = JSON.parse(line);
      if (task.name) names.set(String(task.id), String(task.name));
    }
  const entries = [];
  const left = [];
  for (const id of readdirSync(run, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()) {
    const verdictPath = join(run, id, "verdict.json");
    if (!existsSync(verdictPath)) continue;
    const verdict = JSON.parse(readFileSync(verdictPath, "utf8"));
    const kept = keptDrawing(verdict, options.includeSuspect);
    if (kept.skip) {
      left.push({ id, reason: kept.skip });
      continue;
    }
    const projectText = readFileSync(join(run, id, kept.project), "utf8");
    if (Buffer.byteLength(projectText) > PROJECT_LIMIT) {
      left.push({ id, reason: "project over the Gallery's 2 MB limit" });
      continue;
    }
    const name = (names.get(id) ?? JSON.parse(projectText).name ?? id)
      .trim()
      .slice(0, NAME_LIMIT);
    entries.push({ id: entryId(source.prefix, id), name, projectText });
  }
  const out = resolve(options.out ?? join(run, "gallery-import"));
  mkdirSync(out, { recursive: true });
  const files = [];
  for (let index = 0; index < entries.length; index += BATCH) {
    const file = join(
      out,
      `${source.key}-${String(index / BATCH + 1).padStart(4, "0")}.json`,
    );
    writeFileSync(
      file,
      `${JSON.stringify({ entries: entries.slice(index, index + BATCH) })}\n`,
    );
    files.push(file);
  }
  writeFileSync(
    join(out, "left-out.json"),
    `${JSON.stringify(left, null, 2)}\n`,
  );
  return { source: source.key, entries: entries.length, files, left };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const result = importBatches(
      parseArguments(process.argv.slice(2)),
      resolve(import.meta.dirname, ".."),
    );
    console.log(
      `${result.entries} drawings in ${result.files.length} files for ${result.source}; ${result.left.length} left out (left-out.json).\n` +
        `Post each file from a signed-in Owner Gallery page: await fetch("/api/gallery/sources/${result.source}/entries", {method: "POST", headers: {"content-type": "application/json"}, body: <file text>})`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
