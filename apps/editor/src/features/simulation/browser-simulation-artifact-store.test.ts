import { createHash } from "node:crypto";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { SimulationFiles, sha256 } from "@icm/simulation-service/files";
import { createBrowserSimulationArtifactStore } from "./browser-simulation-artifact-store";
import { createBrowserSimulationArchiveStore } from "./browser-simulation-archive-store";
import { SimulationService } from "@icm/simulation-service";
import { createEmptyProject } from "@icm/model";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

describe("persistent simulation evidence", () => {
  it("falls back to original identity bytes after a compression Worker times out", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore(
      "codec-timeout",
      factory,
      { compression: true },
    )!;
    const text = "voltage,0.9\n".repeat(7000);
    const ref = {
      id: "timeout",
      name: "result.csv",
      mediaType: "text/csv",
      byteLength: new Blob([text]).size,
      sha256: await sha256(text),
    };
    const posted = vi.fn();
    const terminated = vi.fn();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal(
      "Worker",
      class {
        postMessage = posted;
        terminate = terminated;
      },
    );
    try {
      const saving = store.put(ref, text).then(
        () => ({ ok: true }),
        (error: unknown) => ({ ok: false, error }),
      );
      await vi.waitFor(() => expect(posted).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(120_001);
      expect(await saving).toEqual({ ok: true });
      expect(terminated).toHaveBeenCalledOnce();
      expect((await store.usage!()).byteLength).toBe(ref.byteLength);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
    expect((await store.get(ref.id))?.text).toBe(text);
  });
  it("rejects same-length corruption of identity evidence and preserves its charged bytes", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore(
      "identity-corrupt",
      factory,
    )!;
    const files = new SimulationFiles(Date.now, undefined, undefined, store);
    const ref = await files.put(
      "result.json",
      "application/json",
      '{"voltage":0.9}',
    );
    const before = await store.usage!();
    const db = await new Promise<IDBDatabase>((resolve) => {
      const open = factory.open("analog-canvas-simulation-files", 4);
      open.onsuccess = () => resolve(open.result);
    });
    try {
      const tx = db.transaction("bodies", "readwrite");
      tx.objectStore("bodies").put(new Blob(['{"voltage":0.8}']), [
        "identity-corrupt",
        ref.id,
      ]);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      const reopened = createBrowserSimulationArtifactStore(
        "identity-corrupt",
        factory,
      )!;
      await expect(reopened.get(ref.id)).rejects.toThrow(
        "ARTIFACT_CODEC_INTEGRITY",
      );
      expect((await reopened.usage!()).byteLength).toBe(before.byteLength);
    } finally {
      db.close();
    }
  });
  it.each([false, true])(
    "preserves original UTF-8 BOM bytes across reopen (compression=%s)",
    async (compression) => {
      const factory = new IDBFactory();
      const store = createBrowserSimulationArtifactStore("utf8-bom", factory, {
        compression,
      })!;
      const files = new SimulationFiles(Date.now, undefined, undefined, store);
      const text =
        "\uFEFF" + "time,电压\r\n0,0.900000000000000\r\n".repeat(3000);
      const ref = await files.put("bom.csv", "text/csv", text);
      const reopened = createBrowserSimulationArtifactStore(
        "utf8-bom",
        factory,
      )!;
      const restored = await reopened.get(ref.id);
      expect(restored?.text).toBe(text);
      expect(await sha256(restored!.text)).toBe(ref.sha256);
      expect(new Blob([restored!.text]).size).toBe(ref.byteLength);
    },
  );
  it("keeps the latest successfully completed result when a later solver failure publishes only its input evidence", async () => {
    const store = createBrowserSimulationArtifactStore(
      "latest-success",
      new IDBFactory(),
      { limits: { bytes: 12, files: 8 }, locks: navigator.locks },
    )!;
    const ref = (id: string) => ({
      id,
      name: id,
      mediaType: "text/plain",
      byteLength: 4,
      sha256: digest("data"),
    });
    for (const [id, execution, storedAt] of [
      ["success", "completed", 1],
      ["failure", "failed", 2],
    ] as const) {
      await store.put(ref(id), "data");
      await store.saveCatalog!({
        storedAt,
        catalog: {
          schemaVersion: 1,
          runId: id,
          preparedId: "prepared",
          inputRevision: "rev",
          execution,
          collection: "complete",
          retentionPolicy: "cache",
          files: [ref(id)],
          datasets: [],
        },
      });
    }
    await store.put(
      { ...ref("incoming"), byteLength: 8, sha256: digest("incoming") },
      "incoming",
    );
    expect((await store.get("success"))?.text).toBe("data");
    expect(await store.get("failure")).toBeNull();
    expect(await store.latestPersistedRun()).toBe("success");
  });
  it("coordinates a new producer with a cleanup snapshot so its fresh evidence cannot be reclaimed", async () => {
    const factory = new IDBFactory();
    const initial = createBrowserSimulationArtifactStore(
      "producer-gc-race",
      factory,
    )!;
    const ref = {
      id: "old",
      name: "raw",
      mediaType: "text/plain",
      byteLength: 4,
      sha256: digest("data"),
    };
    await initial.put(ref, "data");
    let release!: () => void;
    let observed!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const captured = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const locks: LockManager = {
      request: navigator.locks.request.bind(navigator.locks),
      async query() {
        const state = await navigator.locks.query();
        observed();
        await gate;
        return state;
      },
    };
    const archives = createBrowserSimulationArchiveStore({
      idbFactory: factory,
      locks,
    });
    const cleanup = archives.cleanup("producer-gc-race");
    await captured;
    const producer = createBrowserSimulationArtifactStore(
      "producer-gc-race",
      factory,
      { retainSession: true, cleanupOnStart: false, locks },
    )!;
    let published = false;
    const publishing = producer
      .put({ ...ref, id: "fresh" }, "data")
      .then(() => {
        published = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const premature = published;
    release();
    await cleanup;
    await publishing;
    expect(premature).toBe(false);
    expect(await producer.get("fresh")).toEqual({
      ref: { ...ref, id: "fresh" },
      text: "data",
    });
    await producer.releaseSession!();
    archives.close();
  });
  it("retries a failed public bundle publication with the original file identities", async () => {
    const store = createBrowserSimulationArtifactStore(
      "retry-identity",
      new IDBFactory(),
      { retainSession: true, cleanupOnStart: false, locks: navigator.locks },
    )!;
    const files = new SimulationFiles(Date.now, undefined, undefined, store);
    const entries = [
      {
        name: "out.raw",
        mediaType: "text/plain",
        text: "data",
        metadata: { role: "raw" as const },
      },
    ];
    const finish = () => ({
      name: "manifest.json",
      mediaType: "application/json",
      text: "{}",
      metadata: { role: "manifest" as const },
    });
    const catalog = (
      refs: readonly import("@icm/simulation-service/contract").ArtifactRef[],
    ) => ({
      schemaVersion: 1 as const,
      runId: "retry",
      preparedId: "prepared",
      inputRevision: "rev",
      retentionPolicy: "cache" as const,
      execution: "completed" as const,
      collection: "complete" as const,
      files: [...refs],
      datasets: [],
    });
    const failedIds: string[] = [];
    const original = IDBObjectStore.prototype.put;
    const fault = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (this: IDBObjectStore, value, key) {
        if (this.name === "files") failedIds.push(value.ref.id);
        if (this.name === "catalogs")
          throw new DOMException("Full", "QuotaExceededError");
        return original.call(this, value, key);
      });
    try {
      await expect(
        files.publishEvidence("retry", entries, finish, catalog),
      ).rejects.toMatchObject({ name: "QuotaExceededError" });
    } finally {
      fault.mockRestore();
    }
    expect(await store.usage!()).toMatchObject({
      byteLength: 0,
      fileCount: 0,
      catalogCount: 0,
    });
    const refs = await files.publishEvidence("retry", entries, finish, catalog);
    expect(refs.map((ref) => ref.id)).toEqual(failedIds);
    expect(await files.readArtifact(refs[0]!.id)).toMatchObject({
      ok: true,
      text: "data",
    });
    await store.releaseSession!();
  });
  it("rejects damaged compressed evidence without discarding its stored bytes", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore(
      "damaged-gzip",
      factory,
      { compression: true },
    )!;
    const text = "0.001,1.2,-3.4\n".repeat(8192);
    const ref = {
      id: "damaged",
      name: "ac.csv",
      mediaType: "text/csv",
      byteLength: new TextEncoder().encode(text).byteLength,
      sha256: await sha256(text),
    };
    await store.put(ref, text);
    const before = await store.usage!();
    const db = await new Promise<IDBDatabase>((resolve) => {
      const open = factory.open("analog-canvas-simulation-files", 4);
      open.onsuccess = () => resolve(open.result);
    });
    try {
      for (const [encoding, length, digest, error] of [
        ["unknown", ref.byteLength, ref.sha256, "ARTIFACT_CODEC_UNSUPPORTED"],
        ["gzip", ref.byteLength - 1, ref.sha256, "ARTIFACT_CODEC_LIMIT"],
        ["gzip", ref.byteLength, "0".repeat(64), "ARTIFACT_CODEC_INTEGRITY"],
      ] as const) {
        const tx = db.transaction("files", "readwrite");
        const file = tx.objectStore("files").get(["damaged-gzip", ref.id]);
        file.onsuccess = () =>
          tx.objectStore("files").put(
            {
              ...file.result,
              encoding,
              ref: { ...ref, byteLength: length, sha256: digest },
            },
            ["damaged-gzip", ref.id],
          );
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
        await expect(store.get(ref.id)).rejects.toThrow(error);
        expect((await store.usage!()).byteLength).toBe(before.byteLength);
      }
    } finally {
      db.close();
    }
  });
  it("rejects a blocked historical database upgrade without hanging or deleting the old bytes", async () => {
    const factory = new IDBFactory();
    const historical = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("analog-canvas-simulation-files", 3);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("legacy-proof").put("kept", "file");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const store = createBrowserSimulationArtifactStore("blocked", factory)!;
      await expect(store.get("file")).rejects.toThrow(
        "ARTIFACT_STORAGE_UPGRADE_BLOCKED",
      );
      const read = historical
        .transaction("legacy-proof")
        .objectStore("legacy-proof")
        .get("file");
      expect(
        await new Promise((resolve) => {
          read.onsuccess = () => resolve(read.result);
        }),
      ).toBe("kept");
    } finally {
      historical.close();
    }
  });
  it("charges duplicate identities once and refuses an incoming conflict before reclaiming evidence", async () => {
    const store = createBrowserSimulationArtifactStore(
      "duplicate",
      new IDBFactory(),
      { limits: { bytes: 8, files: 1 }, locks: navigator.locks },
    )!;
    const ref = {
      id: "same",
      name: "raw",
      mediaType: "text/plain",
      byteLength: 8,
      sha256: digest("abcdefgh"),
    };
    await store.putMany!([
      { ref, text: "abcdefgh" },
      { ref, text: "abcdefgh" },
    ]);
    expect(await store.usage!()).toMatchObject({ byteLength: 8, fileCount: 1 });
    await expect(
      store.putMany!([{ ref: { ...ref, name: "conflict" }, text: "abcdefgh" }]),
    ).rejects.toThrow("ARTIFACT_ID_CONFLICT");
    expect(await store.get(ref.id)).toEqual({ ref, text: "abcdefgh" });
  });
  it("charges compressed storage bytes while preserving original UTF-8 bytes and identity on reopen", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore("gzip", factory, {
      compression: true,
      locks: navigator.locks,
      limits: { bytes: 4096, files: 8 },
    })!;
    const text =
      "frequency,V(out).real,V(out).imag\r\n1.000000,2.000000,-3.000000\r\n".repeat(
        2048,
      );
    const ref = {
      id: "complex-ac",
      name: "ac.csv",
      mediaType: "text/csv",
      byteLength: new TextEncoder().encode(text).byteLength,
      sha256: await sha256(text),
    };
    await store.put(ref, text);
    expect((await store.usage!()).byteLength).toBeLessThan(4096);
    const reopened = createBrowserSimulationArtifactStore("gzip", factory)!;
    expect(await reopened.get(ref.id)).toEqual({ ref, text });
    expect(ref.byteLength).toBeGreaterThan(100000);
  });
  it("aborts a producer write when its session changes before commit", async () => {
    const store = createBrowserSimulationArtifactStore(
      "retired-producer",
      new IDBFactory(),
      { retainSession: true, cleanupOnStart: false, locks: navigator.locks },
    )!;
    const original = IDBObjectStore.prototype.put;
    const fault = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (this: IDBObjectStore, value, key) {
        const result = original.call(this, value, key);
        if (this.name === "bodies") void store.releaseSession!();
        return result;
      });
    try {
      await expect(
        store.put(
          {
            id: "file",
            name: "file",
            mediaType: "text/plain",
            byteLength: 4,
            sha256: digest("data"),
          },
          "data",
        ),
      ).rejects.toThrow("SESSION_CHANGED");
    } finally {
      fault.mockRestore();
    }
    expect(await store.get("file")).toBeNull();
    await store.releaseSession!();
  });
  it("publishes the complete evidence bundle and catalog atomically", async () => {
    const store = createBrowserSimulationArtifactStore(
      "bundle",
      new IDBFactory(),
      {
        retainSession: true,
        cleanupOnStart: false,
        locks: navigator.locks,
        limits: { bytes: 12, files: 4 },
      },
    )!;
    const ref = (id: string, size: number) => ({
      id,
      name: id,
      mediaType: "text/plain",
      byteLength: size,
      sha256: digest(size === 4 ? "data" : "12345678"),
    });
    const entries = [
      { ref: ref("result", 8), text: "12345678" },
      { ref: ref("manifest", 4), text: "data" },
    ];
    const catalog = {
      schemaVersion: 1 as const,
      runId: "bundle-run",
      preparedId: "prepared",
      inputRevision: "rev",
      retentionPolicy: "cache" as const,
      execution: "completed" as const,
      collection: "complete" as const,
      files: entries.map((entry) => entry.ref),
      datasets: [],
    };
    const original = IDBObjectStore.prototype.put;
    const fault = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (this: IDBObjectStore, value, key) {
        if (this.name === "catalogs") throw new Error("catalog write failed");
        return original.call(this, value, key);
      });
    try {
      await expect(
        store.publishEvidence!(entries, () => ({ catalog, storedAt: 1 })),
      ).rejects.toThrow("catalog write failed");
    } finally {
      fault.mockRestore();
    }
    expect(await store.get("result")).toBeNull();
    expect(await store.get("manifest")).toBeNull();
    await store.publishEvidence!(entries, () => ({ catalog, storedAt: 1 }));
    expect(await store.catalog!("bundle-run")).toMatchObject({
      catalog,
      storedAt: 1,
    });
    expect(await store.usage!()).toMatchObject({
      byteLength: 12,
      fileCount: 2,
    });
    await store.releaseSession!();
  });
  it("defers the body of an explicitly deleted viewed Run until its reader releases it", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore(
      "deleted-view",
      factory,
      { locks: navigator.locks },
    )!;
    const files = new SimulationFiles(Date.now, undefined, undefined, store);
    const ref = await files.put("view.raw", "text/plain", "data");
    await files.saveCatalog({
      schemaVersion: 1,
      runId: "view",
      preparedId: "prepared",
      inputRevision: "rev",
      retentionPolicy: "cache",
      execution: "completed",
      collection: "complete",
      files: [ref],
      datasets: [],
    });
    const release = await store.pinRun!("view");
    await store.deleteRun!("view", false);
    expect(await store.catalog!("view")).toBeNull();
    expect((await store.get(ref.id))?.text).toBe("data");
    await release();
    const archives = createBrowserSimulationArchiveStore({
      idbFactory: factory,
      locks: navigator.locks,
    });
    expect(await archives.cleanup("deleted-view")).toMatchObject({
      ok: true,
      value: { files: 0, bytes: 0 },
    });
    expect(await store.get(ref.id)).toBeNull();
    archives.close();
  });
  it("recovers unowned bodies before refusing admission when the latest Run is protected", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore(
      "orphan-pressure",
      factory,
      { locks: navigator.locks, limits: { bytes: 16, files: 8 } },
    )!;
    const ref = (id: string, bytes: number) => ({
      id,
      name: id,
      mediaType: "text/plain",
      byteLength: bytes,
      sha256: digest(
        id === "orphan" ? "orphaned" : id === "incoming" ? "incoming" : "data",
      ),
    });
    await store.put(ref("orphan", 8), "orphaned");
    await store.put(ref("latest", 4), "data");
    await store.saveCatalog!({
      storedAt: 1,
      catalog: {
        schemaVersion: 1,
        runId: "latest",
        preparedId: "prepared",
        inputRevision: "rev",
        retentionPolicy: "cache",
        execution: "completed",
        collection: "complete",
        files: [ref("latest", 4)],
        datasets: [],
      },
    });
    await store.put(ref("incoming", 8), "incoming");
    expect(await store.get("orphan")).toBeNull();
    expect((await store.get("latest"))?.text).toBe("data");
    expect(await store.usage!()).toMatchObject({
      byteLength: 12,
      fileCount: 2,
    });
  });
  it("keeps a viewed Run while reclaiming an unrelated older cache in the same Project", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore("viewed-run", factory, {
      locks: navigator.locks,
      limits: { bytes: 24, files: 8 },
    })!;
    const ref = (id: string, bytes = 4) => ({
      id,
      name: id + ".raw",
      mediaType: "text/plain",
      byteLength: bytes,
      sha256: digest(bytes === 4 ? "data" : "x".repeat(bytes)),
    });
    for (const [id, at] of [
      ["viewed", 1],
      ["unrelated", 2],
      ["latest", 3],
    ] as const) {
      await store.put(ref(id), "data");
      await store.saveCatalog!({
        storedAt: at,
        catalog: {
          schemaVersion: 1,
          runId: id,
          preparedId: "prepared",
          inputRevision: "rev",
          retentionPolicy: "cache",
          execution: "completed",
          collection: "complete",
          files: [ref(id)],
          datasets: [],
        },
      });
    }
    const release = await store.pinRun!("viewed");
    try {
      await store.put(ref("incoming", 16), "x".repeat(16));
      expect((await store.get("viewed"))?.text).toBe("data");
      expect(await store.get("unrelated")).toBeNull();
      expect(await store.usage!()).toMatchObject({ byteLength: 24 });
    } finally {
      await release();
    }
  });
  it("reclaims unrelated cache while an online producer protects its unpublished files", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore(
      "online-producer",
      factory,
      {
        retainSession: true,
        locks: navigator.locks,
        limits: { bytes: 16, files: 8 },
      },
    )!;
    const ref = (id: string, size = 4) => ({
      id,
      name: id + ".raw",
      mediaType: "text/plain",
      byteLength: size,
      sha256: digest(size === 4 ? "data" : "incoming"),
    });
    for (const [id, at] of [
      ["old", 1],
      ["latest", 2],
    ] as const) {
      await store.put(ref(id), "data");
      await store.saveCatalog!({
        storedAt: at,
        catalog: {
          schemaVersion: 1,
          runId: id,
          preparedId: "prepared",
          inputRevision: "rev",
          retentionPolicy: "cache",
          execution: "completed",
          collection: "complete",
          files: [ref(id)],
          datasets: [],
        },
      });
    }
    await store.put(ref("unpublished"), "data");
    await store.putMany!([{ ref: ref("incoming", 8), text: "incoming" }]);
    expect(await store.get("old")).toBeNull();
    expect((await store.get("unpublished"))?.text).toBe("data");
    expect((await store.get("latest"))?.text).toBe("data");
    expect(await store.usage!()).toMatchObject({ byteLength: 16 });
    await store.releaseSession!();
    const archives = createBrowserSimulationArchiveStore({
      idbFactory: factory,
      locks: navigator.locks,
    });
    expect(await archives.cleanup("online-producer")).toMatchObject({
      ok: true,
      value: { deferred: false, bytes: 12 },
    });
    expect(await store.get("unpublished")).toBeNull();
    expect((await store.get("latest"))?.text).toBe("data");
    archives.close();
  });
  it("reclaims an older cache before admitting new evidence below the Run count limit", async () => {
    const factory = new IDBFactory();
    const store = createBrowserSimulationArtifactStore("byte-budget", factory, {
      locks: navigator.locks,
      limits: { bytes: 12, files: 4 },
    })!;
    const makeFile = (id: string, text: string) => ({
      id,
      name: id + ".raw",
      mediaType: "text/plain",
      byteLength: text.length,
      sha256: digest(text),
    });
    const old = makeFile("old", "aaaa");
    const latest = makeFile("latest", "bbbb");
    for (const [ref, text, at] of [
      [old, "aaaa", 1],
      [latest, "bbbb", 2],
    ] as const) {
      await store.put(ref, text);
      await store.saveCatalog!({
        storedAt: at,
        catalog: {
          schemaVersion: 1,
          runId: ref.id,
          preparedId: "prepared",
          inputRevision: "rev",
          retentionPolicy: "cache",
          execution: "completed",
          collection: "complete",
          files: [ref],
          datasets: [],
        },
      });
    }
    const incoming = makeFile("incoming", "cccccccc");
    await store.putMany!([{ ref: incoming, text: "cccccccc" }]);
    expect(await store.get("old")).toBeNull();
    expect((await store.get("latest"))?.text).toBe("bbbb");
    expect((await store.get("incoming"))?.text).toBe("cccccccc");
    expect(await store.usage!()).toMatchObject({
      byteLength: 12,
      fileCount: 2,
    });
  });
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
        sha256: digest(id),
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
      sha256: digest("data"),
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
      // A read also attempts pending cleanup. Keep the physical-delete fault
      // active to establish that failure still preserves readable evidence.
      expect((await store.get("file"))?.text).toBe("data");
      expect(await store.catalogs!()).toHaveLength(1);
    } finally {
      fault.mockRestore();
    }
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
      sha256: digest("old"),
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
    await expect(failing.put("x", "text/plain", "x")).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
    expect(await failing.readArtifact("unknown")).toMatchObject({
      ok: false,
      error: { code: "ARTIFACT_STORAGE_UNAVAILABLE" },
    });
  });
});
