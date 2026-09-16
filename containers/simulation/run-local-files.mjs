import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";

/** A portable run-local file address, never a host path. */
export function isRunLocalPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 240 &&
    !/[\\:\u0000-\u001f]/u.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

/**
 * Read one regular file only after the supervised process tree has stopped.
 * This is a collection boundary, not an OS sandbox. The enclosing harness must
 * keep its private directory inaccessible to other running jobs.
 */
export async function readRunLocalTextFile(directory, path, maxBytes) {
  const empty = (error) => ({
    text: null,
    format: null,
    error,
    bytes: 0,
    truncated: false,
  });
  if (!isRunLocalPath(path) || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
    return empty("invalid-collection");
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
    const within = relative(root, await realpath(cursor));
    if (
      !within ||
      within === ".." ||
      within.startsWith("../") ||
      within.startsWith("..\\") ||
      isAbsolute(within)
    )
      return empty("unsafe-output");
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
    // Size the allocation to this file, not the entire remaining run budget.
    const buffer = Buffer.alloc(Math.min(info.size, maxBytes) + 1);
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
    if (count > info.size || (await handle.stat()).size !== info.size)
      return empty("changed-output");
    const bytes = buffer.subarray(0, Math.min(count, maxBytes));
    let binary = buffer.subarray(0, count).includes(0);
    const truncated = count > maxBytes || info.size > maxBytes;
    let text = null;
    if (!binary) {
      try {
        // Never insert replacement characters into evidence, including a
        // multibyte title cut by the output budget. A partial suffix is omitted
        // only with the explicit incomplete-output flag.
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
          stream: truncated,
        });
      } catch {
        binary = true;
      }
    }
    return {
      text,
      format: binary ? "binary" : "ascii",
      error: null,
      bytes: bytes.length,
      truncated,
    };
  } catch (error) {
    return empty(
      error.code === "ENOENT" ? "missing-output" : "unreadable-output",
    );
  } finally {
    await handle?.close().catch(() => {});
  }
}
