import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocalWorkspace, defaultWorkspacePath } from "./local-workspace.js";
import type {
  ArtifactRef,
  ResultCatalog,
} from "@icm/simulation-service/contract";

const scope = {
  serverUrl: "https://canvas.test",
  sessionId: "session",
  projectId: "project",
};
const file = (id: string, text: string): ArtifactRef => ({
  id,
  fileId: id,
  name: "out.raw",
  mediaType: "text/plain",
  byteLength: Buffer.byteLength(text),
  sha256: createHash("sha256").update(text).digest("hex"),
});
const catalog = (files: ArtifactRef[]): ResultCatalog => ({
  schemaVersion: 1,
  runId: "run",
  preparedId: "prepared",
  inputRevision: "rev",
  execution: "completed",
  collection: "complete",
  files,
  datasets: [],
});
describe("local simulation workspace", () => {
  it("defaults to a session/host-isolated directory without requesting a path", () => {
    const first = defaultWorkspacePath(scope);
    expect(first).not.toBe(
      defaultWorkspacePath({ ...scope, sessionId: "other" }),
    );
    expect(first).not.toBe(
      defaultWorkspacePath({ ...scope, serverUrl: "https://preview.test" }),
    );
    const sessionId = "11111111-2222-3333-4444-555555555555";
    expect(defaultWorkspacePath({ ...scope, sessionId })).toContain(sessionId);
  });
  it("syncs same-named files, preserves stable paths after remote locator changes, and is readable offline", async () => {
    const root = await mkdtemp(join(tmpdir(), "icm-base-"));
    try {
      const base = await LocalWorkspace.open(scope, root);
      const files = [file("one", "a"), file("two", "b")];
      const first = await base.sync(
        catalog(files),
        async (ref) => new Response(ref.fileId === "one" ? "a" : "b"),
      );
      expect(first.ok).toBe(true);
      expect(first.files).toHaveLength(2);
      expect(first.files[0]!.outputPath).not.toBe(first.files[1]!.outputPath);
      for (const item of first.files)
        expect(relative(root, item.outputPath).startsWith("..")).toBe(false);
      const offline = vi.fn(async () => {
        throw new Error("offline");
      });
      vi.resetModules();
      const reloaded = await import("./local-workspace.js");
      const reopened = await reloaded.LocalWorkspace.open(
        { ...scope, sessionId: "new-authorized-session" },
        root,
      );
      const second = await reopened.sync(
        catalog(files.map((ref) => ({ ...ref, id: `new-${ref.id}` }))),
        offline,
      );
      expect(second.files.every((item) => item.reused)).toBe(true);
      expect(offline).not.toHaveBeenCalled();
      expect(await LocalWorkspace.inspect(root)).toMatchObject({
        basePath: root,
        downloadedFiles: 2,
        runs: [{ runId: "run", files: 2 }],
      });
      expect(
        JSON.parse(await readFile(join(root, "index.json"), "utf8")).runs[0]
          .files[0].id,
      ).toBe("new-one");
      expect(await readdir(root)).toEqual(
        expect.arrayContaining(["index.json", "runs", "work"]),
      );
      await expect(
        LocalWorkspace.open({ ...scope, projectId: "other" }, root),
      ).rejects.toThrow("WORKSPACE_PROJECT_MISMATCH");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("supports directory-only sync and records partial failure without losing completed files", async () => {
    const root = await mkdtemp(join(tmpdir(), "icm-base-"));
    try {
      const base = await LocalWorkspace.open(scope, root);
      const files = [file("one", "a"), file("two", "b")];
      const fetch = vi.fn(async (ref: ArtifactRef) => {
        if (ref.id === "two") throw new Error("offline");
        return new Response("a");
      });
      expect((await base.sync(catalog(files), fetch, [])).ok).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
      const partial = await base.sync(catalog(files), fetch);
      expect(partial).toMatchObject({
        ok: false,
        downloadedFiles: 1,
        error: { fileId: "two" },
      });
      expect(await readFile(partial.files[0]!.outputPath, "utf8")).toBe("a");
      await expect(
        base.sync(catalog(files), fetch, ["unknown"]),
      ).rejects.toThrow("WORKSPACE_FILE_NOT_IN_RUN");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("never replaces an unrelated index file", async () => {
    const root = await mkdtemp(join(tmpdir(), "icm-base-"));
    try {
      await writeFile(join(root, "index.json"), "user file");
      await expect(LocalWorkspace.open(scope, root)).rejects.toThrow(
        "WORKSPACE_INDEX_INVALID",
      );
      expect(await readFile(join(root, "index.json"), "utf8")).toBe(
        "user file",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
