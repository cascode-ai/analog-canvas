import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { downloadSimulationArtifact } from "./artifact-download.js";
import type { ArtifactRef } from "@icm/simulation-service/contract";

const ref = (text: string): ArtifactRef => ({
  id: "locator",
  fileId: "file",
  name: "out.raw",
  mediaType: "text/plain",
  byteLength: Buffer.byteLength(text),
  sha256: createHash("sha256").update(text).digest("hex"),
});
describe("artifact byte download", () => {
  it("downloads beyond the old RPC ceiling and reuses a verified file without a network request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "icm-download-"));
    try {
      const text = "数据".repeat(500_000);
      const path = join(directory, "out.raw");
      const fetch = vi.fn(async () => new Response(text));
      expect(
        await downloadSimulationArtifact(ref(text), path, fetch),
      ).toMatchObject({ ok: true, reused: false, outputPath: path });
      expect(await readFile(path, "utf8")).toBe(text);
      expect(
        await downloadSimulationArtifact(ref(text), path, fetch),
      ).toMatchObject({ reused: true });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("preserves a short transfer for a byte-range retry and never exposes the partial destination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "icm-download-"));
    try {
      const path = join(directory, "out.raw");
      const artifact = ref("abcdefgh");
      await expect(
        downloadSimulationArtifact(
          artifact,
          path,
          async () => new Response("abcd"),
        ),
      ).rejects.toThrow("INCOMPLETE_DOWNLOAD");
      await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
      const fetch = vi.fn(
        async (offset: number) =>
          new Response("efgh", {
            status: 206,
            headers: { "content-range": `bytes ${offset}-7/8` },
          }),
      );
      await downloadSimulationArtifact(artifact, path, fetch);
      expect(fetch).toHaveBeenCalledWith(4);
      expect(await readFile(path, "utf8")).toBe("abcdefgh");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("rejects corrupt content and preserves user-owned output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "icm-download-"));
    try {
      const path = join(directory, "out.raw");
      await expect(
        downloadSimulationArtifact(
          ref("good"),
          path,
          async () => new Response("evil"),
        ),
      ).rejects.toThrow("FILE_INTEGRITY_FAILED");
      await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
      await writeFile(path, "user");
      const fetch = vi.fn(async () => new Response("good"));
      await expect(
        downloadSimulationArtifact(ref("good"), path, fetch),
      ).rejects.toThrow("OUTPUT_ALREADY_EXISTS");
      expect(fetch).not.toHaveBeenCalled();
      expect(await readFile(path, "utf8")).toBe("user");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
