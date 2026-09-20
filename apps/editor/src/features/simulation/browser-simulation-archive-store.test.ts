import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import { createBrowserSimulationArchiveStore } from "./browser-simulation-archive-store";
import { createBrowserSimulationArtifactStore } from "./browser-simulation-artifact-store";
import type { SimulationRunArchiveV1 } from "./simulation-run-archive";

function archive(id: string, createdAt: string): SimulationRunArchiveV1 {
  return {
    schemaVersion: 1,
    id,
    projectId: "project",
    createdAt,
    presentation: {
      folderId: "folder",
      folderName: "Bias",
      analysisLabel: "OP",
      outputs: [],
    },
    prepared: {
      id: `prepared-${id}`,
      digest: "a".repeat(64),
      inputRevision: "revision",
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
      id: `run-${id}`,
      preparedId: `prepared-${id}`,
      inputRevision: "revision",
      state: "finished",
    },
    artifacts: [],
    byteLength: 0,
  };
}

describe("browser simulation archive store", () => {
  it("persists imported evidence before publishing its archive directory entry", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArchiveStore({ idbFactory: factory });
    const record: SimulationRunArchiveV1 = {
      ...archive("imported", new Date(0).toISOString()),
      artifacts: [
        {
          originalId: "imported-body",
          name: "input.cir",
          mediaType: "text/plain",
          byteLength: 4,
          sha256: "c".repeat(64),
          text: "deck",
        },
      ],
      byteLength: 4,
    };
    expect((await store.save(record)).ok).toBe(true);
    const evidence = createBrowserSimulationArtifactStore("project", factory)!;
    expect(await evidence.get("imported-body")).toMatchObject({ text: "deck" });
    expect(await store.read("imported")).toEqual({ ok: true, value: record });
    expect(
      (
        await store.save({
          ...record,
          id: "invalid",
          artifacts: [
            {
              ...record.artifacts[0]!,
              originalId: "invalid-body",
              byteLength: 100,
            },
          ],
        })
      ).ok,
    ).toBe(false);
    expect(await store.list("project")).toMatchObject({
      ok: true,
      value: [{ id: "imported" }],
    });
    store.close();
  });
  it("stores only references, reuses Project evidence, and hydrates portable archives after reopen", async () => {
    const factory = new IDBFactory();
    const evidence = createBrowserSimulationArtifactStore("project", factory)!;
    const ref = {
      id: "current-locator",
      fileId: "stable-file",
      name: "result.raw",
      mediaType: "text/plain",
      byteLength: 4,
      sha256: "a".repeat(64),
      role: "raw" as const,
    };
    await evidence.put(ref, "data");
    const record = {
      ...archive("shared", new Date(0).toISOString()),
      artifacts: [{ ...ref, originalId: "old-locator", text: "data" }],
      byteLength: 4,
    };
    const store = createBrowserSimulationArchiveStore({ idbFactory: factory });
    expect((await store.save(record)).ok).toBe(true);
    expect((await store.save({ ...record, id: "second" })).ok).toBe(true);
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open("analog-canvas-simulation-archives");
      request.onsuccess = () => resolve(request.result);
    });
    const persisted = await new Promise<{ artifacts: { storageId: string }[] }>(
      (resolve) => {
        const request = db
          .transaction("runs")
          .objectStore("runs")
          .get("shared");
        request.onsuccess = () => resolve(request.result);
      },
    );
    db.close();
    expect(persisted.artifacts[0]).not.toHaveProperty("text");
    expect(persisted.artifacts[0]?.storageId).toBe("current-locator");
    expect(await evidence.get("old-locator")).toBeNull();
    store.close();
    const reopened = createBrowserSimulationArchiveStore({
      idbFactory: factory,
    });
    expect(await reopened.read("shared")).toEqual({ ok: true, value: record });
    await reopened.delete("shared");
    expect(await reopened.read("second")).toEqual({
      ok: true,
      value: { ...record, id: "second" },
    });
    // Conflicting evidence cannot replace an already usable archive.
    expect(
      await reopened.save({
        ...record,
        id: "second",
        artifacts: [{ ...record.artifacts[0]!, sha256: "b".repeat(64) }],
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("ARTIFACT_ID_CONFLICT"),
    });
    expect((await reopened.read("second")).ok).toBe(true);
    const filesDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open("analog-canvas-simulation-files");
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = filesDb.transaction("bodies", "readwrite");
      tx.objectStore("bodies").delete(["project", "current-locator"]);
      tx.oncomplete = () => resolve();
    });
    filesDb.close();
    expect(await reopened.read("second")).toMatchObject({
      ok: false,
      message: expect.stringContaining("ARTIFACT_UNAVAILABLE"),
    });
    reopened.close();
  });
  it("lists metadata without scanning file bodies and atomically retains concurrent saves", async () => {
    const store = createBrowserSimulationArchiveStore({
      idbFactory: new IDBFactory(),
    });
    const scan = vi.spyOn(IDBObjectStore.prototype, "getAll");
    const cursor = vi.spyOn(IDBObjectStore.prototype, "openCursor");
    try {
      await store.list("project"); // initializes/migrates once
      scan.mockClear();
      cursor.mockClear();
      const other = {
        ...archive("other", new Date(0).toISOString()),
        projectId: "other",
      };
      expect((await store.save(other)).ok).toBe(true);
      const saved = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          store.save(archive(`run-${i}`, new Date(i * 1000).toISOString())),
        ),
      );
      expect(saved.every((result) => result.ok)).toBe(true);
      const latest = archive("run-11", new Date(11000).toISOString());
      await store.save(latest); // replacing an existing entry must not evict another
      const listed = await store.list("project");
      expect(listed).toMatchObject({ ok: true, value: expect.any(Array) });
      if (!listed.ok) throw Error(listed.message);
      expect(listed.value.map((item) => item.id)).toEqual(
        Array.from({ length: 10 }, (_, i) => `run-${11 - i}`),
      );
      expect(await store.list("other")).toMatchObject({
        ok: true,
        value: [{ id: "other" }],
      });
      expect(scan).not.toHaveBeenCalled();
      expect(cursor).not.toHaveBeenCalled();
      expect(await store.read("run-0")).toEqual({ ok: true, value: null });
      expect(await store.read("run-11")).toEqual({ ok: true, value: latest });
    } finally {
      scan.mockRestore();
      cursor.mockRestore();
      store.close();
    }
  });
  it("lists and opens pre-folder archives without rewriting their execution evidence", async () => {
    const factory = new IDBFactory();
    const record = archive("legacy", new Date(0).toISOString());
    const { folderId, folderName, ...presentation } = record.presentation;
    const old = {
      ...record,
      presentation: {
        ...presentation,
        setupId: folderId,
        setupName: folderName,
      },
    };
    await new Promise<void>((resolve, reject) => {
      const request = factory.open("legacy-archives", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("runs");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("runs", "readwrite");
        transaction.objectStore("runs").put(old, old.id);
        transaction.oncomplete = () => {
          request.result.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const store = createBrowserSimulationArchiveStore({
      idbFactory: factory,
      databaseName: "legacy-archives",
    });
    expect(await store.list("project")).toMatchObject({
      ok: true,
      value: [{ folderId, folderName }],
    });
    expect(await store.read("legacy")).toMatchObject({
      ok: true,
      value: record,
    });
    expect(old.presentation).toHaveProperty("setupId");
    store.close();
  });
  it("survives store replacement and retains the ten newest Project runs", async () => {
    const factory = new IDBFactory() as unknown as IDBFactory;
    const options = { idbFactory: factory, databaseName: "archive-test" };
    const first = createBrowserSimulationArchiveStore(options);
    for (let index = 0; index < 12; index += 1) {
      const saved = await first.save(
        archive(`archive-${index}`, new Date(index * 1000).toISOString()),
      );
      expect(saved.ok).toBe(true);
    }
    first.close();

    const reopened = createBrowserSimulationArchiveStore(options);
    const listed = await reopened.list("project");
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(10);
    expect(listed.value[0]?.id).toBe("archive-11");
    expect(listed.value.at(-1)?.id).toBe("archive-2");
    const pruned = await reopened.read("archive-1");
    expect(pruned.ok && pruned.value).toBeNull();
    const retained = await reopened.read("archive-11");
    expect(retained.ok && retained.value?.id).toBe("archive-11");
    expect(await reopened.delete("archive-11")).toMatchObject({
      ok: true,
      value: true,
    });
    const afterDelete = await reopened.list("project");
    expect(afterDelete.ok && afterDelete.value).toHaveLength(9);
  });
});
