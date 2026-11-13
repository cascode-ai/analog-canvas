#!/usr/bin/env node
// Adds the China runtime's release to a Production deployment candidate, so
// both regions run the same build. Run after asset retention and before the
// candidate is packaged:
//
//   node scripts/regional-release.mjs <dist> <release-sha> <work-dir>
//
// It writes dist/regional-release/<sha>/ (the regional Worker and egress
// bundles, generated workerd configuration, units, scripts, storage modules,
// the pinned MCP bundle and copies of the editor's non-hashed root files) and
// dist/regional-release/current.json. release.json maps every file of the
// installed release to its SHA-256; hashed editor assets are fetched from
// Production's own /assets/ path, everything else from the release directory.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { downloadVerifiedMcp } from "./verify-agent-manifest.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const FORMAL = join(root, "containers/canvas-cn/formal");
export const RELEASE_DIRECTORY = "regional-release";
const WRANGLER = "wrangler@4.120.1";
/** Production redirects `.html` paths; root copies carry this suffix instead. */
const ROOT_SUFFIX = ".bin";
/** Files of containers/canvas-cn/formal the host installs from a release. */
export const RELEASE_SOURCES = [
  "config.capnp",
  "artifact-storage.capnp",
  "artifact-memory-entry.mjs",
  "artifact-memory-bucket.mjs",
  "memory.mjs",
  "nginx.conf",
  "nginx-public.conf",
  "formal-backup.sh",
  "maintenance.py",
  "daily-backup.py",
  "ingress.mjs",
  "canvas-cn-release.py",
  "scheduled-tick.py",
  "sync-tick.py",
  "sync-alert.py",
  "resource-sync-tick.py",
  "analytics-sync-tick.py",
  "host_monitor.py",
  "observations.py",
  "canvas-ops-monitor.service",
  "canvas-ops-monitor.timer",
];

const slash = (path) => path.replaceAll("\\", "/");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function files(directory, base = directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path, base)));
    else if (entry.isFile()) out.push(slash(relative(base, path)));
  }
  return out.sort();
}

function run(command, args, cwd = root) {
  const windows = process.platform === "win32";
  execFileSync(
    windows ? (process.env.ComSpec ?? "cmd.exe") : command,
    windows
      ? [
          "/d",
          "/s",
          "/c",
          `"${[command, ...args].map((a) => (/[\s&()^]/.test(a) ? `"${a}"` : a)).join(" ")}"`,
        ]
      : args,
    { cwd, stdio: "inherit", windowsVerbatimArguments: windows },
  );
}

async function bundle(config, outdir, entry, target) {
  await rm(outdir, { recursive: true, force: true });
  run("pnpm", [
    "dlx",
    WRANGLER,
    "deploy",
    "--config",
    config,
    "--dry-run",
    "--outdir",
    outdir,
  ]);
  const produced = (await files(outdir)).filter(
    (f) => !f.endsWith(".map") && f !== "README.md",
  );
  if (produced.length !== 1 || produced[0] !== entry)
    throw new Error(
      `${config} must bundle to one module ${entry}; got ${produced.join(", ")}`,
    );
  await mkdir(dirname(target), { recursive: true });
  await rename(join(outdir, entry), target);
}

/** Stage the same verified bundle for the regional and Production origins. */
async function mcpBundle(target, dist) {
  const distribution = JSON.parse(
    await readFile(join(root, "config/agent-mcp-distribution.json"), "utf8"),
  );
  const { bytes } = await downloadVerifiedMcp({ distribution });
  for (const directory of [target, dist]) {
    const path = join(directory, "downloads/mcp", distribution.release.asset);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
}

/** The release manifest for an assembled directory and the editor's dist. */
export async function describeRelease(dist, directory, sha) {
  const out = {};
  for (const path of await files(directory)) {
    if (path === "release.json") continue;
    const bytes = await readFile(join(directory, path));
    out[
      path.startsWith("root/")
        ? `assets/${path.slice(5, -ROOT_SUFFIX.length)}`
        : path
    ] = sha256(bytes);
  }
  for (const path of await files(join(dist, "assets"))) {
    if (path.endsWith(".br")) continue;
    out[`assets/assets/${path}`] = sha256(
      await readFile(join(dist, "assets", path)),
    );
  }
  return {
    schemaVersion: 1,
    commit: sha,
    // Hashed editor assets come from Production's own path; all else from here.
    sources: {
      "assets/assets/": "/assets/",
      "assets/": `/${RELEASE_DIRECTORY}/${sha}/root/{path}${ROOT_SUFFIX}`,
      "": `/${RELEASE_DIRECTORY}/${sha}/`,
    },
    files: Object.fromEntries(Object.entries(out).sort()),
  };
}

export async function createRegionalRelease(dist, sha, work, options = {}) {
  // Wrangler writes the bundle only for an absolute --outdir.
  dist = resolve(dist);
  work = resolve(work);
  if (!/^[0-9a-f]{40}$/.test(sha))
    throw new Error("A full commit SHA is required");
  const target = join(dist, RELEASE_DIRECTORY, sha);
  await rm(join(dist, RELEASE_DIRECTORY), { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const build = options.bundle ?? bundle;
  await build(
    join(FORMAL, "bundle.jsonc"),
    join(work, "worker"),
    "regional-entry.js",
    join(target, "worker/index.js"),
  );
  await build(
    join(FORMAL, "egress-bundle.jsonc"),
    join(work, "egress"),
    "egress.js",
    join(target, "egress.mjs"),
  );
  if (options.storage) await options.storage(target);
  else run("node", [join(FORMAL, "prepare-artifacts.mjs"), target]);
  for (const name of RELEASE_SOURCES)
    await copyFile(join(FORMAL, name), join(target, name));
  for (const name of await readdir(FORMAL))
    if (/^canvas-cn-[a-z-]+\.(service|timer)$/.test(name))
      await copyFile(join(FORMAL, name), join(target, name));
  await copyFile(
    join(root, "config/gallery-sources.json"),
    join(target, "gallery-sources.json"),
  );
  if (options.mcp) await options.mcp(target);
  else await mcpBundle(target, dist);
  // Root files the Worker may rewrite on the way out are served from here.
  for (const path of await files(dist)) {
    if (
      path.startsWith("assets/") ||
      path.startsWith("downloads/mcp/") ||
      path.startsWith(`${RELEASE_DIRECTORY}/`) ||
      path.endsWith(".br")
    )
      continue;
    const copy = join(target, "root", `${path}${ROOT_SUFFIX}`);
    await mkdir(dirname(copy), { recursive: true });
    await copyFile(join(dist, path), copy);
  }
  const manifest = await describeRelease(dist, target, sha);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(target, "release.json"), text);
  await writeFile(
    join(dist, RELEASE_DIRECTORY, "current.json"),
    `${JSON.stringify({
      commit: sha,
      manifest: `/${RELEASE_DIRECTORY}/${sha}/release.json`,
      sha256: sha256(text),
      // Local builds have no CI proof and must not authorize a regional install.
      ...(process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT
        ? {
            attempt: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
          }
        : {}),
    })}\n`,
  );
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [dist, sha, work] = process.argv.slice(2);
  if (!dist || !sha || !work) {
    console.error(
      "usage: node scripts/regional-release.mjs <dist> <sha> <work-dir>",
    );
    process.exit(2);
  }
  const manifest = await createRegionalRelease(dist, sha, work);
  console.log(
    `Regional release ${sha} lists ${Object.keys(manifest.files).length} files.`,
  );
}
