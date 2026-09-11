import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";

/** Collection is a run-local output, never a host path or an input file. */
export function validCollection(value, inputPaths = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.keys(value).length !== 1 || !("rawfile" in value)) return false;
  const path = value.rawfile;
  if (path === null) return true;
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 240 ||
    /[\\:\u0000-\u001f]/u.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    path.toLowerCase() === ".spiceinit"
  )
    return false;
  // A file cannot simultaneously be the run's input and collected output;
  // include parent/child collisions with dependency mounts and source paths.
  return !inputPaths.some(
    (input) =>
      input === path ||
      input.startsWith(`${path}/`) ||
      path.startsWith(`${input}/`),
  );
}

const empty = (rawfileError = null) => ({
  rawfile: null,
  rawfileName: null,
  rawfileFormat: null,
  rawfileError,
});

/**
 * Read exactly the declared regular file after the supervised process tree
 * has stopped. No directory search, filename guessing, symlink traversal or
 * alternate input-file fallback. The simulator parser remains in spice-run.
 */
export async function readDeclaredRawfile(directory, collection, maxBytes) {
  if (
    !validCollection(collection) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  )
    return empty("invalid-collection");
  if (collection.rawfile === null) return empty();
  const path = collection.rawfile;
  let handle;
  try {
    const root = await realpath(directory);
    let cursor = root;
    const parts = path.split("/");
    for (let index = 0; index < parts.length; index++) {
      cursor = join(cursor, parts[index]);
      const info = await lstat(cursor);
      if (
        info.isSymbolicLink() ||
        (index < parts.length - 1
          ? !info.isDirectory()
          : !info.isFile() || info.nlink !== 1)
      )
        return empty("unsafe-output");
    }
    const resolved = await realpath(cursor);
    const within = relative(root, resolved);
    if (
      !within ||
      within === ".." ||
      within.startsWith("../") ||
      within.startsWith("..\\") ||
      isAbsolute(within)
    )
      return empty("unsafe-output");
    // NONBLOCK avoids a malicious FIFO replacement hanging the collector;
    // NOFOLLOW rejects final-component symlinks on platforms that support it.
    handle = await open(
      cursor,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const info = await handle.stat();
    const current = await lstat(cursor);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      current.isSymbolicLink() ||
      info.ino !== current.ino ||
      info.dev !== current.dev
    )
      return empty("unsafe-output");
    const buffer = Buffer.alloc(maxBytes + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        count,
        buffer.length - count,
        count,
      );
      if (!bytesRead) break;
      count += bytesRead;
    }
    const bytes = buffer.subarray(0, count);
    const binary = bytes.includes(0);
    return {
      rawfile: binary ? null : bytes.subarray(0, maxBytes).toString("utf8"),
      rawfileName: path,
      rawfileFormat: binary ? "binary" : "ascii",
      rawfileError: null,
      truncated: count > maxBytes,
    };
  } catch (error) {
    return empty(
      error.code === "ENOENT" ? "missing-output" : "unreadable-output",
    );
  } finally {
    await handle?.close().catch(() => {});
  }
}
