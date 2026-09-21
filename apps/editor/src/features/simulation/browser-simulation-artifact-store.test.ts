import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { SimulationFiles } from "@icm/simulation-service/files";
import { createBrowserSimulationArtifactStore } from "./browser-simulation-artifact-store";
import { SimulationService } from "@icm/simulation-service";
import { createEmptyProject } from "@icm/model";

describe("persistent simulation evidence", () => {
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
