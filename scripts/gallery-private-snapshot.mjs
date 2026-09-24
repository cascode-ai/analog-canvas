#!/usr/bin/env node
// A private Gallery snapshot, obtained with the operator's GitHub login.
// No backup credential is stored or passed to this process.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const repository = "Arcadia-1/analog-canvas-backups";
const workflow = "gallery-backup.yml";
const defaultDirectory = join(
  homedir(),
  "Library",
  "Application Support",
  "Analog Canvas",
  "gallery",
);

function gh(...args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function privateDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) {
    throw new Error(
      `Snapshot directory must have private 0700 permissions: ${path}`,
    );
  }
}

function releaseTag(runId) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const releases = JSON.parse(
      gh(
        "release",
        "list",
        "-R",
        repository,
        "--limit",
        "30",
        "--json",
        "tagName",
      ),
    );
    const tag = releases
      .map((release) => release.tagName)
      .find((name) =>
        runId ? name.includes(`-${runId}-`) : name.startsWith("gallery-"),
      );
    if (tag) return tag;
    if (attempt < 5) spawnSync("sleep", ["3"], { stdio: "ignore" });
  }
  throw new Error(
    `No verified Gallery release found for run ${runId ?? "latest"}`,
  );
}

function options(args) {
  let cached = false;
  let directory = defaultDirectory;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--cached") cached = true;
    else if (args[index] === "--directory" && args[index + 1]) {
      directory = args[++index];
    } else {
      throw new Error(
        "Usage: node scripts/gallery-private-snapshot.mjs [--cached] [--directory PATH]",
      );
    }
  }
  return { cached, directory: resolve(directory) };
}

function waitForRun(runId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = spawnSync(
      "gh",
      [
        "run",
        "watch",
        runId,
        "-R",
        repository,
        "--exit-status",
        "--compact",
        "--interval",
        "10",
      ],
      { stdio: "inherit" },
    );
    if (result.status === 0) return;
    let state;
    try {
      state = JSON.parse(
        gh(
          "run",
          "view",
          runId,
          "-R",
          repository,
          "--json",
          "status,conclusion",
        ),
      );
    } catch {
      // A temporary GitHub API failure should not start a second capture.
    }
    if (state?.status === "completed") {
      if (state.conclusion === "success") return;
      throw new Error(`Gallery backup run ${runId} ${state.conclusion}`);
    }
    if (attempt < 2)
      console.warn(
        "GitHub watch was interrupted; reconnecting to the same run",
      );
  }
  throw new Error(
    `Could not confirm backup run ${runId}; inspect it before retrying`,
  );
}

function main() {
  const { cached, directory } = options(process.argv.slice(2));
  if (
    gh(
      "repo",
      "view",
      repository,
      "--json",
      "isPrivate",
      "--jq",
      ".isPrivate",
    ) !== "true"
  ) {
    throw new Error(
      "Refusing to download: the Gallery backup repository is not private",
    );
  }

  let runId;
  if (!cached) {
    const url = gh("workflow", "run", workflow, "-R", repository);
    runId = url.match(/\/actions\/runs\/(\d+)/)?.[1];
    if (!runId)
      throw new Error(`Could not identify the new backup run: ${url}`);
    console.log(`Capturing live Gallery: ${url}`);
    waitForRun(runId);
  }

  const tag = releaseTag(runId);
  privateDirectory(directory);
  const destination = join(directory, tag);
  const database = join(destination, "gallery.sqlite");
  if (!existsSync(destination)) {
    privateDirectory(destination);
    const archive = `${tag}.tar.gz`;
    gh(
      "release",
      "download",
      tag,
      "-R",
      repository,
      "--pattern",
      archive,
      "--dir",
      destination,
    );
    const members = execFileSync("tar", ["-tzf", join(destination, archive)], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    const allowed = new Set([
      "README.txt",
      "gallery-backup.json",
      "gallery.sqlite",
      "manifest.json",
    ]);
    if (
      members.length !== allowed.size ||
      members.some((member) => !allowed.has(member))
    ) {
      throw new Error(
        "The private archive has an unexpected layout; nothing was extracted",
      );
    }
    execFileSync("tar", [
      "-xzf",
      join(destination, archive),
      "-C",
      destination,
    ]);
  } else {
    privateDirectory(destination);
  }
  if (!existsSync(database))
    throw new Error(`Snapshot is incomplete: ${destination}`);
  const manifest = JSON.parse(
    readFileSync(join(destination, "manifest.json"), "utf8"),
  );
  if (
    manifest.consistentCapture !== true ||
    manifest.offlineRestoreVerified !== true
  ) {
    throw new Error(
      `Snapshot has not passed offline verification: ${destination}`,
    );
  }
  console.log(`Gallery SQLite: ${database}`);
  console.log(`Captured at: ${manifest.captureEndedAt}`);
  console.log(`Rows: ${JSON.stringify(manifest.tables)}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
