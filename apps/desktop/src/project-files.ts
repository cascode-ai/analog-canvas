// Adapted from LXY-freshman/schematic-draft @ 5231840f (AGPL-3.0-only).
// See ../SOURCES.md: dialog/outcome flow retained, path authority and writes adapted.
import { createHash, randomUUID } from "node:crypto";
import { open, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { APP_ORIGIN } from "./app-protocol.js";
import type { ProjectLibrary } from "./project-library.js";
import { projectHistory } from "./project-history.js";
import {
  createIndependentProject,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import { readLimited } from "./durable-files.js";
import { projectAuthorizations } from "./project-authorizations.js";
import {
  CreationCancelled,
  projectCreations,
  type CreationRecovery,
} from "./project-creations.js";

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
  promptDirectory?(): Promise<string | null>;
  reveal?(path: string): Promise<void>;
  confirm?(message: string): Promise<boolean>;
  recoverCreation?: CreationRecovery;
  takeLaunchFile?(): string | null;
}
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const receipt = (grant: Grant) => ({
  id: grant.id,
  name: basename(grant.path),
  path: grant.path,
  revision: grant.revision,
  byteDigest: createHash("sha256").update(grant.bytes).digest("hex"),
});
const key = (path: string) =>
  process.platform === "win32" ? path.toLowerCase() : path;
function creationKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || value.length > 200)
    throw new Error("Invalid creation identity");
  return value;
}
const copyIdentity = (creation: string | undefined) =>
  creation
    ? `copy-${createHash("sha256").update(creation).digest("hex").slice(0, 32)}`
    : randomUUID();

class FileRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function readRequest(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new FileRequestError("Missing Project", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > MAX_BYTES * 2) {
      await reader.cancel();
      throw new FileRequestError("Project exceeds request limit", 413);
    }
    chunks.push(chunk.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

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
async function createdBaseline(path: string, bytes: Buffer) {
  const existing = await existingBytes(path);
  if (existing && !existing.equals(bytes))
    throw new FileConflict(
      "Creation destination changed; no file was overwritten",
    );
  return existing;
}
const same = (left: Buffer | null, right: Buffer | null) =>
  left === null ? right === null : right !== null && left.equals(right);

class FileConflict extends Error {}
async function commitProjectFile(
  path: string,
  expected: Buffer | null,
  bytes: Buffer,
  library?: ProjectLibrary,
  independent = false,
) {
  const conflict = () =>
    new FileConflict(
      "File changed outside the editor. No file was overwritten; save a separate copy.",
    );
  try {
    if (!same(expected, await existingBytes(path))) throw conflict();
    const history = library
      ? projectHistory(await library.historyDirectory(path), path)
      : undefined;
    await history?.prepare(expected, bytes, independent);
    const temporary = join(
      dirname(path),
      `.analog-canvas-save-${randomUUID()}.tmp`,
    );
    try {
      const file = await open(temporary, "wx");
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      if (!same(expected, await existingBytes(path))) throw conflict();
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    try {
      await history?.finish();
    } catch {
      return "The file is saved. History finalization will be retried on the next operation.";
    }
    return undefined;
  } catch (error) {
    if (expected === null)
      await library?.discardFailedAllocation(path).catch(() => {});
    throw error;
  }
}

/** Grants live only in this main process. A renderer path is never authority. */
export function createProjectFileHandler(
  dialogs: ProjectFileDialogs,
  indexPath?: string,
  library?: ProjectLibrary,
) {
  const grants = new Map<string, Grant>();
  const creations = projectCreations(
    indexPath ? `${indexPath}.creations` : undefined,
  );
  const authorizations = projectAuthorizations(
    indexPath ? `${indexPath}.authorized` : undefined,
  );
  let recent: { id: string; path: string; name: string }[] = [];
  const historyTarget = async (id: string) => {
    if (!library) throw new Error("Project library unavailable");
    const file = grants.get(id) ?? recent.find((entry) => entry.id === id);
    if (!file) return library.inspect(id);
    if (key(await realpath(file.path)) !== key(file.path))
      throw new FileConflict("File moved; open it explicitly");
    return { id, path: file.path, name: basename(file.path), recycled: false };
  };
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
    let warning: string | undefined;
    try {
      await authorizations.remember(path);
    } catch {
      warning =
        "The file is saved, but its workspace authorization could not be retained. Reopen it explicitly after restarting.";
    }
    const old = recent.find((entry) => key(entry.path) === key(path));
    recent = [
      { id: old?.id ?? randomUUID(), path, name: basename(path) },
      ...recent.filter((entry) => key(entry.path) !== key(path)),
    ].slice(0, 20);
    // The file write already succeeded; index failure must not lose its receipt.
    try {
      await persist();
      return warning;
    } catch {
      return "The file is saved, but the recent-project list could not be updated.";
    }
  };
  const createLibraryCopy = async (
    project: ReturnType<typeof parseProject>,
    creation: string | undefined,
    suffix: "copy" | "branch",
  ) => {
    if (!library) throw new Error("Project library unavailable");
    const copy = createIndependentProject(
      project,
      copyIdentity(creation),
      `${project.name.slice(0, 120 - suffix.length - 3)} (${suffix})`,
    );
    const bytes = Buffer.from(serializeProject(copy));
    const resolution = creation
      ? await creations.lookup(creation, bytes, dialogs.recoverCreation)
      : null;
    const prior = resolution?.newDestination === false ? resolution : null;
    const replace = resolution?.newDestination === true;
    const destination =
      prior?.path ??
      (await library.allocate(
        creation
          ? { key: replace ? randomUUID() : creation, bytes }
          : undefined,
      ));
    const expected = prior
      ? prior.expected
      : await createdBaseline(destination, bytes);
    if (creation)
      await creations.reserve(creation, destination, expected, bytes, replace);
    await commitProjectFile(destination, expected, bytes, library);
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
    try {
      if (!loaded) {
        if (indexPath) {
          try {
            const value: unknown = JSON.parse(
              (await readLimited(indexPath, 1024 * 1024)).toString("utf8"),
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
      if (route === "/desktop/project/next-launch") {
        const requested = dialogs.takeLaunchFile?.();
        if (!requested) return json({ status: "empty" });
        const path = await realpath(requested);
        parseProject((await readBounded(path)).toString("utf8"));
        await remember(path);
        const remembered = recent.find((file) => key(file.path) === key(path));
        if (!remembered)
          throw new Error("Requested Project could not be remembered");
        return json({
          status: "queued",
          id: remembered.id,
        });
      }
      if (
        route === "/desktop/project/copy-to-library" ||
        route === "/desktop/project/saved-copy"
      ) {
        if (!library) throw new Error("Project library unavailable");
        const body = (await readRequest(request)) as {
          id?: unknown;
          creationKey?: unknown;
        };
        if (typeof body.id !== "string") throw new Error("Invalid Project id");
        const path =
          recent.find((file) => file.id === body.id)?.path ??
          (await library.resolve(body.id));
        if (key(await realpath(path)) !== key(path))
          throw new Error("File moved; open it explicitly");
        const project = parseProject(
          (await readBounded(path)).toString("utf8"),
        );
        if (route.endsWith("/saved-copy"))
          return json({
            status: "read",
            name: project.name,
            text: serializeProject(project),
          });
        await createLibraryCopy(project, creationKey(body.creationKey), "copy");
        return json({ status: "done" });
      }
      if (route === "/desktop/project/resume") {
        const body = (await readRequest(request)) as {
          path?: unknown;
          byteDigest?: unknown;
        };
        if (
          typeof body.path !== "string" ||
          typeof body.byteDigest !== "string" ||
          !/^[a-f0-9]{64}$/u.test(body.byteDigest)
        )
          throw new Error("Invalid workspace file hint");
        if (!(await authorizations.allows(body.path)))
          throw new FileConflict(
            "This file is no longer remembered. Open it explicitly or save the recovered copy separately.",
          );
        const path = await realpath(body.path);
        if (key(path) !== key(body.path))
          throw new FileConflict(
            "The remembered file moved; open it explicitly",
          );
        const bytes = await readBounded(path);
        if (
          createHash("sha256").update(bytes).digest("hex") !== body.byteDigest
        )
          throw new FileConflict(
            "The file changed while the app was closed; the recovered Project remains unbound",
          );
        const existing = [...grants.values()].find(
          (grant) => key(grant.path) === key(path),
        );
        if (existing && !existing.bytes.equals(bytes))
          throw new FileConflict(
            "An open Project already holds an earlier version of this file",
          );
        const grant = existing ?? {
          id: randomUUID(),
          path,
          bytes,
          revision: 1,
        };
        grants.set(grant.id, grant);
        return json({
          status: "opened",
          file: receipt(grant),
          text: bytes.toString("utf8"),
        });
      }
      if (route === "/desktop/project/library-action") {
        if (!library)
          return json({ message: "Project library unavailable" }, 404);
        const body = (await readRequest(request)) as {
          id?: unknown;
          action?: unknown;
          name?: unknown;
          favorite?: unknown;
          version?: unknown;
          expectedText?: unknown;
          creationKey?: unknown;
        };
        if (typeof body.id !== "string")
          return json({ message: "Invalid Project id" }, 400);
        const entry =
          body.action === "restore-version" || body.action === "branch-version"
            ? await historyTarget(body.id)
            : await library.inspect(body.id);
        if (
          ["rename", "delete", "purge", "restore", "restore-version"].includes(
            String(body.action),
          ) &&
          [...grants.values()].some(
            (grant) => key(grant.path) === key(entry.path),
          )
        )
          return json({
            status: "conflict",
            message:
              "Close this Project's tab before changing its saved copy. Save or discard edits using the tab's close prompt.",
          });
        if (body.action === "favorite" && typeof body.favorite === "boolean")
          await library.favorite(body.id, body.favorite);
        else if (
          body.action === "restore-version" ||
          body.action === "branch-version"
        ) {
          if (entry.recycled)
            throw new Error("Restore this Project before changing it");
          const history = projectHistory(
            await library.historyDirectory(entry.path),
            entry.path,
          );
          const version = (await history.list()).find(
            (version) => version.id === body.version,
          );
          if (!version)
            throw new Error(
              "This historical version is no longer available; refresh history",
            );
          const project = parseProject(version.text);
          if (body.action === "branch-version") {
            await createLibraryCopy(
              project,
              creationKey(body.creationKey),
              "branch",
            );
          } else {
            if (typeof body.expectedText !== "string")
              throw new Error("Refresh history before restoring");
            const expected = Buffer.from(body.expectedText);
            if (!same(expected, await existingBytes(entry.path)))
              throw new FileConflict(
                "Project changed since history was opened; refresh before restoring",
              );
            if (project.id !== parseProject(body.expectedText).id)
              throw new Error(
                "Historical version belongs to another Project; create a branch instead",
              );
            if (
              !(await dialogs.confirm?.(
                `Restore the selected version of ${entry.name}? The current saved version will remain in history.`,
              ))
            )
              return json({ status: "cancelled" });
            await commitProjectFile(
              entry.path,
              expected,
              Buffer.from(serializeProject(project)),
              library,
            );
          }
        } else if (body.action === "delete" || body.action === "purge") {
          if (
            !(await dialogs.confirm?.(
              body.action === "delete"
                ? `Move ${entry.name} to the recycle area?`
                : `Permanently delete ${entry.name} and its history? This cannot be undone.`,
            ))
          )
            return json({ status: "cancelled" });
          if (body.action === "delete") await library.recycle(body.id);
          else await library.purge(body.id);
          recent = recent.filter((file) => key(file.path) !== key(entry.path));
          await persist();
        } else if (body.action === "restore")
          await library.recycle(body.id, true);
        else if (body.action === "rename" || body.action === "duplicate") {
          if (entry.recycled)
            throw new Error("Restore this Project before changing it");
          const before = await readBounded(entry.path);
          const project = parseProject(before.toString("utf8"));
          if (body.action === "rename") {
            if (
              typeof body.name !== "string" ||
              !body.name.trim() ||
              body.name.trim().length > 120
            )
              throw new Error("Use a name between 1 and 120 characters");
            project.name = body.name.trim();
            await commitProjectFile(
              entry.path,
              before,
              Buffer.from(serializeProject(project)),
              library,
            );
          } else {
            await createLibraryCopy(
              project,
              creationKey(body.creationKey),
              "copy",
            );
          }
        } else return json({ message: "Unknown library action" }, 400);
        return json({ status: "done" });
      }
      if (route === "/desktop/project/history") {
        if (!library)
          return json({ message: "Project library unavailable" }, 404);
        const body = (await readRequest(request)) as { id?: unknown };
        if (typeof body.id !== "string")
          return json({ message: "Invalid Project id" }, 400);
        const { path } = await historyTarget(body.id);
        const history = projectHistory(
          await library.historyDirectory(path),
          path,
        );
        return json({
          status: "listed",
          versions: await history.list(),
          currentText: (await readBounded(path)).toString("utf8"),
        });
      }
      if (route === "/desktop/project/library") {
        if (!library)
          return json({ message: "Project library unavailable" }, 404);
        const listing = await library.list();
        const recentProjects = await Promise.all(
          recent.map(async (file) => {
            try {
              if (key(await realpath(file.path)) !== key(file.path))
                throw new Error("File moved; open it explicitly");
              const project = parseProject(
                (await readBounded(file.path)).toString("utf8"),
              );
              return { ...file, name: project.name };
            } catch (error) {
              return {
                ...file,
                error:
                  error instanceof Error ? error.message : "File unavailable",
              };
            }
          }),
        );
        return json({ status: "listed", ...listing, recentProjects });
      }
      if (route === "/desktop/project/library-directory") {
        if (!library || !dialogs.promptDirectory)
          return json({ message: "Project library unavailable" }, 404);
        const path = await dialogs.promptDirectory();
        return path === null
          ? json({ status: "cancelled" })
          : json({ status: "listed", ...(await library.selectRoot(path)) });
      }
      if (route === "/desktop/project/reveal") {
        if (!library || !dialogs.reveal)
          return json({ message: "Project library unavailable" }, 404);
        const body = (await readRequest(request)) as { id?: unknown };
        const path =
          typeof body.id === "string"
            ? (recent.find((file) => file.id === body.id)?.path ??
              grants.get(body.id)?.path ??
              (await library.locate(body.id)))
            : (await library.list()).root;
        await dialogs.reveal(path);
        return json({ status: "done" });
      }
      if (route === "/desktop/project/recent")
        return json({ status: "listed", files: recent });
      if (
        route === "/desktop/project/forget" ||
        route === "/desktop/project/release"
      ) {
        const body = (await readRequest(request)) as { id?: unknown };
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
        const libraryPath =
          requestedId?.startsWith("library:") && library
            ? await library.resolve(requestedId)
            : undefined;
        if (requestedId && !remembered && !libraryPath)
          return json({ message: "Unknown recent Project" }, 404);
        const chosen =
          libraryPath ?? remembered?.path ?? (await dialogs.promptOpen());
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
      const body = (await readRequest(request)) as {
        text?: unknown;
        name?: unknown;
        binding?: { id?: unknown; revision?: unknown } | null;
        saveAs?: unknown;
        intoLibrary?: unknown;
        creationKey?: unknown;
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
      const creation = creationKey(body.creationKey);
      const resolution =
        choose && creation
          ? await creations.lookup(creation, bytes, dialogs.recoverCreation)
          : null;
      const priorCreation =
        resolution?.newDestination === false ? resolution : null;
      const replaceCreation = resolution?.newDestination === true;
      let allocatedWithKey = false;
      let path = bound?.path;
      if (choose) {
        const allocateInLibrary =
          library &&
          ((!body.binding && body.saveAs !== true) ||
            (body.saveAs === true && body.intoLibrary === true));
        allocatedWithKey = !!allocateInLibrary && !!creation;
        const chosen =
          priorCreation?.path ??
          (allocateInLibrary
            ? await library.allocate(
                creation
                  ? { key: replaceCreation ? randomUUID() : creation, bytes }
                  : undefined,
              )
            : await dialogs.promptSave(
                body.name,
                bound?.path ??
                  (recent[0] ? join(dirname(recent[0].path), body.name) : null),
              ));
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
      if (body.saveAs === true && bound && key(path) === key(bound.path))
        return json({
          status: "conflict",
          message:
            "Save As creates an independent Project. Choose a different file or the project library.",
        });
      const owner = [...grants.values()].find(
        (grant) => key(grant.path) === key(path!),
      );
      const replay =
        (allocatedWithKey || priorCreation?.committed === true) &&
        (!owner || owner.bytes.equals(bytes));
      if (owner && owner !== bound && !replay)
        return json({
          status: "conflict",
          message:
            "That destination belongs to another open Project. Choose a different file.",
        });
      if (owner && body.binding?.revision !== owner.revision && !replay)
        return json({
          status: "conflict",
          message:
            "That file has a newer save. Choose a different destination.",
        });
      const expected = priorCreation
        ? priorCreation.expected
        : allocatedWithKey
          ? await createdBaseline(path, bytes)
          : (owner?.bytes ?? (await existingBytes(path)));
      if (
        body.saveAs === true &&
        expected &&
        library &&
        !replay &&
        !priorCreation
      ) {
        if (
          !(await dialogs.confirm?.(
            `Replace ${path}? Its current Project and history will first be kept in the project's recycle area.`,
          ))
        )
          return json({ status: "cancelled" });
        await library.archiveReplacement(path, expected);
      }
      if (choose && creation)
        await creations.reserve(
          creation,
          path,
          expected,
          bytes,
          replaceCreation,
        );
      const historyWarning = await commitProjectFile(
        path,
        expected,
        bytes,
        library,
        body.saveAs === true,
      );
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
      const warning = (await remember(path)) ?? historyWarning;
      return json({
        status: "saved",
        file: receipt(grant),
        ...(warning ? { warning } : {}),
      });
    } catch (error) {
      if (error instanceof CreationCancelled)
        return json({ status: "cancelled" });
      if (error instanceof FileRequestError)
        return json({ message: error.message }, error.status);
      return json({
        status: error instanceof FileConflict ? "conflict" : "failed",
        message:
          error instanceof Error ? error.message : "File operation failed",
      });
    } finally {
      busy = false;
    }
  };
}
