#!/usr/bin/env node
// Download public Gallery circuits, community and reference datasets, with
// their full Projects: every one, or those a filter or a Gallery wall link
// selects. No account, key or install: Node 18 or newer only.
// Usage policy: every public circuit is free to download, mirror and use
// (docs/specs/community-gallery.md#crawlers-ai-and-floods).
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const USAGE = `Usage: node gallery-download.mjs [OUT_DIR] [options]

Writes OUT_DIR/index.json (the selected circuits' summaries, oldest first)
and OUT_DIR/entries/<id>.json ({entry, projectText}). OUT_DIR defaults to
gallery-download. Without a filter, every public circuit.

  --source KEY       one reference dataset (keys: GET /api/gallery/sources),
                     or community for the community's circuits alone
  --q TEXT           words in a name, byline, description or tag
  --tags A,B         any of these tags
  --author NAME      one byline
  --parts 0-5,6-10   any of these sizes in parts
  --netlistable 1|0  only circuits that extract to a netlist, or that do not
  --url LINK         the filters of a Gallery wall link; flags override it
  --max N            at most N circuits
  --base URL         the site; default the --url link's, else
                     https://analog-canvas.tokenzhang.com

A rerun keeps a circuit already on disk only if its file is whole, and
downloads the rest. It ends with counts and exits 1 if any circuit failed.`;

const DEFAULT_BASE = "https://analog-canvas.tokenzhang.com";

export class UsageError extends Error {}

/** A wall link's parameter, by the name the list API reads it under. */
const WALL_TO_API = {
  source: "source",
  q: "q",
  tags: "tags",
  author: "author",
  owner: "owner",
  parts: "parts",
  netlist: "netlistable",
  reference: "reference",
  ai: "ai",
};

/**
 * The list filters a Gallery wall link selects (apps/editor/src/
 * gallery-filters.ts), named as GET /api/gallery reads them. A link to a
 * signed-in reader's own slice cannot be read signed out, so it is refused.
 */
export function wallLinkParams(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new UsageError(`--url: not a link: ${link}`);
  }
  const { searchParams } = url;
  if (searchParams.get("view") === "shelf")
    throw new UsageError("--url: a shelf is private; give a Gallery wall link");
  for (const name of ["liked", "attention"])
    if (searchParams.get(name) === "1")
      throw new UsageError(
        `--url: ${name}=1 narrows to a signed-in reader's circuits; this script reads signed out`,
      );
  const params = new URLSearchParams();
  for (const [wall, api] of Object.entries(WALL_TO_API)) {
    const value = searchParams.get(wall)?.trim();
    if (value) params.set(api, value);
  }
  // An account narrows by its id; its byline then only labels the wall.
  if (params.has("owner")) params.delete("author");
  return params;
}

/** Arguments to what to download, where and from where. */
export function parseArgs(argv) {
  const args = [...argv];
  const option = (name) => {
    const at = args.indexOf(name);
    if (at < 0) return undefined;
    const value = args[at + 1];
    if (value === undefined || value.startsWith("--"))
      throw new UsageError(`${name} needs a value`);
    args.splice(at, 2);
    return value;
  };
  const link = option("--url");
  const params = link ? wallLinkParams(link) : new URLSearchParams();
  for (const name of [
    "source",
    "q",
    "tags",
    "author",
    "parts",
    "netlistable",
  ]) {
    const value = option(`--${name}`)?.trim();
    if (value) params.set(name, value);
  }
  if (params.has("netlistable") && !/^[01]$/u.test(params.get("netlistable")))
    throw new UsageError("--netlistable takes 1 or 0");
  if (
    params.has("parts") &&
    !/^\d{1,4}-\d{0,4}(,\d{1,4}-\d{0,4})*$/u.test(params.get("parts"))
  )
    throw new UsageError("--parts takes sizes such as 0-5,6-10,26-");
  const maxText = option("--max");
  const max = maxText === undefined ? Infinity : Number(maxText);
  if (!(max > 0)) throw new UsageError("--max takes a positive number");
  const base = (
    option("--base") ?? (link ? new URL(link).origin : DEFAULT_BASE)
  ).replace(/\/+$/u, "");
  const unknown = args.find((arg) => arg.startsWith("-"));
  if (unknown) throw new UsageError(`unknown option ${unknown}`);
  if (args.length > 1) throw new UsageError("one OUT_DIR at most");
  return { out: args[0] ?? "gallery-download", params, max, base };
}

/** Whether a saved entry file is whole: it parses, names its id, has a Project. */
export function wholeEntry(text, id) {
  try {
    const saved = JSON.parse(text);
    return (
      saved?.entry?.id === id &&
      typeof saved.projectText === "string" &&
      saved.projectText.length > 0
    );
  } catch {
    return false;
  }
}

/** Write a file whole or not at all: a temporary file, then a rename. */
function writeWhole(file, text) {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
}

class RequestError extends Error {}

// The site allows 1200 /api requests a minute per client; stay at half.
const SPACING_MS = 100;

/** GETs spaced SPACING_MS apart; network, 408, 429 and 5xx are retried. */
function reader(base) {
  let nextStart = 0;
  return async function get(path) {
    for (let attempt = 1; ; attempt++) {
      const wait = nextStart - Date.now();
      nextStart = Math.max(nextStart, Date.now()) + SPACING_MS;
      if (wait > 0) await new Promise((done) => setTimeout(done, wait));
      const response = await fetch(base + path).catch(() => null);
      const text = response ? await response.text().catch(() => null) : null;
      if (response?.ok && text !== null) {
        try {
          return JSON.parse(text);
        } catch {
          // An unreadable reply is retried like a dropped one.
        }
      }
      const status = response?.status ?? 0;
      const transient =
        !response ||
        response.ok ||
        [408, 429].includes(status) ||
        status >= 500;
      if (!transient || attempt === 5)
        throw new RequestError(
          `${path}: ${
            !response
              ? "network error"
              : response.ok
                ? "unreadable reply"
                : `${status} ${(text ?? "").trim().slice(0, 300)}`
          }`,
        );
      const retryAfter = Number(response?.headers.get("retry-after"));
      await new Promise((done) =>
        setTimeout(done, (retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000),
      );
    }
  };
}

export async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  const { out, params, max, base } = options;
  const get = reader(base);

  // A dataset key the site does not know would be no filter at all on an
  // older server (#2149), so it is checked against the site's own list.
  const source = params.get("source");
  if (source && source !== "community") {
    const known = await get("/api/gallery/sources").catch(() => null);
    const keys = Array.isArray(known?.sources)
      ? known.sources.map((each) => each.key)
      : null;
    if (keys && !keys.includes(source)) {
      console.error(
        `Unknown --source ${source}. Datasets: ${keys.join(", ")}, or community.`,
      );
      return 1;
    }
  }

  mkdirSync(join(out, "entries"), { recursive: true });
  const index = [];
  const listed = new Set();
  let cursor = "";
  try {
    do {
      const page = new URLSearchParams(params);
      page.set("limit", "60");
      page.set("order", "oldest");
      if (cursor) page.set("cursor", cursor);
      const reply = await get(`/api/gallery?${page}`);
      for (const entry of reply.entries ?? [])
        if (!listed.has(entry.id)) {
          listed.add(entry.id);
          index.push(entry);
        }
      cursor = typeof reply.nextCursor === "string" ? reply.nextCursor : "";
      process.stdout.write(`\rlisted ${index.length}`);
    } while (cursor && index.length < max);
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    console.error(`\nThe list failed: ${error.message}`);
    return 1;
  }
  index.length = Math.min(index.length, max);
  writeWhole(join(out, "index.json"), JSON.stringify(index));
  console.log();

  let downloaded = 0;
  let skipped = 0;
  const failed = [];
  const queue = index.map((entry) => entry.id);
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let id; (id = queue.shift());) {
        try {
          if (!/^[\w-]+$/u.test(id)) throw new Error("unexpected id");
          const file = join(out, "entries", `${id}.json`);
          if (existsSync(file) && wholeEntry(readFileSync(file, "utf8"), id)) {
            skipped++;
          } else {
            const { entry, projectText } = await get(`/api/gallery/${id}`);
            const text = JSON.stringify({ entry, projectText });
            if (!wholeEntry(text, id))
              throw new Error("reply without its Project");
            writeWhole(file, text);
            downloaded++;
          }
        } catch (error) {
          failed.push({ id, reason: error.message });
        }
        process.stdout.write(
          `\rread ${downloaded + skipped + failed.length} / ${index.length}`,
        );
      }
    }),
  );
  console.log(
    `\n${index.length} ${index.length === 1 ? "circuit" : "circuits"} in ${out}: ${downloaded} downloaded, ${skipped} already on disk, ${failed.length} failed`,
  );
  for (const { id, reason } of failed.slice(0, 20))
    console.error(`failed ${id}: ${reason}`);
  if (failed.length > 20) console.error(`…and ${failed.length - 20} more`);
  return failed.length > 0 ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  process.exitCode = await main(process.argv.slice(2));
