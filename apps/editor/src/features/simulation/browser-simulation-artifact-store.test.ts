import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { SimulationFiles } from "@icm/simulation-service/files";
import { createBrowserSimulationArtifactStore } from "./browser-simulation-artifact-store";
import { createBrowserSimulationArchiveStore } from "./browser-simulation-archive-store";
import { SimulationService } from "@icm/simulation-service";
import { createEmptyProject } from "@icm/model";

describe("persistent simulation evidence", () => {
  it("prunes only new unarchived cache catalogs and leaves legacy history intact", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore("project", factory)!;
    let storedAt = 0;
    const files = new SimulationFiles(
      () => storedAt++,
      undefined,
      undefined,
      store,
    );
    for (let index = 0; index < 32; index++)
      await files.saveCatalog({
        schemaVersion: 1,
        runId: `cache-${index}`,
        preparedId: "prepared",
        inputRevision: "rev",
        retentionPolicy: "cache",
        execution: "completed",
        collection: "complete",
        files: [],
        datasets: [],
      });
    await store.saveCatalog!({
      catalog: {
        schemaVersion: 1,
        runId: "legacy",
        preparedId: "prepared",
        inputRevision: "rev",
        execution: "completed",
        collection: "complete",
        files: [],
        datasets: [],
      },
      storedAt: 0,
    });
    const archives = createBrowserSimulationArchiveStore({
      idbFactory: factory,
    });
    expect(await archives.pruneCache("project")).toEqual({
      ok: true,
      value: [],
    });
    const retained = (await store.catalogs!()).map(
      (entry) => entry.catalog.runId,
    );
    expect(retained).toContain("legacy");
    expect(retained).not.toContain("cache-0");
    expect(retained).toHaveLength(31);
    expect(
      (await files.history(100)).runs.map((entry) => entry.runId),
    ).not.toContain("cache-0");
    expect(await files.catalog("cache-0")).toBeUndefined();
    archives.close();
  });
  it("reports actual Project usage and deletes an exact catalog without losing shared evidence", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore("project", factory)!;
    const files = new SimulationFiles(Date.now, undefined, undefined, store);
    const ref = await files.put("shared.raw", "text/plain", "data", {
      role: "raw",
    });
    expect(await store.usage!()).toMatchObject({
      fileCount: 1,
      unreferencedFileCount: 1,
      unreferencedBytes: 4,
    });
    const catalog = {
      schemaVersion: 1 as const,
      runId: "run-a",
      preparedId: "prepared",
      inputRevision: "rev",
      source: {
        kind: "project-folder" as const,
        folderId: "folder",
        expectedStructureRevision: 3,
      },
      execution: "completed" as const,
      collection: "complete" as const,
      files: [ref],
      datasets: [],
    };
    await files.saveCatalog(catalog);
    await files.saveCatalog({ ...catalog, runId: "run-b" });
    const service = new SimulationService(
      files,
      {
        capabilities: vi.fn(),
        execute: vi.fn(),
        cancel: vi.fn(),
      },
      () => createEmptyProject("project", "Project", "doc"),
    );
    expect(
      await service.handle({ operation: "history-usage" }, "usage"),
    ).toMatchObject({
      ok: true,
      usage: {
        fileCount: 1,
        byteLength: 4,
        unreferencedFileCount: 0,
        catalogCount: 2,
        fileLimit: 4096,
      },
    });
    expect(
      await service.handle({ operation: "history", limit: 2 }, "history"),
    ).toMatchObject({
      ok: true,
      runs: expect.arrayContaining([
        expect.objectContaining({
          runId: "run-a",
          source: expect.objectContaining({
            kind: "project-folder",
            folderId: "folder",
          }),
          retention: "catalog-only",
          fileCount: 1,
          byteLength: 4,
        }),
      ]),
    });
    expect(
      await service.handle(
        { operation: "history-delete", runId: "run-a", dryRun: true },
        "preview",
      ),
    ).toMatchObject({ ok: true, deletion: { deleted: false, dryRun: true } });
    expect(await files.catalog("run-a")).toBeDefined();
    expect(
      await service.handle(
        { operation: "history-delete", runId: "run-a" },
        "delete-a",
      ),
    ).toMatchObject({
      ok: true,
      deletion: {
        deleted: true,
        cleanupDeferred: expect.any(Boolean),
        reclaimedFiles: 0,
      },
    });
    expect(await files.catalog("run-a")).toBeUndefined();
    expect(await files.readArtifact(ref.id)).toMatchObject({
      ok: true,
      text: "data",
    });
    expect(await store.reclaim([], [])).toEqual({ files: 0, bytes: 0 });
    expect((await store.get(ref.id))?.text).toBe("data");
    const finalDelete = await service.handle(
      { operation: "history-delete", runId: "run-b" },
      "delete-b",
    );
    const reclaimedByDelete =
      finalDelete.ok && "deletion" in finalDelete
        ? finalDelete.deletion.reclaimedFiles
        : 0;
    expect(await files.readArtifact(ref.id)).toMatchObject({
      ok: false,
      error: { code: "ARTIFACT_UNAVAILABLE" },
    });
    expect(
      await files.handle({ action: "download", artifactId: ref.id }),
    ).toMatchObject({
      ok: false,
      error: { code: "ARTIFACT_UNAVAILABLE" },
    });
    const reclaimedAfter = await store.reclaim([], []);
    expect(reclaimedByDelete + reclaimedAfter.files).toBe(1);
    expect(await store.get(ref.id)).toBeNull();
  });
  it("requires an explicit saved-result override without weakening dry-run", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore("project", factory)!;
    const files = new SimulationFiles(Date.now, undefined, undefined, store);
    const archiveStore = createBrowserSimulationArchiveStore({
      idbFactory: factory,
    });
    await files.saveCatalog({
      schemaVersion: 1,
      runId: "run-saved",
      preparedId: "prepared",
      inputRevision: "rev",
      execution: "completed",
      collection: "complete",
      files: [],
      datasets: [],
    });
    expect(
      await archiveStore.save({
        schemaVersion: 1,
        id: "archive-saved",
        projectId: "project",
        createdAt: new Date(0).toISOString(),
        retention: "saved",
        presentation: {
          folderId: "folder",
          folderName: "Test",
          analysisLabel: "OP",
          outputs: [],
        },
        prepared: {
          id: "prepared",
          digest: "a".repeat(64),
          inputRevision: "rev",
          expiresAt: 1,
          mode: "structured",
          environment: { profileId: "test" },
          vectors: [],
          outputs: [],
          deviceOperatingPoints: [],
          warnings: [],
          artifactIds: [],
        },
        run: {
          id: "run-saved",
          preparedId: "prepared",
          inputRevision: "rev",
          state: "finished",
        },
        artifacts: [],
        byteLength: 0,
      }),
    ).toMatchObject({ ok: true });
    const service = new SimulationService(
      files,
      { capabilities: vi.fn(), execute: vi.fn(), cancel: vi.fn() },
      () => createEmptyProject("project", "Project", "doc"),
    );
    expect(
      await service.handle(
        { operation: "history-delete", runId: "run-saved", dryRun: true },
        "preview",
      ),
    ).toMatchObject({
      ok: true,
      deletion: { retention: "saved", archiveCount: 1 },
    });
    expect(
      await service.handle(
        { operation: "history-delete", runId: "run-saved" },
        "blocked",
      ),
    ).toMatchObject({ ok: false, error: { code: "RUN_HISTORY_SAVED" } });
    expect((await archiveStore.read("archive-saved")).ok).toBe(true);
    expect(
      await service.handle(
        { operation: "history-delete", runId: "run-saved", includeSaved: true },
        "delete",
      ),
    ).toMatchObject({ ok: true, deletion: { deleted: true, archiveCount: 1 } });
    expect(await archiveStore.read("archive-saved")).toEqual({
      ok: true,
      value: null,
    });
    archiveStore.close();
  });
  it("persists a generated result set through one batch operation", async () => {
    const store = createBrowserSimulationArtifactStore(
      "batch-project",
      new IDBFactory(),
    )!;
    const entries = ["one", "two", "three"].map((id) => ({
      ref: {
        id,
        fileId: id,
        name: `${id}.txt`,
        mediaType: "text/plain",
        byteLength: id.length,
        sha256: id.padEnd(64, "0"),
      },
      text: id,
    }));
    await store.putMany!(entries);
    await expect(
      Promise.all(entries.map(({ ref }) => store.get(ref.id))),
    ).resolves.toEqual(entries.map(({ ref, text }) => ({ ref, text })));
  });
  it("survives a denied storage getter and reports failure on I/O", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    const denied = new DOMException("storage blocked", "InvalidStateError");
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        throw denied;
      },
    });
    try {
      const store = createBrowserSimulationArtifactStore("project");
      expect(store).toBeDefined();
      await expect(store!.get("missing")).rejects.toBe(denied);
      await expect(store!.referencedArtifactIds()).rejects.toBe(denied);
    } finally {
      if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
      else Reflect.deleteProperty(globalThis, "indexedDB");
    }
  });
  it("rolls back partial reclamation and preserves removal markers for retry", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore("project", factory)!;
    const ref = {
      id: "file",
      name: "result.raw",
      mediaType: "text/plain",
      byteLength: 4,
      sha256: "a".repeat(64),
    };
    await store.put(ref, "data");
    await store.saveCatalog!({
      catalog: {
        schemaVersion: 1,
        runId: "run",
        preparedId: "prepared",
        inputRevision: "rev",
        execution: "completed",
        collection: "complete",
        files: [ref],
        datasets: [],
      },
      storedAt: 1,
    });
    await store.queueRunRemoval("run");
    const original = IDBObjectStore.prototype.delete;
    const fault = vi
      .spyOn(IDBObjectStore.prototype, "delete")
      .mockImplementation(function (this: IDBObjectStore, key) {
        if (this.name === "files")
          throw new Error("injected reclamation failure");
        return original.call(this, key);
      });
    try {
      await expect(store.reclaim([], [])).rejects.toThrow(
        "injected reclamation failure",
      );
    } finally {
      fault.mockRestore();
    }
    expect((await store.get("file"))?.text).toBe("data");
    expect(await store.catalogs!()).toHaveLength(1);
    expect(await store.reclaim([], [])).toEqual({ files: 1, bytes: 4 });
    expect(await store.catalogs!()).toEqual([]);
    expect(await store.get("file")).toBeNull();
  });
  it("upgrades the previous database without rewriting bodies or catalogs", async () => {
    const factory = new IDBFactory();
    const ref = {
      id: "old",
      name: "old.raw",
      mediaType: "text/plain",
      byteLength: 3,
      sha256: "a".repeat(64),
    };
    const catalog = {
      schemaVersion: 1 as const,
      runId: "old-run",
      preparedId: "prepared",
      inputRevision: "rev",
      execution: "completed" as const,
      collection: "complete" as const,
      files: [ref],
      datasets: [],
    };
    await new Promise<void>((resolve, reject) => {
      const request = factory.open("analog-canvas-simulation-files", 2);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("bodies");
        request.result
          .createObjectStore("files")
          .createIndex("projectId", "projectId");
        request.result
          .createObjectStore("catalogs")
          .createIndex("projectId", "projectId");
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["bodies", "files", "catalogs"], "readwrite");
        tx.objectStore("bodies").put(new Blob(["old"]), ["project", "old"]);
        tx.objectStore("files").put({ projectId: "project", ref }, [
          "project",
          "old",
        ]);
        tx.objectStore("catalogs").put(
          { projectId: "project", catalog, storedAt: 1 },
          ["project", "old-run"],
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
    const store = createBrowserSimulationArtifactStore("project", factory)!;
    expect(await store.get("old")).toEqual({ ref, text: "old" });
    expect(await store.catalogs!()).toEqual([{ catalog, storedAt: 1 }]);
    await store.retainReferences("archive", ["old"]);
    await store.releaseReferences("archive");
    expect(await store.referencedArtifactIds()).toEqual(["old"]);
  });
  it("retains shared storage references atomically and isolates owners by Project", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore("project", factory)!;
    const files = new SimulationFiles(Date.now, undefined, undefined, store);
    const ref = await files.put("shared.raw", "text/plain", "evidence");
    await store.retainReferences("archive-a", [ref.id]);
    await store.retainReferences("archive-b", [ref.id, ref.id]);
    await expect(
      store.retainReferences("archive-b", ["missing"]),
    ).rejects.toThrow("ARTIFACT_UNAVAILABLE");
    await store.releaseReferences("archive-a");
    const reopened = createBrowserSimulationArtifactStore("project", factory)!;
    expect(await reopened.referencedArtifactIds()).toEqual([ref.id]);
    const other = createBrowserSimulationArtifactStore("other", factory)!;
    await other.releaseReferences("archive-b");
    expect(await other.referencedArtifactIds()).toEqual([]);
    expect(await reopened.referencedArtifactIds()).toEqual([ref.id]);
    await reopened.releaseReferences("archive-b");
    expect(await reopened.referencedArtifactIds()).toEqual([]);
    // Releasing one owner is not permission to delete file contents.
    expect((await reopened.get(ref.id))?.text).toBe("evidence");
  });
  it("discovers retained catalogs after host replacement without reading bodies or starting executions", async () => {
    const factory = new IDBFactory();
    let now = 100;
    const files = new SimulationFiles(
      () => now,
      undefined,
      undefined,
      createBrowserSimulationArtifactStore("project", factory),
    );
    const artifact = await files.put("run.raw", "text/plain", "original", {
      role: "raw",
    });
    const catalog = {
      schemaVersion: 1 as const,
      runId: "run-one",
      preparedId: "prep",
      inputRevision: "rev",
      execution: "completed" as const,
      collection: "complete" as const,
      files: [artifact],
      datasets: [],
    };
    expect(await files.saveCatalog(catalog)).toBe(true);
    now++;
    await files.saveCatalog({ ...catalog, runId: "run-two" });
    files.clear();
    const backend = createBrowserSimulationArtifactStore("project", factory)!;
    const get = vi.spyOn(backend, "get");
    const reopened = new SimulationFiles(
      Date.now,
      undefined,
      undefined,
      backend,
    );
    const executor = {
      capabilities: vi.fn(async () => {
        throw Error("must not execute");
      }),
      execute: vi.fn(async () => {
        throw Error("must not execute");
      }),
      cancel: vi.fn(async () => {}),
    };
    const service = new SimulationService(reopened, executor, () =>
      createEmptyProject("project", "Project", "doc"),
    );
    const first = await service.handle(
      { operation: "history", limit: 1 },
      "history",
    );
    expect(first).toMatchObject({
      ok: true,
      runs: [{ runId: "run-two", storage: "persistent" }],
      nextCursor: "run-two",
    });
    expect(
      await service.handle(
        { operation: "history", limit: 1, cursor: "run-two" },
        "next",
      ),
    ).toMatchObject({
      ok: true,
      runs: [{ runId: "run-one" }],
      nextCursor: null,
    });
    expect(
      await service.handle(
        { operation: "catalog", runId: "run-one" },
        "catalog",
      ),
    ).toEqual({ ok: true, catalog });
    expect(
      await service.handle({ operation: "read", runId: "run-one" }, "read"),
    ).toMatchObject({
      ok: true,
      run: {
        id: "run-one",
        state: "finished",
        resultPreview: true,
        artifacts: [artifact],
      },
    });
    expect(get).not.toHaveBeenCalled();
    expect(
      await service.handle({ operation: "cancel", runId: "run-one" }, "cancel"),
    ).toMatchObject({ ok: false });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(executor.cancel).not.toHaveBeenCalled();
    expect(await reopened.readArtifact(artifact.id)).toMatchObject({
      ok: true,
      text: "original",
    });
    const other = new SimulationFiles(
      Date.now,
      undefined,
      undefined,
      createBrowserSimulationArtifactStore("other", factory),
    );
    expect(await other.history(10)).toEqual({ runs: [], nextCursor: null });
    expect(await other.catalog("run-one")).toBeUndefined();
  });
  it("spills a file above the retired 64 MiB file limit and reopens it after clear without crossing Projects", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore("project", factory)!;
    const get = vi.spyOn(store, "get");
    let now = 0;
    const files = new SimulationFiles(() => now, undefined, undefined, store);
    const text = "0123456789abcdef".repeat(65 * 65536);
    const ref = await files.put("large.raw", "text/plain", text, {
      role: "raw",
    });
    now = 24 * 60 * 60 * 1000;
    expect(await files.readArtifact(ref.id)).toMatchObject({ ok: true, text });
    expect(get).toHaveBeenCalledTimes(1); // body was evicted from the 16 MiB cache
    files.clear();
    const durable = createBrowserSimulationArtifactStore("project", factory)!;
    const write = vi.spyOn(durable, "put");
    const reopened = new SimulationFiles(
      Date.now,
      undefined,
      undefined,
      durable,
    );
    const restored = await reopened.readArtifact(ref.id);
    expect(restored).toEqual({ ok: true, artifact: ref, text });
    expect(
      await reopened.put(ref.name, ref.mediaType, text, {
        fileId: ref.fileId!,
        role: "raw",
      }),
    ).toEqual(ref);
    expect(write).not.toHaveBeenCalled();
    await expect(
      reopened.put(ref.name, ref.mediaType, "changed", {
        fileId: ref.fileId!,
        role: "raw",
      }),
    ).rejects.toThrow("ARTIFACT_ID_CONFLICT");
    const other = new SimulationFiles(
      Date.now,
      undefined,
      undefined,
      createBrowserSimulationArtifactStore("other-project", factory),
    );
    expect(await other.readArtifact(ref.id)).toMatchObject({
      ok: false,
      error: { code: "ARTIFACT_UNAVAILABLE" },
    });
    expect(
      await reopened.handle({
        action: "artifact",
        artifactId: ref.id,
        maxChars: 5,
      }),
    ).toMatchObject({
      ok: true,
      text: "01234",
      nextOffset: 5,
    });
    const publisher = vi.fn(
      async () => "/api/agent/sessions/new/artifacts/file",
    );
    reopened.setArtifactPublisher(publisher);
    await vi.waitFor(async () => {
      expect(
        await reopened.handle({ action: "download", artifactId: ref.id }),
      ).toMatchObject({
        ok: true,
        download: { path: "/api/agent/sessions/new/artifacts/file" },
      });
    });
    expect(publisher).toHaveBeenCalledWith(ref, text);
    expect(publisher).toHaveBeenCalledTimes(1);
  });

  it("rejects immutable identity collisions and storage failures instead of reporting durable success", async () => {
    const store = createBrowserSimulationArtifactStore(
      "project",
      new IDBFactory(),
    )!;
    const files = new SimulationFiles(Date.now, undefined, undefined, store);
    const ref = await files.put("one.raw", "text/plain", "one");
    await store.put(ref, "one");
    await expect(
      store.put({ ...ref, name: "another.raw" }, "one"),
    ).rejects.toThrow("ARTIFACT_ID_CONFLICT");
    expect((await store.get(ref.id))?.text).toBe("one");
    const failing = new SimulationFiles(Date.now, undefined, undefined, {
      put: async () => {
        throw new DOMException("Full", "QuotaExceededError");
      },
      get: async () => {
        throw new Error("Unavailable");
      },
    });
    await expect(failing.put("x", "text/plain", "x")).rejects.toThrow(
      "ARTIFACT_STORAGE_UNAVAILABLE",
    );
    expect(await failing.readArtifact("unknown")).toMatchObject({
      ok: false,
      error: { code: "ARTIFACT_STORAGE_UNAVAILABLE" },
    });
  });
});
