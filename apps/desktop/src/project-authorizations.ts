import { copyFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { readLimited, writeDurable } from "./durable-files.js";

/** Durable consent to reopen selected files. Recent shortcuts are only a view:
 * removing or evicting one must never revoke an open workspace's file target. */
export function projectAuthorizations(path?: string) {
  let paths: Set<string> | undefined;
  const key = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  async function load() {
    if (paths) return paths;
    if (!path) return (paths = new Set());
    try {
      const value: unknown = JSON.parse(
        (await readLimited(path)).toString("utf8"),
      );
      if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== "string" || !isAbsolute(item))
      )
        throw new Error(
          "Saved file authorizations are damaged; reopen files explicitly",
        );
      return (paths = new Set(value.map(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return (paths = new Set());
      throw error;
    }
  }
  return {
    async allows(file: string) {
      return (await load()).has(key(file));
    },
    async remember(file: string) {
      let entries: Set<string>;
      try {
        entries = await load();
      } catch {
        // Explicit native selection can repair this index. Preserve its prior
        // bytes; automatic workspace resume never reaches this repair path.
        if (path) await copyFile(path, `${path}.${randomUUID()}.damaged`);
        entries = new Set();
      }
      if (entries.has(key(file))) return;
      const next = new Set([...entries, key(file)]);
      if (path) await writeDurable(path, JSON.stringify([...next]));
      paths = next;
    },
  };
}
