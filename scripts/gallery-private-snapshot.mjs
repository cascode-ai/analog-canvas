#!/usr/bin/env node
// A private Gallery snapshot, obtained with the operator's GitHub login.
// No backup credential is stored or passed to this process.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.platform !== "win32" && stat.mode & 0o077)
  ) {
    throw new Error(
      `Snapshot directory must have private 0700 permissions: ${path}`,
    );
  }
  privateWindowsPath(path, "Directory");
}

function privateWindowsPath(path, kind) {
  if (process.platform === "win32") {
    // POSIX mode bits do not describe Windows access. Reject ACLs granting
    // access outside this user, SYSTEM and local Administrators instead.
    const allowed = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference = 'Stop'; $acl = if ($env:ICM_SNAPSHOT_KIND -eq 'Directory') { [System.IO.Directory]::GetAccessControl($env:ICM_SNAPSHOT_PATH) } else { [System.IO.File]::GetAccessControl($env:ICM_SNAPSHOT_PATH) }; $userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $trusted = @($userSid, 'S-1-5-18', 'S-1-5-32-544'); $exposed = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $trusted }); if ($exposed.Count -gt 0) { 'exposed' } else { 'private' }",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ICM_SNAPSHOT_PATH: path,
          ICM_SNAPSHOT_KIND: kind,
        },
      },
    ).trim();
    if (allowed !== "private")
      throw new Error(
        `Snapshot ${kind.toLowerCase()} grants access to other users: ${path}`,
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
  let local;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--cached") cached = true;
    else if (args[index] === "--directory" && args[index + 1]) {
      directory = args[++index];
    } else if (args[index] === "--local" && args[index + 1]) {
      local = resolve(args[++index]);
    } else {
      throw new Error(
        "Usage: node scripts/gallery-private-snapshot.mjs [--cached] [--directory PATH] | --local SNAPSHOT_DIRECTORY",
      );
    }
  }
  if (local && (cached || directory !== defaultDirectory))
    throw new Error("--local does not combine with remote snapshot options");
  return { cached, directory: resolve(directory), local };
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

function validateSnapshot(destination) {
  privateDirectory(destination);
  for (const name of ["gallery.sqlite", "manifest.json"]) {
    const file = join(destination, name);
    const stat = existsSync(file) ? lstatSync(file) : null;
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error(
        `Snapshot is incomplete or contains linked files: ${destination}`,
      );
    privateWindowsPath(file, "File");
  }
  const manifest = JSON.parse(
    readFileSync(join(destination, "manifest.json"), "utf8"),
  );
  if (
    manifest.consistentCapture !== true ||
    manifest.offlineRestoreVerified !== true
  )
    throw new Error(
      `Snapshot has not passed offline verification: ${destination}`,
    );
  const database = join(destination, "gallery.sqlite");
  const connection = new DatabaseSync(database, { readOnly: true });
  try {
    const check = connection.prepare("PRAGMA quick_check").all();
    if (check.length !== 1 || check[0].quick_check !== "ok")
      throw new Error(`Snapshot SQLite is corrupt: ${destination}`);
  } finally {
    connection.close();
  }
  console.log(`Gallery SQLite: ${database}`);
  console.log(`Captured at: ${manifest.captureEndedAt}`);
  console.log(`Rows: ${JSON.stringify(manifest.tables)}`);
}

function main() {
  const { cached, directory, local } = options(process.argv.slice(2));
  if (local) {
    if (!existsSync(local))
      throw new Error(`Local snapshot does not exist: ${local}`);
    validateSnapshot(local);
    return;
  }
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
  validateSnapshot(destination);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
