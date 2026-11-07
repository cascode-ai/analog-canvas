#!/usr/bin/env node
// Turn a draw:batch run (#1498) into import batches for a reference dataset's
// Gallery store (#1510): every accepted drawing as one entry, ten per file,
// in the body POST /api/gallery/sources/<key>/entries takes. With --post it
// also posts them with the Owner token (#1769). --post-comparisons posts a
// dataset's comparisons (original figure and verdict) the same way.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BATCH = 10;
/** Entries one request carries when posting. */
const POST_BATCH = 3;
const POST_RETRIES = 3;
const NAME_LIMIT = 120;
const PROJECT_LIMIT = 2 * 1024 * 1024;
export const DEFAULT_ORIGIN = "https://analog-canvas.tokenzhang.com";
const TOKEN_ENV = "ANALOG_CANVAS_OWNER_TOKEN";
const USAGE = `usage: node scripts/gallery-import-batches.mjs RUN_DIR --source KEY [--out DIR] [--manifest TASKS.jsonl] [--include-suspect] [--post] [--origin URL]
       node scripts/gallery-import-batches.mjs --post-dir DIR --source KEY [--origin URL]
       node scripts/gallery-import-batches.mjs --post-comparisons FILE.jsonl --source KEY [--origin URL]

Writes DIR/KEY-0001.json, … (default DIR: RUN_DIR/gallery-import), each
{"entries": [...]} with at most ${BATCH} accepted drawings, and lists what
it left out and why. --include-suspect also takes drawings accepted because
two redraws agreed against the dataset's netlist.

--post then posts them, ${POST_BATCH} entries a request, to --origin (default
${DEFAULT_ORIGIN}; https://, or http:// to localhost, 127.0.0.1 or [::1]);
--post-dir posts the batch files already in DIR; --post-comparisons posts
a JSON-lines file of comparisons, one a line, to …/comparisons (datasets
with comparisons only). The Owner token comes from
${TOKEN_ENV}, else ~/.config/analog-canvas/owner-token. Dropped connections
and 5xx are retried; a 401 or 403 stops the run. It prints posted and failed
counts and failed ids, and exits non-zero if anything failed.`;

export function parseArguments(argv) {
  const options = { includeSuspect: false, post: false };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--include-suspect") options.includeSuspect = true;
    else if (argument === "--post") options.post = true;
    else if (
      [
        "--source",
        "--out",
        "--manifest",
        "--origin",
        "--post-dir",
        "--post-comparisons",
      ].includes(argument)
    ) {
      const value = argv[(index += 1)];
      if (!value) throw new Error(`${argument} takes a value`);
      options[
        argument === "--post-dir"
          ? "postDir"
          : argument === "--post-comparisons"
            ? "comparisons"
            : argument.slice(2)
      ] = value;
    } else if (argument.startsWith("--"))
      throw new Error(`Unknown option ${argument}`);
    else rest.push(argument);
  }
  const postsOnly = Boolean(options.postDir || options.comparisons);
  if (!options.source || rest.length !== (postsOnly ? 0 : 1))
    throw new Error(USAGE);
  if (options.origin) options.origin = postOrigin(options.origin);
  if (postsOnly) return { ...options, post: true };
  return { ...options, run: rest[0] };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The origin the token may go to: https, or plain http to this machine
 * only, so the token never crosses the network in the clear.
 */
export function postOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`--origin ${value} is not a URL`);
  }
  if (
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
  )
    return url.origin;
  throw new Error(
    `--origin ${value} must be https:// (or http:// to localhost, 127.0.0.1 or [::1])`,
  );
}

/** The Owner token: the environment's, else the per-machine file's. */
export function ownerToken(env = process.env, home = homedir()) {
  const fromEnv = env[TOKEN_ENV]?.trim();
  if (fromEnv) return fromEnv;
  const file = join(home, ".config/analog-canvas/owner-token");
  const fromFile = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  if (fromFile) return fromFile;
  throw new Error(
    `No Owner token: set ${TOKEN_ENV} or write it to ${file} (mint one with POST /api/auth/owner-tokens).`,
  );
}

/** The batch files a directory holds, in name order. */
export function batchFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && name !== "left-out.json")
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Post every entry of the batch files, POST_BATCH a request. A dropped
 * connection or a 5xx is retried with backoff; a 401 or 403 (a missing,
 * wrong or revoked token, or not the Owner's) stops the run; anything else
 * is that request's answer. Returns how many went in, which did not and
 * why, and, when stopped, the refusal and how many were never sent.
 */
export async function postBatches({
  files = [],
  items,
  kind = "entries",
  source,
  origin = DEFAULT_ORIGIN,
  token,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  log = () => {},
}) {
  const entries =
    items ??
    files.flatMap(
      (file) => JSON.parse(readFileSync(file, "utf8")).entries ?? [],
    );
  const url = `${origin.replace(/\/+$/u, "")}/api/gallery/sources/${encodeURIComponent(source)}/${kind}`;
  let posted = 0;
  const failed = [];
  for (let index = 0; index < entries.length; index += POST_BATCH) {
    const chunk = entries.slice(index, index + POST_BATCH);
    let answer = null;
    let error = "";
    let status = 0;
    for (let attempt = 0; attempt <= POST_RETRIES; attempt += 1) {
      if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ [kind]: chunk }),
        });
        if (response.ok) {
          answer = await response.json();
          break;
        }
        status = response.status;
        error = `http-${status}`;
        if (status < 500) break;
      } catch (thrown) {
        error = thrown instanceof Error ? thrown.message : String(thrown);
      }
    }
    const results = new Map(
      (answer?.results ?? []).map((result) => [result.id, result]),
    );
    for (const { id } of chunk) {
      const result = results.get(id);
      if (result?.ok) posted += 1;
      else
        failed.push({
          id,
          error: answer ? (result?.error ?? "no-result") : error,
        });
    }
    if (status === 401 || status === 403)
      return {
        posted,
        failed,
        stopped: { error, unsent: entries.length - index - chunk.length },
      };
    log(`${Math.min(index + POST_BATCH, entries.length)}/${entries.length}`);
  }
  return { posted, failed };
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

/** The command: write the batches, post them if asked; the exit code. */
export async function main(
  argv,
  {
    root = resolve(import.meta.dirname, ".."),
    env = process.env,
    home = homedir(),
    fetchImpl = fetch,
    sleep,
    log = console.log,
  } = {},
) {
  if (argv.includes("--help") || argv.includes("-h")) {
    log(USAGE);
    return 0;
  }
  const options = parseArguments(argv);
  let files;
  let items;
  if (options.comparisons) {
    if (!datasetSource(root, options.source).comparisons)
      throw new Error(`${options.source} takes no comparisons`);
    items = readFileSync(resolve(options.comparisons), "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } else if (options.postDir) {
    datasetSource(root, options.source);
    files = batchFiles(resolve(options.postDir));
  } else {
    const result = importBatches(options, root);
    files = result.files;
    log(
      `${result.entries} drawings in ${result.files.length} files for ${result.source}; ${result.left.length} left out (left-out.json).` +
        (options.post
          ? ""
          : `\nPost them with --post (or --post-dir ${resolve(options.out ?? join(options.run, "gallery-import"))}).`),
    );
  }
  if (!options.post) return 0;
  const { posted, failed, stopped } = await postBatches({
    files,
    ...(items ? { items, kind: "comparisons" } : {}),
    source: options.source,
    origin: options.origin ?? DEFAULT_ORIGIN,
    token: ownerToken(env, home),
    fetchImpl,
    ...(sleep ? { sleep } : {}),
    log: (progress) => log(`posted ${progress}`),
  });
  log(`${posted} posted, ${failed.length} failed.`);
  for (const { id, error } of failed) log(`failed ${id}: ${error}`);
  if (stopped)
    log(
      `Stopped at ${stopped.error}: the Owner token is missing, wrong or revoked, or its account is not the Owner's; ${stopped.unsent} entries not sent.`,
    );
  return failed.length > 0 || stopped ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
