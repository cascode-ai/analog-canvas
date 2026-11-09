#!/usr/bin/env node
// Download every public Gallery circuit, community and reference datasets,
// with its full Project. No account, key or install: Node 18 or newer only.
// Usage policy: every public circuit is free to download, mirror and use
// (docs/specs/community-gallery.md#crawlers-ai-and-floods).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const USAGE = `Usage: node scripts/gallery-download.mjs [OUT_DIR] [--max N] [--base URL]

Writes OUT_DIR/index.json (every entry's summary, oldest first) and
OUT_DIR/entries/<id>.json ({entry, projectText}). OUT_DIR defaults to
gallery-download. A rerun skips circuits already on disk.`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
const option = (name, fallback) => {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const value = args[at + 1];
  args.splice(at, 2);
  return value;
};
const max = Number(option("--max", Infinity));
const base = option("--base", "https://analog-canvas.tokenzhang.com").replace(
  /\/+$/u,
  "",
);
const out = args[0] ?? "gallery-download";
if (!(max > 0) || args.length > 1) {
  console.error(USAGE);
  process.exit(2);
}

// The site allows 1200 /api requests a minute per client; stay at half.
const SPACING_MS = 100;
let nextStart = 0;
async function get(path) {
  for (let attempt = 1; ; attempt++) {
    const wait = nextStart - Date.now();
    nextStart = Math.max(nextStart, Date.now()) + SPACING_MS;
    if (wait > 0) await new Promise((done) => setTimeout(done, wait));
    const response = await fetch(base + path).catch(() => null);
    if (response?.ok) return response.json();
    if (attempt === 5)
      throw new Error(`${path}: ${response?.status ?? "network error"}`);
    const retryAfter = Number(response?.headers.get("retry-after"));
    await new Promise((done) =>
      setTimeout(done, (retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000),
    );
  }
}

mkdirSync(join(out, "entries"), { recursive: true });

const index = [];
let cursor = "";
do {
  const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  const page = await get(`/api/gallery?limit=60&order=oldest${query}`);
  index.push(...page.entries);
  cursor = page.nextCursor;
  process.stdout.write(`\rlisted ${index.length}`);
} while (cursor && index.length < max);
index.length = Math.min(index.length, max);
writeFileSync(join(out, "index.json"), JSON.stringify(index));
console.log();

let done = 0;
const queue = index.map((entry) => entry.id);
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let id; (id = queue.shift());) {
      if (!/^[\w-]+$/u.test(id)) throw new Error(`unexpected id ${id}`);
      const file = join(out, "entries", `${id}.json`);
      if (!existsSync(file)) {
        const { entry, projectText } = await get(`/api/gallery/${id}`);
        writeFileSync(file, JSON.stringify({ entry, projectText }));
      }
      process.stdout.write(`\rdownloaded ${++done} / ${index.length}`);
    }
  }),
);
console.log(`\n${index.length} circuits in ${out}`);
