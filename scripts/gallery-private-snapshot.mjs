#!/usr/bin/env node
// A private Gallery snapshot, obtained with the operator's GitHub login.
// No backup credential is stored or passed to this process.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  DEFAULT_SNAPSHOT_DIRECTORY,
  olderSnapshots,
  snapshotProblem,
} from "./lib/gallery-snapshots.mjs";

const repository = "cascode-ai/analog-canvas-backups";
const keptSnapshots = 2;
/** Each backup: its workflow, where it lands and what its archive holds. */
const kinds = {
  gallery: {
    label: "Gallery",
    workflow: "gallery-backup.yml",
    prefix: "gallery-",
    database: "gallery.sqlite",
    json: "gallery-backup.json",
    directory: DEFAULT_SNAPSHOT_DIRECTORY,
  },
  // The whole store with every private Cloud Project; started by hand only.
  store: {
    label: "Store",
    workflow: "store-backup.yml",
    prefix: "store-",
    database: "store.sqlite",
    json: "store-backup.json",
    directory: join(dirname(DEFAULT_SNAPSHOT_DIRECTORY), "store"),
  },
};

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

function releaseTag(runId, kind) {
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
      .find(
        (name) =>
          name.startsWith(kind.prefix) &&
          (!runId || name.includes(`-${runId}-`)),
      );
    if (tag) return tag;
    if (attempt < 5) spawnSync("sleep", ["3"], { stdio: "ignore" });
  }
  throw new Error(
    `No verified ${kind.label} release found for run ${runId ?? "latest"}`,
  );
}

function options(args) {
  let cached = false;
  let directory;
  let local;
  let kind = kinds.gallery;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--cached") cached = true;
    else if (args[index] === "--store") kind = kinds.store;
    else if (args[index] === "--directory" && args[index + 1]) {
      directory = args[++index];
    } else if (args[index] === "--local" && args[index + 1]) {
      local = resolve(args[++index]);
    } else {
      throw new Error(
        "Usage: node scripts/gallery-private-snapshot.mjs [--store] [--cached] [--directory PATH] | [--store] --local SNAPSHOT_DIRECTORY",
      );
    }
  }
  if (local && (cached || directory))
    throw new Error("--local does not combine with remote snapshot options");
  return {
    cached,
    directory: resolve(directory ?? kind.directory),
    local,
    kind,
  };
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
      throw new Error(`Backup run ${runId} ${state.conclusion}`);
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

function validateSnapshot(destination, kind) {
  privateDirectory(destination);
  const problem = snapshotProblem(destination, kind.database);
  if (problem) throw new Error(`${problem}: ${destination}`);
  for (const name of [kind.database, "manifest.json"])
    privateWindowsPath(join(destination, name), "File");
  const manifest = JSON.parse(
    readFileSync(join(destination, "manifest.json"), "utf8"),
  );
  console.log(`${kind.label} SQLite: ${join(destination, kind.database)}`);
  console.log(`Captured at: ${manifest.captureEndedAt}`);
  console.log(`Rows: ${JSON.stringify(manifest.tables)}`);
}

// The private Releases keep every capture. Older local ones go to the Trash,
// so emptying it stays the operator's decision; without `trash`, none move.
function retainNewestSnapshots(directory, current, kind) {
  try {
    const older = olderSnapshots(
      directory,
      keptSnapshots,
      current,
      kind.database,
    );
    if (older.length === 0) return;
    if (process.platform !== "darwin" || !existsSync("/usr/bin/trash")) {
      console.log(
        `Older snapshots kept (no trash command): ${older.join(", ")}`,
      );
      return;
    }
    execFileSync("/usr/bin/trash", ["-s", ...older], { stdio: "ignore" });
    console.log(`Moved ${older.length} older snapshot(s) to the Trash`);
  } catch (error) {
    // The new snapshot is already verified; retention must not fail it.
    console.warn(
      `Older snapshots were not all moved to the Trash: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function main() {
  const { cached, directory, local, kind } = options(process.argv.slice(2));
  if (local) {
    if (!existsSync(local))
      throw new Error(`Local snapshot does not exist: ${local}`);
    validateSnapshot(local, kind);
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
      "Refusing to download: the backup repository is not private",
    );
  }

  let runId;
  if (!cached) {
    const url = gh("workflow", "run", kind.workflow, "-R", repository);
    runId = url.match(/\/actions\/runs\/(\d+)/)?.[1];
    if (!runId)
      throw new Error(`Could not identify the new backup run: ${url}`);
    console.log(`Capturing live ${kind.label}: ${url}`);
    waitForRun(runId);
  }

  const tag = releaseTag(runId, kind);
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
      kind.json,
      kind.database,
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
  validateSnapshot(destination, kind);
  retainNewestSnapshots(directory, tag, kind);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
