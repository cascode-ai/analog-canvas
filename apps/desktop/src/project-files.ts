// Adapted from LXY-freshman/schematic-draft @ 5231840f (AGPL-3.0-only).
// See ../SOURCES.md: dialog/outcome flow retained, path authority and writes adapted.
import { randomUUID } from "node:crypto";
import {
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { APP_ORIGIN } from "./app-protocol.js";

const MAX_BYTES = 16 * 1024 * 1024;
interface Grant {
  id: string;
  path: string;
  bytes: Buffer;
  revision: number;
}
export interface ProjectFileDialogs {
  promptOpen(): Promise<string | null>;
  promptSave(name: string, currentPath: string | null): Promise<string | null>;
}
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const receipt = (grant: Grant) => ({
  id: grant.id,
  name: basename(grant.path),
  path: grant.path,
  revision: grant.revision,
});
const key = (path: string) =>
  process.platform === "win32" ? path.toLowerCase() : path;

async function readBounded(path: string): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw new Error("Select a Project file no larger than 16 MiB");
    // One extra byte detects growth without allocating an unbounded read.
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES) throw new Error("Project exceeds 16 MiB");
    return Buffer.from(buffer.subarray(0, length));
  } finally {
    await file.close();
  }
}
async function existingBytes(path: string): Promise<Buffer | null> {
  try {
    return await readBounded(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
const same = (left: Buffer | null, right: Buffer | null) =>
  left === null ? right === null : right !== null && left.equals(right);

/** Grants live only in this main process. A renderer path is never authority. */
export function createProjectFileHandler(
  dialogs: ProjectFileDialogs,
  indexPath?: string,
) {
  const grants = new Map<string, Grant>();
  let recent: { id: string; path: string; name: string }[] = [];
  let loaded = false;
  const persist = async () => {
    if (!indexPath) return;
    const temporary = `${indexPath}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(recent), { mode: 0o600 });
      await rename(temporary, indexPath);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  };
  const remember = async (path: string) => {
    const old = recent.find((entry) => key(entry.path) === key(path));
    recent = [
      { id: old?.id ?? randomUUID(), path, name: basename(path) },
      ...recent.filter((entry) => key(entry.path) !== key(path)),
    ].slice(0, 20);
    // The file write already succeeded; index failure must not lose its receipt.
    try {
      await persist();
      return undefined;
    } catch {
      return "The file is saved, but the recent-project list could not be updated.";
    }
  };
  let busy = false;
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST")
      return json({ message: "POST required" }, 405);
    const origin =
      (request as Request & { initiatorOrigin?: string }).initiatorOrigin ??
      request.headers.get("origin");
    if (origin !== APP_ORIGIN) return json({ message: "Wrong origin" }, 403);
    if (busy)
      return json({
        status: "failed",
        message: "Another file operation is in progress",
      });
    busy = true;
    let temporary: string | undefined;
    try {
      if (!loaded) {
        if (indexPath) {
          try {
            const value: unknown = JSON.parse(
              await readFile(indexPath, "utf8"),
            );
            if (Array.isArray(value))
              recent = value
                .filter(
                  (entry) =>
                    entry &&
                    typeof entry.id === "string" &&
                    typeof entry.path === "string" &&
                    typeof entry.name === "string",
                )
                .slice(0, 20);
          } catch {
            /* A damaged index never grants renderer-provided paths. */
          }
        }
        loaded = true;
      }
      const route = new URL(request.url).pathname;
      if (route === "/desktop/project/recent")
        return json({ status: "listed", files: recent });
      if (
        route === "/desktop/project/forget" ||
        route === "/desktop/project/release"
      ) {
        const body = (await request.json()) as { id?: unknown };
        if (typeof body?.id !== "string")
          return json({ message: "Invalid id" }, 400);
        if (route.endsWith("/release")) grants.delete(body.id);
        else {
          recent = recent.filter((entry) => entry.id !== body.id);
          await persist();
        }
        return json({ status: "done" });
      }
      if (route === "/desktop/project/open") {
        const requestedId = request.headers.get("x-recent-project");
        const remembered = requestedId
          ? recent.find((entry) => entry.id === requestedId)
          : null;
        if (requestedId && !remembered)
          return json({ message: "Unknown recent Project" }, 404);
        const chosen = remembered?.path ?? (await dialogs.promptOpen());
        if (chosen === null) return json({ status: "cancelled" });
        const path = await realpath(chosen);
        const bytes = await readBounded(path);
        const existing = [...grants.values()].find(
          (grant) => key(grant.path) === key(path),
        );
        // Reopening must not silently advance another tab's acknowledged revision.
        const grant = existing ?? {
          id: randomUUID(),
          path,
          bytes,
          revision: 1,
        };
        // An existing open tab keeps its own acknowledged bytes and revision.
        // The renderer selects that tab; close/reopen explicitly reads a new version.
        grants.set(grant.id, grant);
        await remember(path);
        return json({
          status: "opened",
          file: receipt(grant),
          text: grant.bytes.toString("utf8"),
        });
      }
      if (route !== "/desktop/project/save")
        return json({ message: "Not found" }, 404);
      // Bound the request before JSON parsing, including escaped Project text.
      const reader = request.body?.getReader();
      if (!reader) return json({ message: "Missing Project" }, 400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > MAX_BYTES * 2) {
          await reader.cancel();
          return json({ message: "Project exceeds request limit" }, 413);
        }
        chunks.push(chunk.value);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        text?: unknown;
        name?: unknown;
        binding?: { id?: unknown; revision?: unknown } | null;
        saveAs?: unknown;
      };
      if (
        typeof body.text !== "string" ||
        typeof body.name !== "string" ||
        !body.name ||
        body.name.length > 200 ||
        basename(body.name) !== body.name ||
        /[\x00-\x1f<>:"/\\|?*]/u.test(body.name)
      )
        return json({ message: "Invalid Project request" }, 400);
      const bytes = Buffer.from(body.text, "utf8");
      if (bytes.length > MAX_BYTES)
        return json({ message: "Project exceeds 16 MiB" }, 413);
      const bound =
        typeof body.binding?.id === "string"
          ? grants.get(body.binding.id)
          : undefined;
      if (
        body.binding &&
        (!bound || body.binding.revision !== bound.revision) &&
        body.saveAs !== true
      )
        return json({
          status: "conflict",
          message:
            "File binding expired or changed. Use Save As with a new destination.",
        });
      const choose = !bound || body.saveAs === true;
      let path = bound?.path;
      if (choose) {
        const chosen = await dialogs.promptSave(
          body.name,
          bound?.path ??
            (recent[0] ? join(dirname(recent[0].path), body.name) : null),
        );
        if (chosen === null) return json({ status: "cancelled" });
        try {
          path = await realpath(chosen);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          path = join(
            await realpath(dirname(resolve(chosen))),
            basename(chosen),
          );
        }
      }
      if (!path) throw new Error("No authorized destination");
      const owner = [...grants.values()].find(
        (grant) => key(grant.path) === key(path!),
      );
      if (owner && owner !== bound)
        return json({
          status: "conflict",
          message:
            "That destination belongs to another open Project. Choose a different file.",
        });
      if (owner && body.binding?.revision !== owner.revision)
        return json({
          status: "conflict",
          message:
            "That file has a newer save. Choose a different destination.",
        });
      const expected = owner?.bytes ?? (await existingBytes(path));
      const conflict = () =>
        json({
          status: "conflict",
          message:
            "File changed outside the editor. No file was overwritten; use Save As to keep your edits.",
        });
      if (!same(expected, await existingBytes(path))) return conflict();
      temporary = join(
        dirname(path),
        `.analog-canvas-save-${randomUUID()}.tmp`,
      );
      const file = await open(temporary, "wx");
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      // Optimistic byte comparison, not a hash or an OS-wide write lock.
      if (!same(expected, await existingBytes(path))) return conflict();
      await rename(temporary, path);
      temporary = undefined;
      const grant: Grant = owner ?? {
        id: randomUUID(),
        path,
        bytes,
        revision: 0,
      };
      grant.bytes = bytes;
      grant.revision += 1;
      grants.set(grant.id, grant);
      if (bound && bound.id !== grant.id) grants.delete(bound.id);
      const warning = await remember(path);
      return json({
        status: "saved",
        file: receipt(grant),
        ...(warning ? { warning } : {}),
      });
    } catch (error) {
      return json({
        status: "failed",
        message:
          error instanceof Error ? error.message : "File operation failed",
      });
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
      busy = false;
    }
  };
}
