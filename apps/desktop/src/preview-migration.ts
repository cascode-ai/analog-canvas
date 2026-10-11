import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readLimited, writeDurable } from "./durable-files.js";

// Recovery and preferences are durable application data, not Chromium caches.
const MIGRATED = [
  "IndexedDB",
  "Local Storage",
  "Session Storage",
  "recent-projects.json",
  "recent-projects.json.authorized",
  "recent-projects.json.creations",
  "project-library.json",
  "external-history.json",
  "external-history",
];
interface MigrationFile {
  path: string;
  size: number;
  digest: string;
}
interface MigrationManifest {
  source: string;
  files: MigrationFile[];
}
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function inventory(root: string): Promise<MigrationFile[]> {
  const files: MigrationFile[] = [];
  let total = 0;
  async function visit(path: string, depth = 0) {
    if (depth > 32)
      throw new Error("Preview data nesting exceeds migration limits");
    const full = join(root, path);
    const stat = await lstat(full);
    if (stat.isSymbolicLink())
      throw new Error(
        "Preview data contains a link; close the preview and select a regular data directory",
      );
    if (stat.isDirectory()) {
      for (const child of await readdir(full))
        await visit(join(path, child), depth + 1);
      return;
    }
    if (!stat.isFile() || stat.size > 256 * 1024 * 1024)
      throw new Error("Preview data file exceeds migration limits");
    total += stat.size;
    if (total > 1024 * 1024 * 1024 || files.length >= 10_000)
      throw new Error("Preview data exceeds the 1 GiB migration limit");
    const bytes = await readLimited(full, 256 * 1024 * 1024);
    if (path.endsWith(".json") || path.endsWith(".authorized"))
      JSON.parse(bytes.toString("utf8"));
    files.push({ path, size: bytes.length, digest: digest(bytes) });
  }
  for (const name of MIGRATED)
    if (await exists(join(root, name))) await visit(name);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function previewMigrationState(
  target: string,
  source: string | null,
) {
  if (await exists(join(target, "preview-migration.json")))
    return "complete" as const;
  if (await exists(join(target, ".preview-import", "manifest.json")))
    return "pending" as const;
  if (source && (await exists(source))) return "available" as const;
  return "none" as const;
}

/** Copy a quiescent preview snapshot before creating the renderer's session.
 * A durable staging manifest makes partial installation retryable. Existing
 * destination files must match; neither old data nor new work is overwritten.
 */
export async function migratePreviewData(
  source: string,
  target: string,
  assertSourceClosed: () => Promise<void>,
) {
  source = resolve(source);
  target = resolve(target);
  await mkdir(target, { recursive: true });
  target = await realpath(target);
  if (await exists(source)) source = await realpath(source);
  const inside = (root: string, child: string) => {
    const path = relative(root, child);
    return !path.startsWith("..") && !isAbsolute(path);
  };
  if (inside(source, target) || inside(target, source))
    throw new Error("Preview and current data directories must be separate");
  const staging = join(target, ".preview-import");
  const manifestPath = join(staging, "manifest.json");
  let manifest: MigrationManifest;
  if ((await exists(staging)) && (await lstat(staging)).isSymbolicLink())
    throw new Error("Invalid migration staging directory");
  if (await exists(manifestPath)) {
    manifest = JSON.parse(
      (await readLimited(manifestPath, 2 * 1024 * 1024)).toString("utf8"),
    ) as MigrationManifest;
    // Compare to a fresh inventory, rather than trusting persisted paths.
    const staged = await inventory(staging);
    if (JSON.stringify(staged) !== JSON.stringify(manifest.files))
      throw new Error(
        "Staged preview snapshot is damaged; original preview data is preserved",
      );
  } else {
    await assertSourceClosed();
    for (const name of MIGRATED)
      if (await exists(join(target, name)))
        throw new Error(
          "Current application data already exists; keep it and open the previous files separately",
        );
    if (await exists(staging)) {
      // This fixed app-owned staging folder has no accepted manifest. It contains
      // copies only; original data has not changed and is inventoried again.
      if ((await lstat(staging)).isSymbolicLink())
        throw new Error("Invalid migration staging directory");
      await rm(staging, { recursive: true });
    }
    await mkdir(staging);
    const files = await inventory(source);
    for (const file of files) {
      const destination = join(staging, file.path);
      await mkdir(resolve(destination, ".."), { recursive: true });
      await copyFile(join(source, file.path), destination);
    }
    await assertSourceClosed();
    if (
      JSON.stringify(await inventory(source)) !== JSON.stringify(files) ||
      JSON.stringify(await inventory(staging)) !== JSON.stringify(files)
    )
      throw new Error(
        "Preview data changed during copying; close the preview and retry",
      );
    manifest = { source, files };
    await writeDurable(manifestPath, JSON.stringify(manifest));
  }
  for (const file of manifest.files) {
    const destination = join(target, file.path);
    // A partially installed profile may have changed between attempts. Never
    // follow a directory junction into unrelated application/user data.
    let parent = target;
    for (const segment of file.path.split(/[\\/]/u).slice(0, -1)) {
      parent = join(parent, segment);
      if (await exists(parent)) {
        const stat = await lstat(parent);
        if (stat.isSymbolicLink() || !stat.isDirectory())
          throw new Error(
            "Current data contains a link or invalid directory; both copies are preserved",
          );
      }
    }
    if (await exists(destination)) {
      if (
        (await lstat(destination)).isSymbolicLink() ||
        digest(await readLimited(destination, 256 * 1024 * 1024)) !==
          file.digest
      )
        throw new Error(
          "Current data differs from the staged preview; both copies are preserved",
        );
      continue;
    }
    await mkdir(resolve(destination, ".."), { recursive: true });
    await writeDurable(
      destination,
      await readLimited(join(staging, file.path), 256 * 1024 * 1024),
    );
  }
  await writeDurable(
    join(target, "preview-migration.json"),
    JSON.stringify({
      source: manifest.source,
      importedAt: new Date().toISOString(),
      files: manifest.files.length,
    }),
  );
  await rm(staging, { recursive: true });
  return manifest.files.length;
}

export async function startFreshDesktopData(target: string) {
  await mkdir(target, { recursive: true });
  await writeDurable(
    join(target, "preview-migration.json"),
    JSON.stringify({ imported: false, createdAt: new Date().toISOString() }),
  );
}

export async function assertPreviousPreviewClosed() {
  if (process.platform !== "win32") return;
  // Electron helpers use the same executable name; only another main process
  // can own the old profile. Unknown command lines fail closed.
  const script = `if (Get-CimInstance Win32_Process -Filter "Name = 'Analog Canvas Preview.exe'" | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -notmatch '--type[= ]' }) { exit 7 }`;
  try {
    await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true, timeout: 20_000 },
    );
  } catch {
    throw new Error(
      "Close the previous Analog Canvas Preview before importing its data",
    );
  }
}
