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
  it("selects an analysis table without downloading other representations or losing the directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "icm-select-base-"));
    try {
      const base = await LocalWorkspace.open(scope, root);
      const files: ArtifactRef[] = [
        { ...file("csv0", "a"), role: "table", analysisIndex: 0 },
        { ...file("csv1", "b"), role: "table", analysisIndex: 1 },
        { ...file("raw", "c"), role: "raw" },
      ];
      const directory = catalog(files);
      directory.datasets = [0, 1].map((analysisIndex) => ({
        id: `analysis-${analysisIndex}`,
        analysisIndex,
        analysis: "dc",
        plotName: "DC",
        pointCount: 1,
        signals: [],
        representations: [
          {
            artifactId: `csv${analysisIndex}`,
            fileId: `csv${analysisIndex}`,
            selector: "",
          },
        ],
      }));
      const fetch = vi.fn(async () => new Response("b"));
      const reply = await base.sync(directory, fetch, undefined, {
        analysisIndex: 1,
        roles: ["table"],
      });
      expect(reply.files).toHaveLength(1);
      expect(reply.transfer).toEqual({
        selected: 1,
        downloaded: 1,
        reused: 0,
        remaining: 0,
      });
      const again = await base.sync(directory, fetch, undefined, {
        analysisIndex: 1,
        roles: ["table"],
      });
      expect(again.transfer).toEqual({
        selected: 1,
        downloaded: 0,
        reused: 1,
        remaining: 0,
      });
      expect(again.workspaceFileCount).toBe(1);
      expect(fetch.mock.calls).toHaveLength(1);
      expect(await readFile(reply.files[0]!.outputPath, "utf8")).toBe("b");
      expect(
        JSON.parse(await readFile(base.indexPath, "utf8")).runs[0].files,
      ).toHaveLength(3);
      await expect(
        base.sync(directory, fetch, undefined, { analysisIndex: 9 }),
      ).rejects.toThrow("WORKSPACE_ANALYSIS_NOT_IN_RUN");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("downloads two files concurrently and settles partial evidence before returning", async () => {
    const root = await mkdtemp(join(tmpdir(), "icm-concurrent-base-"));
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const base = await LocalWorkspace.open(scope, root);
      const started: string[] = [];
      const pending = base.sync(
        catalog([file("one", "a"), file("two", "b"), file("three", "c")]),
        async (ref) => {
          started.push(ref.id);
          await ready;
          if (ref.id === "one") throw new Error("offline");
          return new Response("b");
        },
      );
      await vi.waitFor(() => expect(started).toHaveLength(2));
      release();
      const result = await pending;
      expect(started.sort()).toEqual(["one", "two"]);
      expect(result).toMatchObject({ ok: false, error: { fileId: "one" } });
      expect(result.files).toHaveLength(1);
      expect(result.transfer).toEqual({
        selected: 3,
        downloaded: 1,
        reused: 0,
        remaining: 2,
      });
      expect(await readFile(result.files[0]!.outputPath, "utf8")).toBe("b");
      expect(await LocalWorkspace.inspect(root)).toMatchObject({
        workspaceFileCount: 1,
      });
    } finally {
      release();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("defaults to a Project/host-isolated directory stable across authorization sessions", () => {
    const first = defaultWorkspacePath(scope);
    expect(first).toBe(defaultWorkspacePath({ ...scope, sessionId: "other" }));
    expect(first).not.toBe(
      defaultWorkspacePath({ ...scope, serverUrl: "https://preview.test" }),
    );
    const projectId = "11111111-2222-3333-4444-555555555555";
    expect(defaultWorkspacePath({ ...scope, projectId })).toContain(projectId);
    expect(defaultWorkspacePath({ ...scope, projectId })).not.toBe(first);
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
        workspaceFileCount: 2,
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
  it("reopens the default base after a process restart without downloading again", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "icm-default-base-"));
    try {
      const first = await LocalWorkspace.open(
        scope,
        defaultWorkspacePath(scope, cwd),
      );
      const files = [file("one", "saved")];
      await first.sync(catalog(files), async () => new Response("saved"));
      vi.resetModules();
      const fresh = await import("./local-workspace.js");
      const renewed = { ...scope, sessionId: "renewed" };
      const reopened = await fresh.LocalWorkspace.open(
        renewed,
        fresh.defaultWorkspacePath(renewed, cwd),
      );
      const fetch = vi.fn(async () => {
        throw new Error("offline");
      });
      const result = await reopened.sync(catalog(files), fetch);
      expect(result.files[0]?.reused).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
      expect(await readFile(result.files[0]!.outputPath, "utf8")).toBe("saved");
    } finally {
      await rm(cwd, { recursive: true, force: true });
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
        workspaceFileCount: 1,
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
