import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";
import {
  COMPONENT_LIBRARY_ID,
  parseSharedComponentPayload,
  type SharedComponent,
} from "../../editor/src/features/user-components/component-library-contract";
import { parseSharedComponentEntry } from "../../editor/src/features/user-components/component-library-entry";
import { APP_ORIGIN } from "./app-protocol.js";
import { readLimited, writeDurable } from "./durable-files.js";

const MAX_BYTES = 16 * 1024 * 1024;
const inputSchema = z.object({
  id: z.string().regex(COMPONENT_LIBRARY_ID).optional(),
  revision: z.number().int().min(0).optional(),
  definition: z.unknown().optional(),
  circuit: z.unknown().optional(),
  idempotencyKey: z.string().min(1).max(100).optional(),
});
type SavedEntry = SharedComponent & {
  receipt?: { key: string; request: string };
};
class LibraryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
async function inputBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new LibraryRequestError("Missing component request", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > 256 * 1024) {
      await reader.cancel();
      throw new LibraryRequestError("Component request is too large", 413);
    }
    chunks.push(chunk.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/** Private, revision-checked library. Project captures never depend on this file. */
export function createLocalComponentHandler(path: string) {
  let pending: Promise<unknown> = Promise.resolve();
  async function load(): Promise<SavedEntry[]> {
    let bytes: Buffer;
    try {
      bytes = await readLimited(path, MAX_BYTES);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const stored = z
      .object({ format: z.literal(1), entries: z.array(z.unknown()).max(500) })
      .parse(JSON.parse(bytes.toString("utf8")));
    const entries = stored.entries.map((value) => {
      const entry = parseSharedComponentEntry(value);
      const { receipt } = z
        .object({
          receipt: z
            .object({ key: z.string(), request: z.string() })
            .optional(),
        })
        .parse(value);
      return { ...entry, ...(receipt ? { receipt } : {}) };
    });
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
      throw Error(
        "Duplicate local component identities. Restore the library from a backup.",
      );
    return entries;
  }
  async function write(entries: SavedEntry[]) {
    const text = JSON.stringify({ format: 1, entries });
    if (entries.length > 500 || Buffer.byteLength(text) > MAX_BYTES)
      throw Error(
        "The local component library has reached its storage limit, including removed components. Back up components.json before managing the library outside the application.",
      );
    await mkdir(dirname(path), { recursive: true });
    await writeDurable(path, text);
  }
  async function handle(request: Request): Promise<Response> {
    const origin =
      (request as Request & { initiatorOrigin?: string }).initiatorOrigin ??
      request.headers.get("origin");
    if (origin !== APP_ORIGIN) return json({ error: "Wrong origin" }, 403);
    if (request.method !== "POST") return json({ error: "POST required" }, 405);
    try {
      const action = new URL(request.url).pathname.slice(
        "/desktop/components/".length,
      );
      const input = inputSchema.parse(await inputBody(request));
      const entries = await load();
      const publicEntry = ({ receipt: _receipt, ...entry }: SavedEntry) =>
        entry;
      if (action === "list") return json({ entries: entries.map(publicEntry) });
      if (!input.id)
        throw new LibraryRequestError("Component identity required", 400);
      const previous = entries.find((entry) => entry.id === input.id);
      if (action === "read") {
        if (!previous)
          throw new LibraryRequestError("Local component not found", 404);
        return json({ entry: publicEntry(previous) });
      }
      if (
        action !== "save" &&
        action !== "delete" &&
        action !== "restore" &&
        action !== "check"
      )
        throw new LibraryRequestError("Unknown component operation", 404);
      let payload;
      if (action === "save")
        payload = parseSharedComponentPayload({
          definition: input.definition,
          ...(input.circuit === undefined ? {} : { circuit: input.circuit }),
        });
      const fingerprint = createHash("sha256")
        .update(JSON.stringify([action, input.revision, payload]))
        .digest("hex");
      if (
        action === "save" &&
        input.idempotencyKey &&
        previous?.receipt?.key === input.idempotencyKey
      ) {
        if (previous.receipt.request !== fingerprint)
          throw new LibraryRequestError(
            "This save identity was used for different content",
            409,
          );
        return json({ entry: publicEntry(previous) });
      }
      if (input.revision !== (previous?.revision ?? 0))
        throw new LibraryRequestError(
          "This local component changed. Reopen it before saving or placing.",
          409,
        );
      if (action === "check") {
        if (!previous || previous.status === "deleted")
          throw new LibraryRequestError(
            "Local component is no longer available",
            409,
          );
        return json({ entry: publicEntry(previous) });
      }
      if (action !== "save" && !previous)
        throw new LibraryRequestError("Local component not found", 404);
      if (action === "save" && previous?.status === "deleted")
        throw new LibraryRequestError(
          "Restore this component before editing",
          409,
        );
      const savedPayload =
        payload ??
        (previous
          ? {
              definition: previous.definition,
              ...(previous.circuit ? { circuit: previous.circuit } : {}),
            }
          : undefined);
      if (!savedPayload)
        throw new LibraryRequestError("Component content required", 400);
      const time = new Date().toISOString();
      const entry: SavedEntry = {
        id: input.id,
        revision: (previous?.revision ?? 0) + 1,
        authorId: previous?.authorId ?? "desktop-local",
        author: previous?.author ?? "This computer",
        createdAt: previous?.createdAt ?? time,
        updatedAt: time,
        status: action === "delete" ? "deleted" : "shared",
        ...savedPayload,
        ...(action === "save" && input.idempotencyKey
          ? { receipt: { key: input.idempotencyKey, request: fingerprint } }
          : {}),
      };
      await write([...entries.filter((value) => value.id !== input.id), entry]);
      return json({ entry: publicEntry(entry) });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Local components unavailable",
        },
        error instanceof LibraryRequestError ? error.status : 400,
      );
    }
  }
  return (request: Request): Promise<Response> => {
    const response = pending.then(() => handle(request));
    pending = response.catch(() => {});
    return response;
  };
}
