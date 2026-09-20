import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ArtifactRef } from "@icm/simulation-service/contract";

const active = new Set<string>();
async function digestFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function info(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
/** Stream to a resumable sibling, then publish without replacing user files. */
export async function downloadSimulationArtifact(
  ref: ArtifactRef,
  path: string,
  fetchBytes: (offset: number) => Promise<Response>,
) {
  const outputPath = resolve(path);
  if (active.has(outputPath)) throw new Error("ARTIFACT_DOWNLOAD_BUSY");
  active.add(outputPath);
  try {
    const existing = await info(outputPath);
    if (existing) {
      if (
        existing.isFile() &&
        existing.size === ref.byteLength &&
        (await digestFile(outputPath)) === ref.sha256
      )
        return { ok: true, outputPath, ...ref, reused: true };
      throw new Error("OUTPUT_ALREADY_EXISTS");
    }
    await mkdir(dirname(outputPath), { recursive: true });
    const partial = join(
      dirname(outputPath),
      `.${basename(outputPath)}.${ref.sha256}.part`,
    );
    const saved = await info(partial);
    if (saved && (!saved.isFile() || saved.size > ref.byteLength))
      throw new Error("INVALID_PARTIAL_FILE");
    const handle = await open(partial, saved ? "r+" : "wx");
    let offset = saved?.size ?? 0;
    try {
      if (offset < ref.byteLength) {
        const response = await fetchBytes(offset);
        if (
          !response.body ||
          (response.status !== 200 && response.status !== 206)
        )
          throw new Error("INVALID_DOWNLOAD_RESPONSE");
        if (
          response.status === 206 &&
          response.headers.get("content-range") !==
            `bytes ${offset}-${ref.byteLength - 1}/${ref.byteLength}`
        ) {
          await response.body.cancel();
          throw new Error("INVALID_DOWNLOAD_RANGE");
        }
        if (response.status === 200 && offset) {
          await handle.truncate(0);
          offset = 0;
        }
        const reader = response.body.getReader();
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (offset + chunk.value.byteLength > ref.byteLength) {
              await handle.truncate(0);
              throw new Error("FILE_INTEGRITY_FAILED");
            }
            let written = 0;
            while (written < chunk.value.length) {
              const result = await handle.write(
                chunk.value,
                written,
                chunk.value.length - written,
                offset,
              );
              if (!result.bytesWritten) throw new Error("FILE_WRITE_FAILED");
              written += result.bytesWritten;
              offset += result.bytesWritten;
            }
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (offset !== ref.byteLength) throw new Error("INCOMPLETE_DOWNLOAD");
    if ((await digestFile(partial)) !== ref.sha256) {
      await unlink(partial);
      throw new Error("FILE_INTEGRITY_FAILED");
    }
    // Same-directory hard-link publication is atomic and fails if the destination
    // appeared meanwhile. Unlike rename/writeFile it cannot overwrite user data.
    await link(partial, outputPath);
    await unlink(partial);
    return { ok: true, outputPath, ...ref, reused: false };
  } finally {
    active.delete(outputPath);
  }
}
