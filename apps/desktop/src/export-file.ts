import { open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { APP_ORIGIN } from "./app-protocol.js";

const MAX_EXPORT_BYTES = 100 * 1024 * 1024;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

/** Only the native dialog supplies a path; the renderer supplies bytes/name. */
export function createExportHandler(
  choosePath: (name: string) => Promise<string | null>,
) {
  let busy = false;
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST")
      return json({ message: "POST required" }, 405);
    const origin =
      (request as Request & { initiatorOrigin?: string }).initiatorOrigin ??
      request.headers.get("origin");
    if (origin !== APP_ORIGIN) return json({ message: "Wrong origin" }, 403);
    if (busy) return json({ message: "Another export is in progress" }, 409);
    busy = true;
    let temporary: string | undefined;
    try {
      const name = decodeURIComponent(
        request.headers.get("x-export-name") ?? "",
      );
      if (
        !name ||
        name.length > 200 ||
        basename(name) !== name ||
        /[\x00-\x1f<>:"/\\|?*]/u.test(name)
      )
        return json({ message: "Invalid export name" }, 400);
      const reader = request.body?.getReader();
      if (!reader) return json({ message: "Missing bytes" }, 400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > MAX_EXPORT_BYTES) {
          await reader.cancel();
          return json({ message: "Export exceeds 100 MiB" }, 413);
        }
        chunks.push(chunk.value);
      }
      const path = await choosePath(name);
      if (path === null) return json({ status: "cancelled" });
      temporary = join(
        dirname(path),
        `.analog-canvas-export-${randomUUID()}.tmp`,
      );
      const file = await open(temporary, "wx");
      try {
        await file.writeFile(Buffer.concat(chunks));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
      temporary = undefined;
      return json({ status: "saved" });
    } catch (error) {
      return json({
        status: "failed",
        message: error instanceof Error ? error.message : "File export failed",
      });
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
      busy = false;
    }
  };
}
