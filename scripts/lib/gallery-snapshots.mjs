// Downloaded Gallery snapshots: when one can be trusted, and which older ones
// are spare. The private Releases keep every capture, so locally only the
// newest few are worth their disk space.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** `gallery-<capture time>Z-<run>-<attempt>`, as the backup Releases name them. */
const CAPTURE_NAME = /^gallery-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-\d+-\d+$/;

/**
 * Why a downloaded snapshot cannot be trusted, or null: its files, the
 * collector's recorded verification and this copy's SQLite integrity.
 */
export function snapshotProblem(destination) {
  const directory = lstatSync(destination, { throwIfNoEntry: false });
  if (!directory?.isDirectory() || directory.isSymbolicLink())
    return "Snapshot is not a directory";
  for (const name of ["gallery.sqlite", "manifest.json"]) {
    const stat = lstatSync(join(destination, name), { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      return "Snapshot is incomplete or contains linked files";
  }
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(join(destination, "manifest.json"), "utf8"),
    );
  } catch {
    return "Snapshot manifest is unreadable";
  }
  if (
    manifest.consistentCapture !== true ||
    manifest.offlineRestoreVerified !== true
  )
    return "Snapshot has not passed offline verification";
  let connection;
  try {
    connection = new DatabaseSync(join(destination, "gallery.sqlite"), {
      readOnly: true,
    });
    const check = connection.prepare("PRAGMA quick_check").all();
    if (check.length !== 1 || check[0].quick_check !== "ok")
      return "Snapshot SQLite is corrupt";
  } catch (error) {
    return `Snapshot SQLite is corrupt (${error instanceof Error ? error.message : error})`;
  } finally {
    connection?.close();
  }
  return null;
}

/**
 * The captures in `directory` beyond the newest `keep` that pass
 * `snapshotProblem`, oldest first. Names begin with their capture time, so
 * they sort by it. `current`, the capture just obtained and already checked,
 * is never selected; a partial or failed capture is neither counted nor
 * selected, and nothing else in the directory is touched.
 */
export function olderSnapshots(directory, keep, current) {
  const captures = readdirSync(directory)
    .filter(
      (name) =>
        name === current ||
        (CAPTURE_NAME.test(name) &&
          snapshotProblem(join(directory, name)) === null),
    )
    .sort();
  const kept = new Set(captures.slice(Math.max(0, captures.length - keep)));
  kept.add(current);
  return captures
    .filter((name) => !kept.has(name))
    .map((name) => join(directory, name));
}
