// Keep the assets of recent deploys online beside this build's.
//
// Asset names carry a content hash, and a deploy uploads only its own build,
// so a tab opened before it asks for files that are gone the first time it
// needs one: a dialog, the Insert panel, a save's confirmation. That showed
// as "could not save, then it crashed" for people drawing across one of the
// day's many deploys (2026-10-13). Each deploy therefore publishes
// /asset-history.json, every asset with the last time a deploy served it,
// and the next deploy downloads the ones served within KEEP_DAYS that its
// own build no longer has, so they upload again with it. Nothing here may
// fail a deploy: a missing history or an unreachable file is only reported.
//
//   node scripts/retain-previous-assets.mjs <dist> <live-origin>

import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { eachConcurrently } from "./lib/each-concurrently.mjs";

export const KEEP_DAYS = 7;
const KEEP_MS = KEEP_DAYS * 86_400_000;
/**
 * With this build and its brotli siblings (only this build's assets get one),
 * still far below the platform's per-version file limit.
 */
export const MAX_RETAINED_FILES = 6000;
export const HISTORY_FILE = "asset-history.json";
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * Which earlier assets to carry, and the history this deploy publishes.
 * `previous` maps asset names to when a deploy last served them; `current`
 * lists this build's. Unsafe names and stale or unparseable times drop out.
 */
export function planAssetRetention({
  previous,
  current,
  now,
  keepMs = KEEP_MS,
  maxFiles = MAX_RETAINED_FILES,
}) {
  const own = new Set(current);
  const stamp = new Date(now).toISOString();
  const carried = Object.entries(previous ?? {})
    .filter(([name, at]) => {
      if (own.has(name) || !ASSET_NAME.test(name)) return false;
      const time = Date.parse(String(at));
      return Number.isFinite(time) && now - time <= keepMs && time <= now;
    })
    .sort((left, right) => Date.parse(right[1]) - Date.parse(left[1]))
    .slice(0, maxFiles);
  return {
    retain: carried.map(([name, at]) => ({ name, at: String(at) })),
    history: {
      version: 1,
      assets: Object.fromEntries([
        ...carried,
        ...current.map((name) => [name, stamp]),
      ]),
    },
  };
}

/** The live deploy's history, or nothing when it has none to give. */
async function readHistory(origin, fetchLike) {
  try {
    const response = await fetchLike(`${origin}/${HISTORY_FILE}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.version === 1 && body.assets && typeof body.assets === "object"
      ? body.assets
      : null;
  } catch {
    return null;
  }
}

async function download(origin, name, target, fetchLike) {
  const response = await fetchLike(`${origin}/assets/${name}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if ((response.headers.get("content-type") ?? "").startsWith("text/html"))
    throw new Error("answered with the shell");
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

export async function retainPreviousAssets(
  dist,
  origin,
  { fetchLike = fetch, now = Date.now(), log = console.log } = {},
) {
  const assets = join(dist, "assets");
  await mkdir(assets, { recursive: true });
  const current = (await readdir(assets, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const previous = await readHistory(origin, fetchLike);
  if (!previous) log(`No asset history at ${origin}; this deploy starts one.`);
  const plan = planAssetRetention({ previous, current, now });
  const failed = [];
  let bytes = 0;
  await eachConcurrently(plan.retain, 8, async (item) => {
    const target = join(assets, item.name);
    try {
      await download(origin, item.name, target, fetchLike);
      bytes += (await stat(target)).size;
    } catch (error) {
      failed.push(item.name);
      log(`Could not keep ${item.name}: ${error.message}`);
    }
  });
  for (const name of failed) delete plan.history.assets[name];
  await writeFile(
    join(dist, HISTORY_FILE),
    `${JSON.stringify(plan.history)}\n`,
  );
  log(
    `Kept ${plan.retain.length - failed.length} earlier assets (${bytes} bytes) beside ${current.length} of this build; ${failed.length} could not be fetched.`,
  );
  return { kept: plan.retain.length - failed.length, failed, current };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [dist, origin] = process.argv.slice(2);
  if (!dist || !origin) {
    console.error(
      "usage: node scripts/retain-previous-assets.mjs <dist> <live-origin>",
    );
    process.exit(2);
  }
  await retainPreviousAssets(resolve(dist), origin.replace(/\/+$/u, ""));
}
