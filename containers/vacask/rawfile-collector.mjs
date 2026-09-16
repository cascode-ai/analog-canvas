import { lstat, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  isRunLocalPath,
  readRunLocalTextFile,
} from "../simulation/run-local-files.mjs";

/**
 * VACASK writes one or more run-local raw files, including dynamic sweeps.
 * Discover after process-tree termination; never guess analyses from filenames.
 * Input/dependency subtrees are excluded, directory walks and total bytes bounded.
 */
export async function collectVacaskRawfiles(
  directory,
  { inputPaths = [], maxBytes, maxFiles, maxEntries },
) {
  const rawfiles = [];
  const diagnostics = [];
  let bytes = 0;
  let entries = 0;
  let reads = 0;
  let limited = false;
  const error = (path, reason) =>
    diagnostics.push({
      severity: "error",
      text: `VACASK output ${path || "directory"}: ${reason}.`,
    });
  if (
    ![maxBytes, maxFiles, maxEntries].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    !Array.isArray(inputPaths) ||
    !inputPaths.every(isRunLocalPath)
  ) {
    error("", "invalid collection limits or excluded input paths");
    return { rawfiles, diagnostics, bytes, truncated: false };
  }
  const excluded = (path) =>
    inputPaths.some((input) => path === input || path.startsWith(`${input}/`));
  let root;
  try {
    root = await realpath(directory);
  } catch {
    error("", "unreadable-output");
    return { rawfiles, diagnostics, bytes, truncated: false };
  }
  const pending = [""];
  while (pending.length && !limited) {
    const parent = pending.pop();
    try {
      // All parents were lstat-checked below and the owning process is stopped.
      const stream = await opendir(join(root, parent));
      for await (const item of stream) {
        if (++entries > maxEntries) {
          error("", "entry limit exceeded");
          limited = true;
          break;
        }
        const path = parent ? `${parent}/${item.name}` : item.name;
        if (excluded(path)) continue;
        if (!isRunLocalPath(path)) {
          error(path, "unsafe-output");
          continue;
        }
        const info = await lstat(join(root, path));
        if (info.isSymbolicLink()) {
          error(path, "unsafe-output link");
          continue;
        }
        if (info.isDirectory()) {
          pending.push(path);
          continue;
        }
        if (!path.endsWith(".raw")) continue;
        if (!info.isFile() || info.nlink !== 1) {
          error(path, "unsafe-output");
          continue;
        }
        if (reads >= maxFiles || bytes >= maxBytes) {
          error(path, "file or total byte limit exceeded");
          limited = true;
          break;
        }
        reads++;
        const read = await readRunLocalTextFile(root, path, maxBytes - bytes);
        bytes += read.bytes;
        if (read.error) error(path, read.error);
        else if (read.format !== "ascii")
          error(
            path,
            "binary output requires the controlled ASCII startup policy",
          );
        else rawfiles.push({ path, text: read.text });
        if (read.truncated) {
          error(
            path,
            "total byte limit exceeded; retained prefix is incomplete",
          );
          limited = true;
          break;
        }
      }
    } catch {
      error(parent, "unreadable-output");
    }
  }
  // Stable transport identity, independent of filesystem directory enumeration.
  rawfiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { rawfiles, diagnostics, bytes, truncated: limited };
}
