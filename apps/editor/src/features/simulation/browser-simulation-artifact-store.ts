import {
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_FILES,
  MAX_ARTIFACT_STORE_BYTES,
  type SimulationArtifactStore,
  type StoredResultCatalog,
} from "@icm/simulation-service/files";
import type { ArtifactRef } from "@icm/simulation-service/contract";
import { ProjectEvidenceLease } from "./browser-simulation-storage-lock";

// Immutable Project evidence bodies, not another Run or Dataset registry.
// Disconnect releases authorization/cache; it never deletes these records.
const DATABASE = "analog-canvas-simulation-files";
const BODY = "bodies";
const DIRECTORY = "files";
const CATALOGS = "catalogs";
const REFERENCES = "references";
export interface BrowserSimulationArtifactStore extends SimulationArtifactStore {
  /** Private storage ownership, not a second Run/Dataset catalog. */
  retainReferences(
    owner: string,
    artifactIds: readonly string[],
  ): Promise<void>;
  releaseReferences(owner: string): Promise<void>;
  referencedArtifactIds(): Promise<string[]>;
  queueRunRemoval(runId: string): Promise<void>;
  /** Caller must hold the Project exclusive lock and reconcile every archive. */
  reclaim(
    archiveKeys: readonly string[],
    archiveRunIds: readonly string[],
  ): Promise<{ files: number; bytes: number }>;
}
function value<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Storage aborted"));
    transaction.onerror = () => reject(transaction.error);
  });
}
export function createBrowserSimulationArtifactStore(
  projectId: string,
  factory?: IDBFactory,
  options: { retainSession?: boolean; locks?: LockManager } = {},
): BrowserSimulationArtifactStore | undefined {
  // Non-browser hosts retain bounded in-memory evidence. Real storage failures
  // are surfaced by put/get, never silently treated as durable success.
  let storageError: unknown;
  try {
    factory ??= globalThis.indexedDB;
  } catch (error) {
    // A denied IndexedDB getter must not crash the schematic during render.
    // Keep a failing store so simulation I/O reports the real storage error.
    storageError = error;
  }
  if (!factory && !storageError) return undefined;
  const lease = options.retainSession
    ? new ProjectEvidenceLease(projectId, options.locks)
    : undefined;
  let startup: Promise<void> | undefined;
  let generation = 0;
  async function open() {
    if (storageError) throw storageError;
    const current = generation;
    if (lease) {
      startup ??= (async () => {
        const { createBrowserSimulationArchiveStore } =
          await import("./browser-simulation-archive-store");
        const archives = createBrowserSimulationArchiveStore({
          idbFactory: factory!,
          ...(options.locks ? { locks: options.locks } : {}),
        });
        try {
          await archives.cleanup(projectId);
        } finally {
          archives.close();
        }
      })().catch(() => {}); // Housekeeping never gates ordinary simulation I/O.
      await startup;
      if (current !== generation) throw new Error("SESSION_CHANGED");
    }
    await lease?.acquire();
    if (current !== generation) throw new Error("SESSION_CHANGED");
    const request = factory!.open(DATABASE, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BODY)) {
        request.result.createObjectStore(BODY);
        request.result
          .createObjectStore(DIRECTORY)
          .createIndex("projectId", "projectId");
      }
      for (const name of [CATALOGS, REFERENCES])
        if (!request.result.objectStoreNames.contains(name))
          request.result
            .createObjectStore(name)
            .createIndex("projectId", "projectId");
    };
    return value(request);
  }
  return {
    async queueRunRemoval(runId) {
      const db = await open();
      try {
        const tx = db.transaction(REFERENCES, "readwrite");
        tx.objectStore(REFERENCES).put(
          { projectId, kind: "removal", runId, artifactIds: [] },
          [projectId, `removal:${runId}`],
        );
        await completed(tx);
      } finally {
        db.close();
      }
    },
    async reclaim(archiveKeys, archiveRunIds) {
      const db = await open();
      let transaction: IDBTransaction | undefined;
      let completion: Promise<void> | undefined;
      try {
        const tx = db.transaction(
          [BODY, DIRECTORY, REFERENCES, CATALOGS],
          "readwrite",
        );
        transaction = tx;
        const done = completed(tx);
        completion = done;
        void done.catch(() => {});
        const refs = tx.objectStore(REFERENCES);
        const catalogs = tx.objectStore(CATALOGS);
        const directory = tx.objectStore(DIRECTORY);
        const [owners, keys, runs, files] = await Promise.all([
          value(refs.index("projectId").getAll(projectId)) as Promise<
            Array<{ kind?: string; runId?: string; artifactIds: string[] }>
          >,
          value(refs.index("projectId").getAllKeys(projectId)),
          value(catalogs.index("projectId").getAll(projectId)) as Promise<
            StoredResultCatalog[]
          >,
          value(directory.index("projectId").getAll(projectId)) as Promise<
            Array<{ ref: ArtifactRef }>
          >,
        ]);
        const retainedKeys = new Set(archiveKeys);
        const retainedRuns = new Set(archiveRunIds);
        const removedRuns = new Set<string>();
        const protectedIds = new Set<string>();
        owners.forEach((owner, index) => {
          const key = keys[index] as [string, string];
          if (owner.kind === "removal") {
            if (owner.runId && !retainedRuns.has(owner.runId)) {
              removedRuns.add(owner.runId);
              catalogs.delete([projectId, owner.runId]);
              refs.delete(key);
            }
          } else if (key[1].startsWith("archive:") && !retainedKeys.has(key[1]))
            refs.delete(key);
          else owner.artifactIds.forEach((id) => protectedIds.add(id));
        });
        for (const { catalog } of runs)
          if (!removedRuns.has(catalog.runId))
            catalog.files.forEach((file) => protectedIds.add(file.id));
        let count = 0,
          bytes = 0;
        for (const { ref } of files) {
          if (protectedIds.has(ref.id)) continue;
          tx.objectStore(BODY).delete([projectId, ref.id]);
          directory.delete([projectId, ref.id]);
          count++;
          bytes += ref.byteLength;
        }
        await done;
        return { files: count, bytes };
      } catch (error) {
        try {
          transaction?.abort();
        } catch {
          // A failed or completed transaction is already inactive.
        }
        await completion?.catch(() => {});
        throw error;
      } finally {
        db.close();
      }
    },
    releaseSession() {
      generation++;
      startup = undefined;
      lease?.release();
    },
    async retainReferences(owner, artifactIds) {
      const db = await open();
      try {
        const tx = db.transaction([BODY, DIRECTORY, REFERENCES], "readwrite");
        const done = completed(tx);
        // Observe abort immediately, including a deliberate validation abort.
        void done.catch(() => {});
        try {
          const ids = [...new Set(artifactIds)];
          for (const id of ids)
            if (
              !(await value(tx.objectStore(DIRECTORY).get([projectId, id]))) ||
              !(await value(tx.objectStore(BODY).getKey([projectId, id])))
            )
              throw new Error(`ARTIFACT_UNAVAILABLE: ${id}`);
          tx.objectStore(REFERENCES).put({ projectId, artifactIds: ids }, [
            projectId,
            owner,
          ]);
          await done;
        } catch (error) {
          try {
            tx.abort();
          } catch {
            /* transaction already completed */
          }
          await done.catch(() => {});
          throw error;
        }
      } finally {
        db.close();
      }
    },
    async releaseReferences(owner) {
      const db = await open();
      try {
        const tx = db.transaction(REFERENCES, "readwrite");
        tx.objectStore(REFERENCES).delete([projectId, owner]);
        await completed(tx);
      } finally {
        db.close();
      }
    },
    async referencedArtifactIds() {
      const db = await open();
      try {
        const tx = db.transaction([REFERENCES, CATALOGS], "readonly");
        const [owners, catalogs] = await Promise.all([
          value(
            tx.objectStore(REFERENCES).index("projectId").getAll(projectId),
          ) as Promise<Array<{ artifactIds: string[] }>>,
          value(
            tx.objectStore(CATALOGS).index("projectId").getAll(projectId),
          ) as Promise<StoredResultCatalog[]>,
          completed(tx),
        ]);
        return [
          ...new Set([
            ...owners.flatMap((owner) => owner.artifactIds),
            ...catalogs.flatMap((record) =>
              record.catalog.files.map((file) => file.id),
            ),
          ]),
        ];
      } finally {
        db.close();
      }
    },
    async find(fileId) {
      const db = await open();
      try {
        const tx = db.transaction(DIRECTORY, "readonly");
        const [records] = await Promise.all([
          value(
            tx.objectStore(DIRECTORY).index("projectId").getAll(projectId),
          ) as Promise<Array<{ ref: ArtifactRef }>>,
          completed(tx),
        ]);
        return (
          records.find(({ ref }) => (ref.fileId ?? ref.id) === fileId)?.ref ??
          null
        );
      } finally {
        db.close();
      }
    },
    async saveCatalog(record) {
      const db = await open();
      try {
        const tx = db.transaction(CATALOGS, "readwrite");
        tx.objectStore(CATALOGS).put(
          { projectId, catalog: record.catalog, storedAt: record.storedAt },
          [projectId, record.catalog.runId],
        );
        await completed(tx);
      } finally {
        db.close();
      }
    },
    async catalogs() {
      const db = await open();
      try {
        const tx = db.transaction(CATALOGS, "readonly");
        const [records] = await Promise.all([
          value(
            tx.objectStore(CATALOGS).index("projectId").getAll(projectId),
          ) as Promise<StoredResultCatalog[]>,
          completed(tx),
        ]);
        return records.map(({ catalog, storedAt }) => ({ catalog, storedAt }));
      } finally {
        db.close();
      }
    },
    async put(ref, text) {
      const body = new Blob([text], { type: ref.mediaType });
      if (body.size !== ref.byteLength || body.size > MAX_ARTIFACT_BYTES)
        throw new Error("ARTIFACT_CAPACITY");
      const db = await open();
      try {
        const tx = db.transaction([BODY, DIRECTORY], "readwrite");
        // Attach both handlers before requests, including failure paths.
        let failure: unknown;
        const done = completed(tx).catch((error: unknown) => {
          failure = error;
        });
        try {
          const directory = tx.objectStore(DIRECTORY);
          const entries: Array<{ projectId: string; ref: ArtifactRef }> =
            await value(directory.index("projectId").getAll(projectId));
          const existing = entries.find((item) => item.ref.id === ref.id);
          if (existing) {
            if (JSON.stringify(existing.ref) !== JSON.stringify(ref))
              throw new Error("ARTIFACT_ID_CONFLICT");
          } else {
            if (
              entries.length >= MAX_ARTIFACT_FILES ||
              entries.reduce(
                (sum, item) => sum + item.ref.byteLength,
                body.size,
              ) > MAX_ARTIFACT_STORE_BYTES
            )
              throw new Error("ARTIFACT_CAPACITY");
            const key = [projectId, ref.id];
            tx.objectStore(BODY).put(body, key);
            directory.put({ projectId, ref }, key);
          }
        } catch (error) {
          tx.abort();
          await done;
          throw error;
        }
        await done;
        if (failure) throw failure;
      } finally {
        db.close();
      }
    },
    async get(id) {
      const db = await open();
      try {
        const tx = db.transaction([BODY, DIRECTORY], "readonly");
        const key = [projectId, id];
        const [entry, body] = await Promise.all([
          value(tx.objectStore(DIRECTORY).get(key)) as Promise<
            { ref: ArtifactRef } | undefined
          >,
          value(tx.objectStore(BODY).get(key)) as Promise<Blob | undefined>,
          completed(tx),
        ]);
        if (!entry || !body) return null;
        return { ref: entry.ref, text: await body.text() };
      } finally {
        db.close();
      }
    },
  };
}
