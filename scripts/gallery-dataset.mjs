#!/usr/bin/env node
// Build, or bring up to date, a local dataset of every public Gallery
// circuit: its figure, our drawing, and every netlist we can export from it,
// SPICE and Spectre side by side for the saved Process and each open one.
//
//   node scripts/gallery-dataset.mjs [DIR] [--base URL] [--workers N] [--full]
//                                    [--bundle PATH] [--only ID,ID]
//
// DIR defaults to $ANALOG_CANVAS_DATA/gallery, else
// ~/Documents/analog-canvas-data/gallery. It holds
//   index.json     every circuit, oldest first
//   sources.json   the reference datasets
//   snapshot.json  when it was read, from where, with which export engine
//   circuits/<id>/
//     meta.json        the wall entry, its link, and a dataset's comparison
//     schematic.svg    our drawing, as the Gallery shows it, its text faces embedded
//     reference.<ext>  the author's reference image, when there is one
//     figure.<ext>     a reference dataset's original figure
//     source.sp        that dataset's own netlist, verbatim (absent when it has none)
//     netlists/<variant>.sp and .scs, one pair per variant: `saved` (the
//         drawing in its own Process, as the Netlist panel shows it with its
//         missing defaults filled) and each open Process; a pair is absent
//         when that export is blocked
//     netlists/diagnostics.json  why an export is blocked and what it warned
//
// The first run reads everything. Later runs read each store's change feed
// from where the last one stopped, so only new, edited and withdrawn
// circuits are fetched again. Every netlist is exported again when the
// engine changed or with --full, since an export rule can change while
// Projects stay put. Netlists come from the headless engine of this checkout
// (output/headless, built when missing), not from the site.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const BASE = "https://analog-canvas.tokenzhang.com";
const DEFAULT_BUNDLE = resolve(
  root,
  "output/headless/analog-canvas-headless.mjs",
);
const FORMATS = [
  ["spice", "sp"],
  ["spectre", "scs"],
];
const EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const USAGE = `Usage: node scripts/gallery-dataset.mjs [DIR] [--base URL] [--workers N] [--full] [--bundle PATH] [--only ID,ID]

--only reads just those circuits and records no progress.
DIR defaults to $ANALOG_CANVAS_DATA/gallery, else ~/Documents/analog-canvas-data/gallery.`;

export class UsageError extends Error {}

export function defaultDir(env = process.env) {
  return join(
    env.ANALOG_CANVAS_DATA ??
      join(homedir(), "Documents", "analog-canvas-data"),
    "gallery",
  );
}

export function parseArgs(argv, env = process.env) {
  const options = {
    dir: defaultDir(env),
    base: BASE,
    workers: 32,
    full: false,
    bundle: undefined,
    only: undefined,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new UsageError(`${arg} needs a value`);
      return next;
    };
    if (arg === "--help" || arg === "-h") throw new UsageError(USAGE);
    else if (arg === "--base") options.base = value().replace(/\/+$/u, "");
    else if (arg === "--workers") {
      options.workers = Number(value());
      if (!Number.isInteger(options.workers) || options.workers < 1)
        throw new UsageError("--workers takes a whole number above 0");
    } else if (arg === "--full") options.full = true;
    else if (arg === "--bundle") options.bundle = resolve(value());
    else if (arg === "--only")
      options.only = new Set(value().split(",").filter(Boolean));
    else if (arg.startsWith("--"))
      throw new UsageError(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 1) throw new UsageError(USAGE);
  if (positional[0]) options.dir = resolve(positional[0]);
  return options;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** GET with retries on network errors, 408, 429 and 5xx; null on 404. */
async function get(base, path, binary = false) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    let wait = 2 ** attempt;
    try {
      const response = await fetch(base + path, {
        headers: { "user-agent": "gallery-dataset" },
        signal: AbortSignal.timeout(120_000),
      });
      if (response.status === 404) return null;
      if (response.ok) {
        if (!binary) return await response.json();
        return {
          body: Buffer.from(await response.arrayBuffer()),
          type: response.headers.get("content-type") ?? "",
        };
      }
      if (
        response.status !== 408 &&
        response.status !== 429 &&
        response.status < 500
      )
        throw new Error(`${path}: HTTP ${response.status}`);
      wait = Number(response.headers.get("retry-after")) || wait;
    } catch (error) {
      if (error instanceof Error && error.message.includes(": HTTP "))
        throw error;
    }
    await sleep(Math.min(wait, 60) * 1000);
  }
  throw new Error(`${path}: failed after retries`);
}

/** Written beside the file and renamed over it, so no reader sees half. */
function write(path, data) {
  writeFileSync(`${path}.tmp`, data);
  renameSync(`${path}.tmp`, path);
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function pages(base, path, params, cursorParam) {
  const items = [];
  let cursor = "";
  for (;;) {
    const query = new URLSearchParams(params);
    if (cursor) query.set(cursorParam, cursor);
    const page = (await get(base, `${path}?${query}`)) ?? {};
    items.push(...(page.entries ?? []));
    cursor = page.nextCursor ?? "";
    if (!cursor) return items;
  }
}

async function pool(items, workers, run) {
  const failed = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          await run(item);
        } catch (error) {
          failed.push([
            item.id,
            error instanceof Error ? error.message : String(error),
          ]);
        }
      }
    }),
  );
  return failed;
}

async function loadHeadless(bundle) {
  const path = bundle ?? DEFAULT_BUNDLE;
  if (!existsSync(path)) {
    if (bundle) throw new UsageError(`No headless bundle at ${bundle}`);
    execFileSync(
      process.execPath,
      [join(root, "scripts/package-headless.mjs")],
      {
        stdio: "inherit",
      },
    );
  }
  const engine = createHash("sha256").update(readFileSync(path)).digest("hex");
  return { headless: await import(pathToFileURL(path).href), engine };
}

/**
 * Every netlist of one Project, by file name under netlists/, and what each
 * export reported. A blocked export writes no file.
 */
export function exportNetlists(headless, projectText) {
  const project = headless.parseProject(projectText);
  const processes = headless.NETLIST_PROFILE_IDS.filter(
    (id) => id !== "custom",
  );
  const files = {};
  const diagnostics = {};
  for (const variant of ["saved", ...processes]) {
    for (const [format, ext] of FORMATS) {
      const name = `${variant}.${ext}`;
      let result;
      try {
        result =
          variant === "saved"
            ? headless.savedWorkspaceNetlist(project, format)
            : headless.workspaceNetlist(project, format, variant);
      } catch (error) {
        result = {
          status: "blocked",
          messages: [error instanceof Error ? error.message : String(error)],
          warnings: [],
        };
      }
      if (result.status === "ready")
        files[name] = result.text.replace(/^\n+/u, "");
      const warnings = result.warnings ?? [];
      if (result.status !== "ready" || warnings.length)
        diagnostics[name] = {
          status: result.status,
          ...(result.messages.length ? { errors: result.messages } : {}),
          ...(warnings.length ? { warnings } : {}),
        };
    }
  }
  return { files, diagnostics };
}

function replaceNetlists(dir, { files, diagnostics }) {
  const netlists = join(dir, "netlists");
  rmSync(netlists, { recursive: true, force: true });
  mkdirSync(netlists, { recursive: true });
  for (const [name, text] of Object.entries(files))
    write(join(netlists, name), text);
  if (Object.keys(diagnostics).length)
    write(join(netlists, "diagnostics.json"), json(diagnostics));
}

/** Replace a `<stem>.<ext>` file, dropping any other extension it had. */
function replaceImage(dir, stem, got) {
  for (const file of readdirSync(dir))
    if (file.startsWith(`${stem}.`)) rmSync(join(dir, file));
  const ext = EXT[got.type.split(";")[0].trim()] ?? "bin";
  write(join(dir, `${stem}.${ext}`), got.body);
}

export async function run(options, log = console.log) {
  const { dir, base, workers } = options;
  const started = new Date();
  const { headless, engine } = await loadHeadless(options.bundle);
  const circuitsDir = join(dir, "circuits");
  mkdirSync(circuitsDir, { recursive: true });

  const prior = JSON.parse(readText(join(dir, "snapshot.json")) ?? "{}");
  const sources = (await get(base, "/api/gallery/sources"))?.sources ?? [];
  const stores = ["community", ...sources.map((source) => source.key)];
  write(join(dir, "sources.json"), json(sources));

  const statePath = join(dir, ".changes.json");
  const state = JSON.parse(readText(statePath) ?? "{}");
  const latest = async (key) => {
    const page = await get(
      base,
      `/api/gallery/maintenance/changes?source=${encodeURIComponent(key)}&after=${10 ** 15}&limit=1`,
    );
    return page && "changes" in page ? page.latest : null;
  };
  const heads = Object.fromEntries(
    await Promise.all(stores.map(async (key) => [key, await latest(key)])),
  );
  // Every circuit is read again when asked for, when a store was never
  // read or has no change feed, or when the site is another one.
  const full =
    options.full ||
    prior.origin !== base ||
    stores.some((key) => heads[key] == null || !(key in state));
  // Every netlist is exported again when the engine changed.
  const reexport = full || prior.engine !== engine;

  const comparisonsOf = async (key) =>
    (
      (await get(
        base,
        `/api/gallery/sources/${encodeURIComponent(key)}/comparisons`,
      )) ?? {}
    ).comparisons ?? [];
  const comparisons = new Map();
  for (const source of sources)
    for (const comparison of await comparisonsOf(source.key))
      comparisons.set(comparison.id, { ...comparison, source: source.key });

  const indexPath = join(dir, "index.json");
  let entries;
  let changed;
  if (full) {
    const walls = await Promise.all(
      stores.map((key) =>
        pages(
          base,
          "/api/gallery",
          { limit: "60", order: "oldest", source: key },
          "cursor",
        ),
      ),
    );
    const seen = new Set();
    entries = walls
      .flat()
      .filter((entry) => !seen.has(entry.id) && seen.add(entry.id));
    changed = new Set(seen);
  } else {
    const byId = new Map(
      JSON.parse(readText(indexPath) ?? "[]").map((entry) => [entry.id, entry]),
    );
    changed = new Set();
    for (const key of stores) {
      let after = state[key];
      for (;;) {
        const page =
          (await get(
            base,
            `/api/gallery/maintenance/changes?source=${encodeURIComponent(key)}&after=${after}`,
          )) ?? {};
        for (const change of page.changes ?? []) {
          changed.add(change.id);
          if (change.removed) byId.delete(change.id);
          else byId.set(change.id, change.entry);
        }
        after = page.nextCursor;
        if (!after) break;
      }
    }
    entries = [...byId.values()].sort(
      (a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
        a.id.localeCompare(b.id),
    );
  }
  const live = new Set(entries.map((entry) => entry.id));
  const gone = options.only
    ? []
    : readdirSync(circuitsDir).filter((id) => !live.has(id));
  for (const id of gone)
    rmSync(join(circuitsDir, id), { recursive: true, force: true });

  const figureStale = (id) => {
    const comparison = comparisons.get(id);
    return (
      comparison?.figureRevision &&
      readText(join(circuitsDir, id, ".figure-revision")) !==
        comparison.figureRevision
    );
  };
  const todo = entries.filter(
    (entry) =>
      (!options.only || options.only.has(entry.id)) &&
      (reexport ||
        changed.has(entry.id) ||
        figureStale(entry.id) ||
        !existsSync(join(circuitsDir, entry.id, "meta.json"))),
  );
  log(
    `${entries.length} circuits, ${todo.length} to read${full ? " (full pass)" : ""}${
      reexport ? ", every netlist exported again" : ""
    }, ${gone.length} removed`,
  );

  const stats = { netlists: 0, previews: 0, figures: 0, references: 0 };
  let done = 0;
  const failed = await pool(todo, workers, async (entry) => {
    const id = entry.id;
    const d = join(circuitsDir, id);
    mkdirSync(d, { recursive: true });
    const q = encodeURIComponent(id);

    const project = await get(base, `/api/gallery/${q}?download=1`);
    if (!project?.projectText) throw new Error("reply without its Project");
    const revision = createHash("sha256")
      .update(project.projectText)
      .digest("hex");
    if (reexport || readText(join(d, ".project-revision")) !== revision) {
      replaceNetlists(d, exportNetlists(headless, project.projectText));
      write(join(d, ".project-revision"), revision);
      stats.netlists += 1;
    }

    const svg = join(d, "schematic.svg");
    const preview = entry.previewRevision ?? "";
    if (
      reexport ||
      !existsSync(svg) ||
      readText(join(d, ".preview-revision")) !== preview
    ) {
      const got = await get(
        base,
        `/api/gallery/${q}/preview.svg?v=${encodeURIComponent(preview)}&render=formula-label-v5`,
        true,
      );
      if (got) {
        // The site's preview names its faces; embedded, it draws the same
        // everywhere (#2427).
        write(
          svg,
          await headless.embedFormalSvgFontsHeadless(got.body.toString("utf8")),
        );
        write(join(d, ".preview-revision"), preview);
        stats.previews += 1;
      }
    }

    const referenceMarker = join(d, ".reference-revision");
    if (entry.hasReference) {
      const want = entry.referenceRevision ?? "";
      const have = readdirSync(d).some((file) => file.startsWith("reference."));
      if (!have || readText(referenceMarker) !== want) {
        const got = await get(base, `/api/gallery/${q}/reference`, true);
        if (got) {
          replaceImage(d, "reference", got);
          write(referenceMarker, want);
          stats.references += 1;
        }
      }
    } else {
      for (const file of readdirSync(d))
        if (file.startsWith("reference.") || file === ".reference-revision")
          rmSync(join(d, file));
    }

    const comparison = comparisons.get(id);
    if (comparison?.figureRevision && figureStale(id)) {
      const key = encodeURIComponent(comparison.source);
      const got = await get(
        base,
        `/api/gallery/sources/${key}/comparisons/${q}/figure?v=${encodeURIComponent(comparison.figureRevision)}`,
        true,
      );
      if (got) {
        replaceImage(d, "figure", got);
        stats.figures += 1;
      }
      const text =
        (await get(base, `/api/gallery/sources/${key}/comparisons/${q}`))
          ?.sourceNetlist ?? "";
      rmSync(join(d, "source.sp"), { force: true });
      if (text) write(join(d, "source.sp"), text);
      write(join(d, ".figure-revision"), comparison.figureRevision);
    }

    const { likedByViewer: _viewer, ...meta } = entry;
    write(
      join(d, "meta.json"),
      json({
        ...meta,
        url: `${base}/g/${id}`,
        ...(comparison
          ? {
              dataset: Object.fromEntries(
                [
                  "source",
                  "verdict",
                  "category",
                  "detail",
                  "reason",
                  "families",
                ].map((key) => [key, comparison[key] ?? null]),
              ),
            }
          : {}),
      }),
    );
    done += 1;
    if (done % 200 === 0) log(`read ${done} / ${todo.length}`);
  });

  // A partial run (--only, or with failures) records no progress, so the
  // next one reads what it missed.
  const partial = failed.length > 0 || Boolean(options.only);
  write(indexPath, JSON.stringify(entries));
  if (!partial && stores.every((key) => heads[key] != null))
    write(statePath, JSON.stringify(heads));
  write(
    join(dir, "snapshot.json"),
    json({
      origin: base,
      startedAt: started.toISOString(),
      endedAt: new Date().toISOString(),
      // A failed run keeps the old engine, so its circuits export again.
      engine: partial ? (prior.engine ?? null) : engine,
      circuits: entries.length,
      variants: [
        "saved",
        ...headless.NETLIST_PROFILE_IDS.filter((id) => id !== "custom"),
      ],
      formats: FORMATS.map(([format]) => format),
    }),
  );
  log(
    `${entries.length} circuits in ${dir}: ${todo.length - failed.length} read, ${gone.length} removed, ${stats.netlists} exported, ${stats.previews} drawings, ${stats.figures} figures, ${stats.references} reference images, ${failed.length} failed`,
  );
  for (const [id, why] of failed.slice(0, 20))
    console.error(`failed ${id}: ${why}`);
  return failed.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    process.exitCode = error.message === USAGE ? 0 : 2;
  }
}
