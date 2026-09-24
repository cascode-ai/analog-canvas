import {
  readSimulationRunArchive,
  summarizeSimulationRunArchive,
  type SimulationRunArchiveSummary,
  type SimulationRunArchiveV1,
} from "./simulation-run-archive";
import { createBrowserSimulationArtifactStore } from "./browser-simulation-artifact-store";
import type { ArtifactRef } from "@icm/simulation-service/contract";
import {
  ProjectEvidenceLease,
  withExclusiveEvidence,
} from "./browser-simulation-storage-lock";

const DATABASE_NAME = "analog-canvas-simulation-archives";
const DATABASE_VERSION = 3;
const STORE_NAME = "runs";
const DIRECTORY_NAME = "run-directory";
const PENDING_REMOVALS = "pending-removals";
const RETAINED_CACHE_RUNS = 30;
const RETAINED_SAVED_RUNS = 30;

// Internal storage only. Portable archives still contain their full evidence.
type StoredArchive = Omit<SimulationRunArchiveV1, "artifacts"> & {
  readonly storageFormat: "artifact-references-v1";
  readonly retentionKey?: string;
  readonly artifacts: readonly (Omit<
    SimulationRunArchiveV1["artifacts"][number],
    "text"
  > & { readonly storageId: string })[];
};

function sameEvidence(left: ArtifactRef, right: ArtifactRef): boolean {
  return (
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength &&
    left.name === right.name &&
    left.mediaType === right.mediaType &&
    left.role === right.role &&
    left.sourcePath === right.sourcePath &&
    left.analysisIndex === right.analysisIndex
  );
}

export type SimulationArchiveStoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code:
        "storage-unavailable" | "quota-exceeded" | "storage-failed";
      readonly message: string;
    };

export interface BrowserSimulationArchiveStore {
  list(
    projectId: string,
  ): Promise<
    SimulationArchiveStoreResult<readonly SimulationRunArchiveSummary[]>
  >;
  read(
    id: string,
  ): Promise<SimulationArchiveStoreResult<SimulationRunArchiveV1 | null>>;
  save(
    archive: SimulationRunArchiveV1,
  ): Promise<SimulationArchiveStoreResult<SimulationRunArchiveSummary>>;
  delete(id: string): Promise<SimulationArchiveStoreResult<boolean>>;
  /** Metadata-only Run ownership lookup; no evidence bodies are loaded. */
  runEntries(
    projectId: string,
  ): Promise<
    SimulationArchiveStoreResult<
      readonly { id: string; runId: string; retention: "cache" | "saved" }[]
    >
  >;
  pendingRemovalCount(
    projectId: string,
  ): Promise<SimulationArchiveStoreResult<number>>;
  /** Only archives explicitly marked as generated cache are eligible. */
  pruneCache(
    projectId: string,
  ): Promise<SimulationArchiveStoreResult<readonly string[]>>;
  /** Explicit saves are bounded separately; unmarked legacy records are not evicted. */
  pruneSaved(
    projectId: string,
  ): Promise<SimulationArchiveStoreResult<readonly string[]>>;
  /** Protect pre-reference-registry archives before any physical reclamation. */
  reconcileReferences(
    projectId: string,
  ): Promise<SimulationArchiveStoreResult<number>>;
  cleanup(projectId: string): Promise<
    SimulationArchiveStoreResult<{
      deferred: boolean;
      files: number;
      bytes: number;
    }>
  >;
  close(): void;
}

export interface BrowserSimulationArchiveStoreOptions {
  readonly idbFactory?: IDBFactory;
  readonly databaseName?: string;
  readonly locks?: LockManager;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function failure<T>(error: unknown): SimulationArchiveStoreResult<T> {
  const name = error instanceof Error ? error.name : "";
  const code =
    name === "QuotaExceededError"
      ? "quota-exceeded"
      : ["SecurityError", "InvalidStateError", "NotFoundError"].includes(name)
        ? "storage-unavailable"
        : "storage-failed";
  return {
    ok: false,
    code,
    message: error instanceof Error ? error.message : "Browser storage failed",
  };
}

export function createBrowserSimulationArchiveStore(
  options: BrowserSimulationArchiveStoreOptions = {},
): BrowserSimulationArchiveStore {
  let database: IDBDatabase | null = null;
  let opening: Promise<IDBDatabase> | null = null;

  function evidenceStore(projectId: string) {
    const store = createBrowserSimulationArtifactStore(
      projectId,
      options.idbFactory ?? globalThis.indexedDB,
    );
    if (!store)
      throw new DOMException("IndexedDB is unavailable", "SecurityError");
    return store;
  }
  async function release(stored: StoredArchive | undefined) {
    if (!stored?.retentionKey) return;
    try {
      await evidenceStore(stored.projectId).releaseReferences(
        stored.retentionKey,
      );
    } catch {
      // A leaked storage reference is preferable to invalidating a committed
      // archive. Reconciliation must recover abandoned reference generations.
    }
  }

  async function retain(
    archive: SimulationRunArchiveV1,
  ): Promise<StoredArchive> {
    const store = evidenceStore(archive.projectId);
    const artifacts: StoredArchive["artifacts"][number][] = [];
    for (const { text, originalId, ...metadata } of archive.artifacts) {
      const ref = { ...metadata, id: originalId };
      const existing = await store.find!(ref.fileId ?? originalId);
      if (existing && !sameEvidence(existing, ref))
        throw new Error(`ARTIFACT_ID_CONFLICT: ${metadata.name}`);
      if (!existing) await store.put(ref, text);
      artifacts.push({
        ...metadata,
        originalId,
        storageId: existing?.id ?? originalId,
      });
    }
    const retentionKey = `archive:${archive.id}:${crypto.randomUUID()}`;
    await store.retainReferences(
      retentionKey,
      artifacts.map((file) => file.storageId),
    );
    return {
      ...archive,
      storageFormat: "artifact-references-v1",
      retentionKey,
      artifacts,
    };
  }

  async function hydrate(
    value: unknown,
  ): Promise<SimulationRunArchiveV1 | null> {
    if (
      !value ||
      typeof value !== "object" ||
      !("storageFormat" in value) ||
      value.storageFormat !== "artifact-references-v1"
    )
      return readSimulationRunArchive(value);
    const stored = value as StoredArchive;
    if (!Array.isArray(stored.artifacts))
      throw new Error("Invalid archive references");
    const {
      storageFormat: _format,
      retentionKey: _retention,
      ...metadata
    } = stored;
    const archive = readSimulationRunArchive({
      ...metadata,
      artifacts: stored.artifacts.map(({ storageId: _id, ...ref }) => ({
        ...ref,
        text: "",
      })),
    });
    if (!archive) throw new Error("Invalid archive metadata");
    const store = evidenceStore(archive.projectId);
    const artifacts: SimulationRunArchiveV1["artifacts"][number][] = [];
    for (const { storageId, ...ref } of stored.artifacts) {
      if (typeof storageId !== "string")
        throw new Error("Invalid archive file locator");
      const body = await store.get(storageId);
      if (!body) throw new Error(`ARTIFACT_UNAVAILABLE: ${ref.name}`);
      if (!sameEvidence(body.ref, { ...ref, id: ref.originalId }))
        throw new Error(`ARTIFACT_ID_CONFLICT: ${ref.name}`);
      artifacts.push({ ...ref, text: body.text });
    }
    return { ...archive, artifacts };
  }

  async function open(): Promise<IDBDatabase> {
    if (database) return database;
    if (opening) return opening;
    const factory = options.idbFactory ?? globalThis.indexedDB;
    if (!factory)
      throw new DOMException("IndexedDB is unavailable", "SecurityError");
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(
        options.databaseName ?? DATABASE_NAME,
        DATABASE_VERSION,
      );
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME))
          request.result.createObjectStore(STORE_NAME);
        if (!request.result.objectStoreNames.contains(PENDING_REMOVALS))
          request.result
            .createObjectStore(PENDING_REMOVALS)
            .createIndex("projectId", "projectId");
        if (request.result.objectStoreNames.contains(DIRECTORY_NAME)) return;
        const directory = request.result.createObjectStore(DIRECTORY_NAME);
        directory.createIndex("projectId", "projectId");
        // One-time migration streams old records individually; never rewrite
        // their evidence or materialize every project's file bodies together.
        const cursor = request
          .transaction!.objectStore(STORE_NAME)
          .openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result) return;
          const archive = readSimulationRunArchive(cursor.result.value);
          if (archive)
            directory.put(summarizeSimulationRunArchive(archive), archive.id);
          cursor.result.continue();
        };
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open archive storage"));
      request.onblocked = () =>
        reject(new Error("Simulation archive storage upgrade is blocked"));
    });
    try {
      database = await opening;
      return database;
    } catch (error) {
      opening = null;
      throw error;
    }
  }

  const api: BrowserSimulationArchiveStore = {
    async reconcileReferences(projectId) {
      try {
        const db = await open();
        const directory = db.transaction(DIRECTORY_NAME, "readonly");
        const summaries = (await requestValue(
          directory
            .objectStore(DIRECTORY_NAME)
            .index("projectId")
            .getAll(projectId),
        )) as SimulationRunArchiveSummary[];
        await transactionDone(directory);
        const read = db.transaction(STORE_NAME, "readonly");
        const readDone = transactionDone(read);
        const records = await Promise.all(
          summaries.map(
            (summary) =>
              requestValue(
                read.objectStore(STORE_NAME).get(summary.id),
              ) as Promise<StoredArchive | undefined>,
          ),
        );
        await readDone;
        // Self-contained legacy archives do not depend on shared file bodies.
        const candidates = records.flatMap((record) =>
          record?.projectId === projectId &&
          record.storageFormat === "artifact-references-v1"
            ? [
                {
                  record,
                  retentionKey:
                    record.retentionKey ??
                    `archive:${record.id}:${crypto.randomUUID()}`,
                },
              ]
            : [],
        );
        const missing = candidates.filter(({ record }) => !record.retentionKey);
        const evidence = evidenceStore(projectId);
        // Keep large legacy stores bounded without one transaction per Run.
        try {
          for (let offset = 0; offset < candidates.length; offset += 16)
            await evidence.retainReferencesMany(
              candidates
                .slice(offset, offset + 16)
                .map(({ record, retentionKey }) => ({
                  owner: retentionKey,
                  artifactIds: record.artifacts.map((file) => file.storageId),
                })),
            );
        } catch (error) {
          for (const { record, retentionKey } of missing)
            await release({ ...record, retentionKey });
          throw error;
        }
        if (!missing.length) return { ok: true, value: 0 };
        const tx = db.transaction(STORE_NAME, "readwrite");
        const done = transactionDone(tx);
        void done.catch(() => {});
        try {
          const store = tx.objectStore(STORE_NAME);
          const current = await Promise.all(
            missing.map(({ record }) => requestValue(store.get(record.id))),
          );
          let registered = 0;
          const abandoned: StoredArchive[] = [];
          missing.forEach(({ record, retentionKey }, index) => {
            const next = { ...record, retentionKey };
            // Compare metadata, never overwrite a concurrent replacement/delete.
            if (JSON.stringify(current[index]) === JSON.stringify(record)) {
              store.put(next, record.id);
              registered++;
            } else abandoned.push(next);
          });
          await done;
          for (const next of abandoned) await release(next);
          return { ok: true, value: registered };
        } catch (error) {
          try {
            tx.abort();
          } catch {
            /* transaction already completed */
          }
          await done.catch(() => {});
          for (const { record, retentionKey } of missing)
            await release({ ...record, retentionKey });
          throw error;
        }
      } catch (error) {
        return failure(error);
      }
    },
    async cleanup(projectId) {
      try {
        const result = await withExclusiveEvidence(
          projectId,
          async () => {
            const reconciled = await api.reconcileReferences(projectId);
            if (!reconciled.ok) throw new Error(reconciled.message);
            const listed = await api.list(projectId);
            if (!listed.ok) throw new Error(listed.message);
            const db = await open();
            const keys: string[] = [],
              runIds: string[] = [];
            const read = db.transaction(STORE_NAME, "readonly");
            const readDone = transactionDone(read);
            const records = await Promise.all(
              listed.value.map(
                (summary) =>
                  requestValue(
                    read.objectStore(STORE_NAME).get(summary.id),
                  ) as Promise<StoredArchive | undefined>,
              ),
            );
            await readDone;
            for (const record of records) {
              if (!record) continue;
              runIds.push(record.run.id);
              if (record.storageFormat === "artifact-references-v1") {
                if (!record.retentionKey)
                  throw new Error("ARCHIVE_REFERENCE_NOT_REGISTERED");
                keys.push(record.retentionKey);
              }
            }
            const pending = db.transaction(PENDING_REMOVALS, "readonly");
            const [removals, removalKeys] = await Promise.all([
              requestValue(
                pending
                  .objectStore(PENDING_REMOVALS)
                  .index("projectId")
                  .getAll(projectId),
              ) as Promise<Array<{ runId: string }>>,
              requestValue(
                pending
                  .objectStore(PENDING_REMOVALS)
                  .index("projectId")
                  .getAllKeys(projectId),
              ),
              transactionDone(pending),
            ]);
            const evidence = evidenceStore(projectId);
            for (const removal of removals)
              await evidence.queueRunRemoval(removal.runId);
            const reclaimed = await evidence.reclaim(keys, runIds);
            const finish = db.transaction(PENDING_REMOVALS, "readwrite");
            for (const key of removalKeys)
              finish.objectStore(PENDING_REMOVALS).delete(key);
            await transactionDone(finish);
            return reclaimed;
          },
          options.locks,
        );
        return {
          ok: true,
          value: result.available
            ? { deferred: false, ...result.value }
            : { deferred: true, files: 0, bytes: 0 },
        };
      } catch (error) {
        return failure(error);
      }
    },
    async list(projectId) {
      try {
        const db = await open();
        const transaction = db.transaction(DIRECTORY_NAME, "readonly");
        const summaries: SimulationRunArchiveSummary[] = await requestValue(
          transaction
            .objectStore(DIRECTORY_NAME)
            .index("projectId")
            .getAll(projectId),
        );
        await transactionDone(transaction);
        summaries.sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt),
        );
        return { ok: true, value: summaries };
      } catch (error) {
        return failure(error);
      }
    },
    async runEntries(projectId) {
      try {
        const listed = await api.list(projectId);
        if (!listed.ok) return listed;
        const db = await open();
        const entries: {
          id: string;
          runId: string;
          retention: "cache" | "saved";
        }[] = [];
        const missing = listed.value.filter((summary) => !summary.runId);
        const legacy = new Map<string, StoredArchive | undefined>();
        if (missing.length) {
          // One bounded IndexedDB transaction, not one round trip per older Run.
          const tx = db.transaction(STORE_NAME, "readonly");
          const records = await Promise.all(
            missing.map(
              (summary) =>
                requestValue(
                  tx.objectStore(STORE_NAME).get(summary.id),
                ) as Promise<StoredArchive | undefined>,
            ),
          );
          await transactionDone(tx);
          missing.forEach((summary, index) =>
            legacy.set(summary.id, records[index]),
          );
        }
        for (const summary of listed.value) {
          if (summary.runId) {
            entries.push({
              id: summary.id,
              runId: summary.runId,
              retention: summary.retention ?? "saved",
            });
            continue;
          }
          // Older directories lacked Run identity; no bodies are hydrated.
          const record = legacy.get(summary.id);
          if (record)
            entries.push({
              id: summary.id,
              runId: record.run.id,
              retention: record.retention ?? "saved",
            });
        }
        return { ok: true, value: entries };
      } catch (error) {
        return failure(error);
      }
    },
    async pendingRemovalCount(projectId) {
      try {
        const db = await open();
        const tx = db.transaction(PENDING_REMOVALS, "readonly");
        const count = await requestValue(
          tx.objectStore(PENDING_REMOVALS).index("projectId").count(projectId),
        );
        await transactionDone(tx);
        return { ok: true, value: count };
      } catch (error) {
        return failure(error);
      }
    },
    async pruneCache(projectId) {
      try {
        const listed = await api.list(projectId);
        if (!listed.ok) return listed;
        const evidence = evidenceStore(projectId);
        const catalogs = await evidence.catalogs!();
        // Even counting duplicate representations, nothing can be evicted.
        // Avoid loading archive ownership on the normal under-cap path.
        if (
          listed.value.filter((entry) => entry.retention === "cache").length +
            catalogs.filter(
              ({ catalog }) => catalog.retentionPolicy === "cache",
            ).length <=
          RETAINED_CACHE_RUNS
        )
          return { ok: true, value: [] };
        const owners = await api.runEntries(projectId);
        if (!owners.ok) return owners;
        const savedRuns = new Set(
          owners.value
            .filter((entry) => entry.retention === "saved")
            .map((entry) => entry.runId),
        );
        const candidates = new Map<
          string,
          {
            at: number;
            archiveIds: string[];
            catalog?: { runId: string; storedAt: number };
          }
        >();
        for (const entry of listed.value) {
          if (entry.retention !== "cache" || savedRuns.has(entry.runId ?? ""))
            continue;
          const key = entry.runId ?? entry.id;
          const current = candidates.get(key);
          const at = Date.parse(entry.createdAt) || 0;
          if (current) {
            current.at = Math.max(current.at, at);
            current.archiveIds.push(entry.id);
          } else candidates.set(key, { at, archiveIds: [entry.id] });
        }
        for (const { catalog, storedAt } of catalogs) {
          if (
            catalog.retentionPolicy !== "cache" ||
            savedRuns.has(catalog.runId)
          )
            continue;
          const current = candidates.get(catalog.runId);
          const locator = { runId: catalog.runId, storedAt };
          if (current) {
            current.at = Math.max(current.at, storedAt);
            current.catalog = locator;
          } else
            candidates.set(catalog.runId, {
              at: storedAt,
              archiveIds: [],
              catalog: locator,
            });
        }
        const excess = [...candidates.entries()]
          .sort((a, b) => b[1].at - a[1].at || a[0].localeCompare(b[0]))
          .slice(RETAINED_CACHE_RUNS);
        const removedIds: string[] = [];
        for (const [, entry] of excess) {
          for (const id of entry.archiveIds) {
            const removed = await api.delete(id);
            if (!removed.ok) return removed;
            removedIds.push(id);
          }
        }
        await evidence.removeCachedCatalogs(
          excess.flatMap(([, entry]) => (entry.catalog ? [entry.catalog] : [])),
        );
        return { ok: true, value: removedIds };
      } catch (error) {
        return failure(error);
      }
    },
    async pruneSaved(projectId) {
      try {
        const listed = await api.list(projectId);
        if (!listed.ok) return listed;
        const possible = listed.value.filter(
          (entry) => entry.retention === "saved",
        );
        if (possible.length <= RETAINED_SAVED_RUNS)
          return { ok: true, value: [] };
        const db = await open();
        const read = db.transaction(STORE_NAME, "readonly");
        const records = await Promise.all(
          possible.map(
            (entry) =>
              requestValue(
                read.objectStore(STORE_NAME).get(entry.id),
              ) as Promise<StoredArchive | undefined>,
          ),
        );
        await transactionDone(read);
        const excess = possible
          .filter((_, index) => records[index]?.retention === "saved")
          .slice(RETAINED_SAVED_RUNS);
        for (const entry of excess) {
          const removed = await api.delete(entry.id);
          if (!removed.ok) return removed;
        }
        return { ok: true, value: excess.map((entry) => entry.id) };
      } catch (error) {
        return failure(error);
      }
    },
    async read(id) {
      try {
        const db = await open();
        const transaction = db.transaction(STORE_NAME, "readonly");
        const value = await requestValue(
          transaction.objectStore(STORE_NAME).get(id),
        );
        await transactionDone(transaction);
        return {
          ok: true,
          value: await hydrate(value),
        };
      } catch (error) {
        return failure(error);
      }
    },
    async save(archive) {
      let stored: StoredArchive | undefined;
      const evicted: StoredArchive[] = [];
      const lease = new ProjectEvidenceLease(archive.projectId, options.locks);
      try {
        await lease.acquire();
        // Commit the directory only after every referenced body is durable.
        // Existing records remain usable if any evidence write fails.
        stored = await retain(archive);
        const db = await open();
        const transaction = db.transaction(
          [STORE_NAME, DIRECTORY_NAME, PENDING_REMOVALS],
          "readwrite",
        );
        const directory = transaction.objectStore(DIRECTORY_NAME);
        const done = transactionDone(transaction);
        const store = transaction.objectStore(STORE_NAME);
        const previous = (await requestValue(store.get(archive.id))) as
          StoredArchive | undefined;
        if (previous?.retention === "saved" && archive.retention === "cache") {
          const protectedSummary = (await requestValue(
            directory.get(archive.id),
          )) as SimulationRunArchiveSummary | undefined;
          if (!protectedSummary) throw new Error("ARCHIVE_DIRECTORY_MISSING");
          await done;
          await release(stored);
          return { ok: true, value: protectedSummary };
        }
        const summary = summarizeSimulationRunArchive(archive);
        if (archive.retention === "saved") {
          const all = (await requestValue(
            directory.index("projectId").getAll(archive.projectId),
          )) as SimulationRunArchiveSummary[];
          const possible = all.filter(
            (entry) => entry.retention === "saved" && entry.id !== archive.id,
          );
          const records = await Promise.all(
            possible.map(
              (entry) =>
                requestValue(store.get(entry.id)) as Promise<
                  StoredArchive | undefined
                >,
            ),
          );
          const excess = possible
            .flatMap((entry, index) =>
              records[index]?.retention === "saved"
                ? [{ entry, old: records[index]! }]
                : [],
            )
            .sort(
              (a, b) =>
                b.entry.createdAt.localeCompare(a.entry.createdAt) ||
                a.entry.id.localeCompare(b.entry.id),
            )
            .slice(RETAINED_SAVED_RUNS - 1);
          for (const { entry, old } of excess) {
            if (old.projectId !== archive.projectId) continue;
            store.delete(entry.id);
            directory.delete(entry.id);
            transaction
              .objectStore(PENDING_REMOVALS)
              .put(
                { projectId: archive.projectId, runId: old.run.id },
                crypto.randomUUID(),
              );
            evicted.push(old);
          }
        }
        store.put(stored, archive.id);
        directory.put(summary, archive.id);
        await done;
        // Old references can safely leak if cleanup fails; the new archive is
        // already committed and must not be reported as a failed save.
        await release(previous);
        for (const old of evicted) await release(old);
        return { ok: true, value: summary };
      } catch (error) {
        await release(stored);
        return failure(error);
      } finally {
        lease.release();
      }
    },
    async delete(id) {
      let lease: ProjectEvidenceLease | undefined;
      try {
        const db = await open();
        const read = db.transaction(STORE_NAME, "readonly");
        const observed = (await requestValue(
          read.objectStore(STORE_NAME).get(id),
        )) as StoredArchive | undefined;
        await transactionDone(read);
        if (!observed) return { ok: true, value: true };
        lease = new ProjectEvidenceLease(observed.projectId, options.locks);
        await lease.acquire();
        const transaction = db.transaction(
          [STORE_NAME, DIRECTORY_NAME, PENDING_REMOVALS],
          "readwrite",
        );
        const done = transactionDone(transaction);
        const store = transaction.objectStore(STORE_NAME);
        const previous = (await requestValue(store.get(id))) as
          StoredArchive | undefined;
        if (previous && previous.projectId !== observed.projectId) {
          transaction.abort();
          await done.catch(() => {});
          throw new Error("ARCHIVE_PROJECT_CHANGED");
        }
        if (previous)
          transaction
            .objectStore(PENDING_REMOVALS)
            .put(
              { projectId: previous.projectId, runId: previous.run.id },
              crypto.randomUUID(),
            );
        store.delete(id);
        transaction.objectStore(DIRECTORY_NAME).delete(id);
        await done;
        await release(previous);
        return { ok: true, value: true };
      } catch (error) {
        return failure(error);
      } finally {
        lease?.release();
      }
    },
    close() {
      database?.close();
      database = null;
      opening = null;
    },
  };
  return api;
}
