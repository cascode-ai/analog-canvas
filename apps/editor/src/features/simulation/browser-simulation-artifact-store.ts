import {
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_FILES,
  MAX_ARTIFACT_STORE_BYTES,
  ArtifactCapacityError,
  type SimulationArtifactStore,
  type StoredResultCatalog,
} from "@icm/simulation-service/files";
import type { ArtifactRef } from "@icm/simulation-service/contract";
import {
  announceEvidenceChange,
  evidenceLockName,
  ProjectEvidenceLease,
} from "./browser-simulation-storage-lock";
import { runArtifactCodec } from "./artifact-codec";
import type { EncodedArtifact } from "./artifact-codec-core";
type StoredFile = { ref: ArtifactRef; storedBytes?: number; encoding?: string };
type ArchiveOwnership = { runId?: string; retention?: "cache" | "saved" };
const chargedBytes = (file: StoredFile) =>
  file.storedBytes ?? file.ref.byteLength;

// Immutable Project evidence bodies, not another Run or Dataset registry.
// Disconnect releases authorization/cache; it never deletes these records.
const DATABASE = "analog-canvas-simulation-files";
const BODY = "bodies";
const DIRECTORY = "files";
const CATALOGS = "catalogs";
const REFERENCES = "references";
export interface BrowserSimulationArtifactStore extends SimulationArtifactStore {
  latestPersistedRun(): Promise<string | undefined>;
  /** Private storage ownership, not a second Run/Dataset catalog. */
  retainReferences(
    owner: string,
    artifactIds: readonly string[],
    context?: ArchiveOwnership,
  ): Promise<void>;
  /** Reconcile many archive owners in one validated storage transaction. */
  retainReferencesMany(
    owners: readonly ({
      owner: string;
      artifactIds: readonly string[];
    } & ArchiveOwnership)[],
  ): Promise<void>;
  releaseReferences(owner: string): Promise<void>;
  referencedArtifactIds(): Promise<string[]>;
  queueRunRemoval(runId: string): Promise<void>;
  /** Remove selected cache-only directories; recheck identity in the write transaction. */
  removeCachedCatalogs(
    entries: readonly { runId: string; storedAt: number }[],
  ): Promise<string[]>;
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
  options: {
    retainSession?: boolean;
    /** Archive publication protects pending files without running a new host startup. */
    cleanupOnStart?: boolean;
    locks?: LockManager;
    /** Smaller budgets let contract tests exercise ordinary production admission. */
    limits?: { bytes: number; files: number };
    /** Reader ships first. Enable writer only after the compatible reader rollout. */
    compression?: boolean;
  } = {},
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
  const byteLimit = Math.min(
    options.limits?.bytes ?? MAX_ARTIFACT_STORE_BYTES,
    MAX_ARTIFACT_STORE_BYTES,
  );
  const fileLimit = Math.min(
    options.limits?.files ?? MAX_ARTIFACT_FILES,
    MAX_ARTIFACT_FILES,
  );
  const locks = options.locks ?? globalThis.navigator?.locks;
  const compression =
    options.compression ?? import.meta.env?.VITE_SIMULATION_GZIP === "1";
  let producerOwner = `producer:${crypto.randomUUID()}`;
  let lease = options.retainSession
    ? new ProjectEvidenceLease(projectId, locks, producerOwner)
    : undefined;
  let startup: Promise<void> | undefined;
  let generation = 0;
  const runPins = new Map<ProjectEvidenceLease, string>();
  const capacity = (
    used: number,
    incoming: number,
    residentFiles: number,
    incomingFiles: number,
  ) =>
    new ArtifactCapacityError(
      `Browser project evidence needs ${Math.max(0, used + incoming - byteLimit)} additional stored bytes and ${Math.max(0, residentFiles + incomingFiles - fileLimit)} additional file slots after safe cleanup (${used} bytes used, ${incoming} bytes incoming, ${byteLimit} byte limit).`,
    );
  async function open() {
    if (storageError) throw storageError;
    const current = generation;
    if (lease && options.cleanupOnStart !== false) {
      startup ??= (async () => {
        const { createBrowserSimulationArchiveStore } =
          await import("./browser-simulation-archive-store");
        const archives = createBrowserSimulationArchiveStore({
          idbFactory: factory!,
          ...(options.locks ? { locks: options.locks } : {}),
        });
        try {
          await archives.pruneCache(projectId);
          await archives.pruneSaved(projectId);
          await archives.cleanup(projectId);
        } finally {
          archives.close();
        }
      })().catch(() => {}); // Failed housekeeping does not deny ordinary I/O.
      await startup;
      if (current !== generation) throw new Error("SESSION_CHANGED");
    }
    if (lease) {
      // Join the producer set under the same Project lock that protects GC's
      // lock snapshot. A producer appearing after that snapshot could otherwise
      // have its newly committed bodies mistaken for abandoned evidence.
      const coordination = new ProjectEvidenceLease(projectId, locks);
      try {
        await coordination.acquire();
        await lease.acquire();
      } finally {
        await coordination.release();
      }
    }
    if (current !== generation) throw new Error("SESSION_CHANGED");
    const request = factory!.open(DATABASE, 4);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (blocked) {
        request.transaction?.abort();
        return;
      }
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
    return new Promise<IDBDatabase>((resolve, reject) => {
      request.onblocked = () => {
        blocked = true;
        reject(new Error("ARTIFACT_STORAGE_UPGRADE_BLOCKED"));
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (blocked) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }
  async function retainReferenceOwners(
    owners: readonly ({
      owner: string;
      artifactIds: readonly string[];
    } & ArchiveOwnership)[],
  ) {
    if (!owners.length) return;
    const db = await open();
    try {
      const tx = db.transaction([BODY, DIRECTORY, REFERENCES], "readwrite");
      const done = completed(tx);
      // Observe abort immediately, including a deliberate validation abort.
      void done.catch(() => {});
      try {
        const ids = [...new Set(owners.flatMap((entry) => entry.artifactIds))];
        const directory = tx.objectStore(DIRECTORY);
        const bodies = tx.objectStore(BODY);
        const present = await Promise.all(
          ids.map(async (id) => {
            const key = [projectId, id];
            const [entry, bodyKey] = await Promise.all([
              value(directory.get(key)),
              value(bodies.getKey(key)),
            ]);
            return Boolean(entry && bodyKey !== undefined);
          }),
        );
        const missing = ids.find((_, index) => !present[index]);
        if (missing) throw new Error(`ARTIFACT_UNAVAILABLE: ${missing}`);
        const references = tx.objectStore(REFERENCES);
        for (const { owner, artifactIds, ...context } of owners)
          references.put(
            {
              projectId,
              ...(context.runId ? { kind: "archive", ...context } : {}),
              artifactIds: [...new Set(artifactIds)],
            },
            [projectId, owner],
          );
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
  }
  async function admit(bodies: readonly { ref: ArtifactRef; body: Blob }[]) {
    const db = await open();
    let existing: StoredFile[];
    try {
      const tx = db.transaction(DIRECTORY, "readonly");
      [existing] = await Promise.all([
        value(tx.objectStore(DIRECTORY).index("projectId").getAll(projectId)),
        completed(tx),
      ]);
    } finally {
      db.close();
    }
    const identities = new Map(
      existing.map((entry) => [entry.ref.id, entry.ref]),
    );
    const fresh = [];
    for (const entry of bodies) {
      const previous = identities.get(entry.ref.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(entry.ref))
        throw new Error("ARTIFACT_ID_CONFLICT");
      if (!previous) fresh.push(entry);
      identities.set(entry.ref.id, entry.ref);
    }
    if (!fresh.length) return;
    const bytes = fresh.reduce((sum, entry) => sum + entry.body.size, 0);
    if (bytes > byteLimit || fresh.length > fileLimit)
      throw capacity(0, bytes, 0, fresh.length);
    if (
      existing.reduce((sum, entry) => sum + chargedBytes(entry), bytes) <=
        byteLimit * 0.75 &&
      existing.length + fresh.length <= fileLimit
    )
      return;
    const { createBrowserSimulationArchiveStore } =
      await import("./browser-simulation-archive-store");
    const archives = createBrowserSimulationArchiveStore({
      idbFactory: factory!,
      ...(options.locks ? { locks: options.locks } : {}),
    });
    try {
      const reclaimed = await archives.cleanup(projectId);
      if (!reclaimed.ok) throw new Error(reclaimed.message);
      const result = await archives.pruneCache(projectId, {
        bytes,
        files: fresh.length,
        byteLimit,
        fileLimit,
      });
      if (!result.ok) throw new Error(result.message);
    } finally {
      archives.close();
    }
  }
  async function retainProduced(
    tx: IDBTransaction,
    refs: readonly ArtifactRef[],
  ) {
    if (!lease || !refs.length) return;
    const references = tx.objectStore(REFERENCES);
    const key = [projectId, producerOwner];
    const previous = (await value(references.get(key))) as
      { artifactIds: string[] } | undefined;
    references.put(
      {
        projectId,
        kind: "producer",
        artifactIds: [
          ...new Set([
            ...(previous?.artifactIds ?? []),
            ...refs.map((ref) => ref.id),
          ]),
        ],
      },
      key,
    );
  }
  return {
    async latestPersistedRun() {
      const db = await open();
      try {
        const tx = db.transaction(REFERENCES, "readonly");
        const [record] = await Promise.all([
          value(tx.objectStore(REFERENCES).get([projectId, "latest"])),
          completed(tx),
        ]);
        return (record as { runId?: string } | undefined)?.runId;
      } finally {
        db.close();
      }
    },
    async digest(text) {
      return (await runArtifactCodec({ action: "digest", text })) as string;
    },
    async resourceUsage() {
      const db = await open();
      let files: StoredFile[];
      let catalogs: StoredResultCatalog[];
      let owners: Array<{
        kind?: string;
        runId?: string;
        artifactIds: string[];
        retention?: string;
      }>;
      try {
        const tx = db.transaction(
          [DIRECTORY, CATALOGS, REFERENCES],
          "readonly",
        );
        [files, catalogs, owners] = await Promise.all([
          value(tx.objectStore(DIRECTORY).index("projectId").getAll(projectId)),
          value(tx.objectStore(CATALOGS).index("projectId").getAll(projectId)),
          value(
            tx.objectStore(REFERENCES).index("projectId").getAll(projectId),
          ),
          completed(tx),
        ]);
      } finally {
        db.close();
      }
      const latest =
        owners.find(
          (owner) =>
            owner.kind === "latest" &&
            catalogs.some((record) => record.catalog.runId === owner.runId),
        )?.runId ??
        [...catalogs]
          .filter(
            ({ catalog }) =>
              catalog.collection === "complete" &&
              catalog.execution === "completed",
          )
          .sort((a, b) => b.storedAt - a.storedAt)[0]?.catalog.runId;
      const protectedIds = new Set(
        owners
          .filter(
            (owner) =>
              owner.kind !== "removal" &&
              (owner.kind !== "archive" ||
                owner.retention !== "cache" ||
                owner.runId === latest),
          )
          .flatMap((owner) => owner.artifactIds),
      );
      for (const { catalog } of catalogs)
        if (catalog.retentionPolicy !== "cache" || catalog.runId === latest)
          catalog.files.forEach((ref) => protectedIds.add(ref.id));
      const pendingIds = new Set(
        owners
          .filter((owner) => owner.kind === "removal")
          .flatMap((owner) => owner.artifactIds),
      );
      const sum = (predicate: (file: StoredFile) => boolean) =>
        files
          .filter(predicate)
          .reduce((total, file) => total + chargedBytes(file), 0);
      const held =
        typeof locks?.query === "function"
          ? ((await locks.query()).held ?? [])
          : [];
      for (const file of files)
        if (
          held.some(
            (lock) =>
              lock.name === evidenceLockName(projectId, `file:${file.ref.id}`),
          )
        ) {
          protectedIds.add(file.ref.id);
          if (
            !owners.some(
              (owner) =>
                owner.kind !== "removal" &&
                owner.artifactIds.includes(file.ref.id),
            ) &&
            !catalogs.some(({ catalog }) =>
              catalog.files.some((ref) => ref.id === file.ref.id),
            )
          )
            pendingIds.add(file.ref.id);
        }
      const blockers = [
        ...new Set([
          ...(!locks ? ["coordination-unavailable"] : []),
          ...(held.some((lock) => lock.name === evidenceLockName(projectId))
            ? ["legacy-project-consumer"]
            : []),
          ...held
            .filter((lock) =>
              lock.name?.startsWith(evidenceLockName(projectId, "run:")),
            )
            .map(
              (lock) =>
                `in-use:${lock.name!.slice(evidenceLockName(projectId, "run:").length)}`,
            ),
        ]),
      ];
      let originQuota: { usage?: number; quota?: number } | undefined;
      try {
        const estimate = await globalThis.navigator?.storage?.estimate?.();
        if (estimate)
          originQuota = {
            ...(estimate.usage === undefined ? {} : { usage: estimate.usage }),
            ...(estimate.quota === undefined ? {} : { quota: estimate.quota }),
          };
      } catch {
        /* Origin-wide observation is optional. */
      }
      return {
        scope: "browser-project",
        usedBytes: sum(() => true),
        logicalBytes: files.reduce(
          (total, file) => total + file.ref.byteLength,
          0,
        ),
        reservedBytes: 0,
        protectedBytes: sum((file) => protectedIds.has(file.ref.id)),
        reclaimableBytes: sum((file) => !protectedIds.has(file.ref.id)),
        pendingReclaimBytes: sum((file) => pendingIds.has(file.ref.id)),
        fileCount: files.length,
        catalogCount: catalogs.length,
        byteLimit,
        fileLimit,
        blockers,
        ...(originQuota ? { originQuota } : {}),
      };
    },
    async publishEvidence(entries, catalog) {
      const current = generation;
      const bodies: Array<{ ref: ArtifactRef } & EncodedArtifact> = [];
      for await (const { ref, text } of entries) {
        if (new TextEncoder().encode(text).byteLength !== ref.byteLength)
          throw new Error("ARTIFACT_CAPACITY");
        const encoded = (await runArtifactCodec({
          action: "encode",
          text,
          mediaType: ref.mediaType,
          compression,
        })) as EncodedArtifact;
        bodies.push({ ref, ...encoded });
        if (current !== generation) throw new Error("SESSION_CHANGED");
      }
      const record = catalog();
      await admit(bodies);
      const db = await open();
      try {
        const tx = db.transaction(
          [BODY, DIRECTORY, CATALOGS, REFERENCES],
          "readwrite",
        );
        const done = completed(tx);
        void done.catch(() => {});
        try {
          const directory = tx.objectStore(DIRECTORY);
          const existing = (await value(
            directory.index("projectId").getAll(projectId),
          )) as StoredFile[];
          const byId = new Map(
            existing.map((entry) => [entry.ref.id, entry.ref]),
          );
          const fresh = [];
          for (const entry of bodies) {
            const previous = byId.get(entry.ref.id);
            if (
              previous &&
              JSON.stringify(previous) !== JSON.stringify(entry.ref)
            )
              throw new Error("ARTIFACT_ID_CONFLICT");
            if (!previous) fresh.push(entry);
            byId.set(entry.ref.id, entry.ref);
          }
          const incomingBytes = fresh.reduce(
            (sum, entry) => sum + entry.body.size,
            0,
          );
          const used = existing.reduce(
            (sum, entry) => sum + chargedBytes(entry),
            0,
          );
          if (
            existing.length + fresh.length > fileLimit ||
            used + incomingBytes > byteLimit
          )
            throw capacity(used, incomingBytes, existing.length, fresh.length);
          if (current !== generation) throw new Error("SESSION_CHANGED");
          for (const { ref, body, encoding, storedBytes } of fresh) {
            tx.objectStore(BODY).put(body, [projectId, ref.id]);
            directory.put({ projectId, ref, encoding, storedBytes }, [
              projectId,
              ref.id,
            ]);
          }
          for (const ref of record.catalog.files)
            if (!byId.has(ref.id)) throw new Error("ARTIFACT_UNAVAILABLE");
          tx.objectStore(CATALOGS).put({ projectId, ...record }, [
            projectId,
            record.catalog.runId,
          ]);
          if (
            record.catalog.collection === "complete" &&
            record.catalog.execution === "completed"
          )
            tx.objectStore(REFERENCES).put(
              {
                projectId,
                kind: "latest",
                runId: record.catalog.runId,
                artifactIds: [],
              },
              [projectId, "latest"],
            );
          if (current !== generation) throw new Error("SESSION_CHANGED");
          // The catalog becomes the owner in the same transaction as its bodies.
          const refs = tx.objectStore(REFERENCES);
          const pending = (await value(
            refs.get([projectId, producerOwner]),
          )) as { artifactIds: string[] } | undefined;
          if (pending) {
            const published = new Set(
              record.catalog.files.map((ref) => ref.id),
            );
            const artifactIds = pending.artifactIds.filter(
              (id) => !published.has(id),
            );
            if (artifactIds.length)
              refs.put({ projectId, kind: "producer", artifactIds }, [
                projectId,
                producerOwner,
              ]);
            else refs.delete([projectId, producerOwner]);
          }
          const [owners, keys] = await Promise.all([
            value(refs.index("projectId").getAll(projectId)) as Promise<
              Array<{ kind?: string; runId?: string; artifactIds: string[] }>
            >,
            value(refs.index("projectId").getAllKeys(projectId)),
          ]);
          owners.forEach((owner, index) => {
            if (owner.kind === "reader" && owner.runId === record.catalog.runId)
              refs.put(
                {
                  ...owner,
                  artifactIds: [
                    ...new Set([
                      ...owner.artifactIds,
                      ...record.catalog.files.map((ref) => ref.id),
                    ]),
                  ],
                },
                keys[index]!,
              );
          });
          if (current !== generation) throw new Error("SESSION_CHANGED");
          await done;
          announceEvidenceChange(projectId);
        } catch (error) {
          try {
            tx.abort();
          } catch {
            /* already inactive */
          }
          await done.catch(() => {});
          throw error;
        }
      } finally {
        db.close();
      }
    },
    async pinRun(runId, artifactIds = []) {
      const current = generation;
      const coordination = new ProjectEvidenceLease(projectId, locks);
      const pin = new ProjectEvidenceLease(projectId, locks, `run:${runId}`);
      const owner = `reader:${crypto.randomUUID()}`;
      const reader = new ProjectEvidenceLease(projectId, locks, owner);
      runPins.set(pin, owner);
      runPins.set(reader, owner);
      try {
        await coordination.acquire();
        await pin.acquire();
        await reader.acquire();
        const db = await open();
        try {
          const tx = db.transaction([CATALOGS, REFERENCES], "readwrite");
          const done = completed(tx);
          const record = (await value(
            tx.objectStore(CATALOGS).get([projectId, runId]),
          )) as StoredResultCatalog | undefined;
          if (current !== generation) {
            tx.abort();
            await done.catch(() => {});
            throw new Error("SESSION_CHANGED");
          }
          tx.objectStore(REFERENCES).put(
            {
              projectId,
              kind: "reader",
              runId,
              artifactIds: [
                ...new Set([
                  ...artifactIds,
                  ...(record?.catalog.files.map((ref) => ref.id) ?? []),
                ]),
              ],
            },
            [projectId, owner],
          );
          await done;
        } finally {
          db.close();
        }
      } catch (error) {
        runPins.delete(pin);
        runPins.delete(reader);
        await pin.release();
        await reader.release();
        throw error;
      } finally {
        await coordination.release();
      }
      return () =>
        (async () => {
          runPins.delete(pin);
          runPins.delete(reader);
          await pin.release();
          await reader.release();
          const store = createBrowserSimulationArtifactStore(
            projectId,
            factory,
            options.locks ? { locks: options.locks } : {},
          )!;
          await store.releaseReferences(owner);
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
        })().catch(() => {});
    },
    async removeCachedCatalogs(entries) {
      if (!entries.length) return [];
      const db = await open();
      try {
        const tx = db.transaction([CATALOGS, REFERENCES], "readwrite");
        const done = completed(tx);
        void done.catch(() => {});
        try {
          const catalogs = tx.objectStore(CATALOGS);
          const removed: string[] = [];
          for (const { runId, storedAt } of entries) {
            const record = (await value(catalogs.get([projectId, runId]))) as
              StoredResultCatalog | undefined;
            if (
              record?.catalog.retentionPolicy !== "cache" ||
              record.storedAt !== storedAt
            )
              continue;
            catalogs.delete([projectId, runId]);
            tx.objectStore(REFERENCES).put(
              {
                projectId,
                kind: "removal",
                runId,
                artifactIds: record.catalog.files.map((ref) => ref.id),
              },
              [projectId, `removal:${runId}`],
            );
            removed.push(runId);
          }
          await done;
          return removed;
        } catch (error) {
          tx.abort();
          await done.catch(() => {});
          throw error;
        }
      } finally {
        db.close();
      }
    },
    async usage() {
      const db = await open();
      try {
        const tx = db.transaction(
          [DIRECTORY, CATALOGS, REFERENCES],
          "readonly",
        );
        const [files, catalogs, owners] = await Promise.all([
          value(
            tx.objectStore(DIRECTORY).index("projectId").getAll(projectId),
          ) as Promise<StoredFile[]>,
          value(
            tx.objectStore(CATALOGS).index("projectId").getAll(projectId),
          ) as Promise<StoredResultCatalog[]>,
          value(
            tx.objectStore(REFERENCES).index("projectId").getAll(projectId),
          ) as Promise<Array<{ kind?: string; artifactIds: string[] }>>,
          completed(tx),
        ]);
        const protectedIds = new Set([
          ...catalogs.flatMap((record) =>
            record.catalog.files.map((file) => file.id),
          ),
          ...owners
            .filter((owner) => owner.kind !== "removal")
            .flatMap((owner) => owner.artifactIds),
        ]);
        const unreferenced = files.filter(
          (file) => !protectedIds.has(file.ref.id),
        );
        const { createBrowserSimulationArchiveStore } =
          await import("./browser-simulation-archive-store");
        const archives = createBrowserSimulationArchiveStore({
          idbFactory: factory!,
          ...(options.locks ? { locks: options.locks } : {}),
        });
        let pendingArchiveRemovals = 0;
        try {
          const pending = await archives.pendingRemovalCount(projectId);
          if (!pending.ok) throw new Error(pending.message);
          pendingArchiveRemovals = pending.value;
        } finally {
          archives.close();
        }
        return {
          fileCount: files.length,
          byteLength: files.reduce((sum, file) => sum + chargedBytes(file), 0),
          unreferencedFileCount: unreferenced.length,
          unreferencedBytes: unreferenced.reduce(
            (sum, file) => sum + chargedBytes(file),
            0,
          ),
          catalogCount: catalogs.length,
          cleanupDeferred:
            pendingArchiveRemovals > 0 ||
            unreferenced.length > 0 ||
            owners.some((owner) => owner.kind === "removal"),
        };
      } finally {
        db.close();
      }
    },
    async runArchives() {
      const { createBrowserSimulationArchiveStore } =
        await import("./browser-simulation-archive-store");
      const archives = createBrowserSimulationArchiveStore({
        idbFactory: factory!,
        ...(options.locks ? { locks: options.locks } : {}),
      });
      try {
        const listed = await archives.runEntries(projectId);
        if (!listed.ok) throw new Error(listed.message);
        return listed.value.map(({ runId, retention }) => ({
          runId,
          retention,
        }));
      } finally {
        archives.close();
      }
    },
    async deleteRun(runId, includeSaved) {
      const { createBrowserSimulationArchiveStore } =
        await import("./browser-simulation-archive-store");
      const archives = createBrowserSimulationArchiveStore({
        idbFactory: factory!,
        ...(options.locks ? { locks: options.locks } : {}),
      });
      try {
        const listed = await archives.runEntries(projectId);
        if (!listed.ok) throw new Error(listed.message);
        const owned = listed.value.filter((entry) => entry.runId === runId);
        if (!includeSaved && owned.some((entry) => entry.retention === "saved"))
          throw new Error("RUN_HISTORY_SAVED");
        for (const entry of owned) {
          const removed = await archives.delete(entry.id);
          if (!removed.ok) throw new Error(removed.message);
        }
        const db = await open();
        try {
          const tx = db.transaction([CATALOGS, REFERENCES], "readwrite");
          const done = completed(tx);
          const previous = (await value(
            tx.objectStore(CATALOGS).get([projectId, runId]),
          )) as StoredResultCatalog | undefined;
          tx.objectStore(CATALOGS).delete([projectId, runId]);
          tx.objectStore(REFERENCES).put(
            {
              projectId,
              kind: "removal",
              runId,
              artifactIds: previous?.catalog.files.map((ref) => ref.id) ?? [],
            },
            [projectId, `removal:${runId}`],
          );
          await done;
        } finally {
          db.close();
        }
        const reclaimed = await archives.cleanup(projectId);
        return {
          archiveCount: owned.length,
          reclaimedFiles: reclaimed.ok ? reclaimed.value.files : 0,
          reclaimedBytes: reclaimed.ok ? reclaimed.value.bytes : 0,
          cleanupDeferred: !reclaimed.ok || reclaimed.value.deferred,
        };
      } finally {
        archives.close();
      }
    },
    async queueRunRemoval(runId) {
      const db = await open();
      try {
        const tx = db.transaction([REFERENCES, CATALOGS], "readwrite");
        const done = completed(tx);
        const [previous, removal] = await Promise.all([
          value(tx.objectStore(CATALOGS).get([projectId, runId])) as Promise<
            StoredResultCatalog | undefined
          >,
          value(
            tx.objectStore(REFERENCES).get([projectId, `removal:${runId}`]),
          ) as Promise<{ artifactIds: string[] } | undefined>,
        ]);
        tx.objectStore(REFERENCES).put(
          {
            projectId,
            kind: "removal",
            runId,
            artifactIds: [
              ...new Set([
                ...(removal?.artifactIds ?? []),
                ...(previous?.catalog.files.map((ref) => ref.id) ?? []),
              ]),
            ],
          },
          [projectId, `removal:${runId}`],
        );
        await done;
      } finally {
        db.close();
      }
    },
    async reclaim(archiveKeys, archiveRunIds) {
      // Each producer generation acquires its unique scoped lock before writing
      // ownership. A retired owner is never reacquired, so this snapshot cannot
      // authorize deletion of a later producer with the same identity.
      const active =
        typeof locks?.query === "function"
          ? new Set((await locks.query()).held?.map((lock) => lock.name))
          : undefined;
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
            StoredFile[]
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
              const viewed = owners.some(
                (reader) =>
                  reader.kind === "reader" && reader.runId === owner.runId,
              );
              const reading = owner.artifactIds.some((id) =>
                active?.has(evidenceLockName(projectId, `file:${id}`)),
              );
              if (!viewed && !reading) refs.delete(key);
            }
          } else if (
            (owner.kind === "producer" || owner.kind === "reader") &&
            active &&
            !active.has(evidenceLockName(projectId, key[1]))
          )
            refs.delete(key);
          else if (key[1].startsWith("archive:") && !retainedKeys.has(key[1]))
            refs.delete(key);
          else owner.artifactIds.forEach((id) => protectedIds.add(id));
        });
        for (const { catalog } of runs)
          if (!removedRuns.has(catalog.runId))
            catalog.files.forEach((file) => protectedIds.add(file.id));
        let count = 0,
          bytes = 0;
        for (const file of files) {
          const { ref } = file;
          if (
            protectedIds.has(ref.id) ||
            active?.has(evidenceLockName(projectId, `file:${ref.id}`))
          )
            continue;
          tx.objectStore(BODY).delete([projectId, ref.id]);
          directory.delete([projectId, ref.id]);
          count++;
          bytes += chargedBytes(file);
        }
        await done;
        announceEvidenceChange(projectId);
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
      const retiredOwner = producerOwner;
      const retiredReaders = [...new Set(runPins.values())];
      generation++;
      startup = undefined;
      const released = Promise.all([
        lease?.release(),
        ...[...runPins.keys()].map((pin) => pin.release()),
      ]);
      runPins.clear();
      producerOwner = `producer:${crypto.randomUUID()}`;
      lease = options.retainSession
        ? new ProjectEvidenceLease(projectId, locks, producerOwner)
        : undefined;
      // Remove this generation's staged references without acquiring another
      // lifetime. Crash recovery also removes them through the scoped lock check.
      return released
        .then(async () => {
          if (!options.retainSession && !retiredReaders.length) return;
          const cleanupStore = createBrowserSimulationArtifactStore(
            projectId,
            factory,
            options.locks ? { locks: options.locks } : {},
          );
          if (!cleanupStore) return;
          await cleanupStore.releaseReferences(retiredOwner);
          for (const owner of retiredReaders)
            await cleanupStore.releaseReferences(owner);
        })
        .catch(() => {});
    },
    async retainReferences(owner, artifactIds, context) {
      await retainReferenceOwners([{ owner, artifactIds, ...context }]);
    },
    async retainReferencesMany(owners) {
      await retainReferenceOwners(owners);
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
      const current = generation;
      const db = await open();
      try {
        const tx = db.transaction([CATALOGS, REFERENCES], "readwrite");
        const done = completed(tx);
        tx.objectStore(CATALOGS).put(
          { projectId, catalog: record.catalog, storedAt: record.storedAt },
          [projectId, record.catalog.runId],
        );
        if (
          record.catalog.collection === "complete" &&
          record.catalog.execution === "completed"
        )
          tx.objectStore(REFERENCES).put(
            {
              projectId,
              kind: "latest",
              runId: record.catalog.runId,
              artifactIds: [],
            },
            [projectId, "latest"],
          );
        const refs = tx.objectStore(REFERENCES);
        const [owners, keys] = await Promise.all([
          value(refs.index("projectId").getAll(projectId)) as Promise<
            Array<{ kind?: string; runId?: string; artifactIds: string[] }>
          >,
          value(refs.index("projectId").getAllKeys(projectId)),
        ]);
        owners.forEach((owner, index) => {
          if (owner.kind === "reader" && owner.runId === record.catalog.runId)
            refs.put(
              {
                ...owner,
                artifactIds: [
                  ...new Set([
                    ...owner.artifactIds,
                    ...record.catalog.files.map((ref) => ref.id),
                  ]),
                ],
              },
              keys[index]!,
            );
        });
        if (lease) {
          const key = [projectId, producerOwner];
          const pending = (await value(refs.get(key))) as
            { artifactIds: string[] } | undefined;
          if (pending) {
            const published = new Set(
              record.catalog.files.map((ref) => ref.id),
            );
            const artifactIds = pending.artifactIds.filter(
              (id) => !published.has(id),
            );
            if (artifactIds.length)
              refs.put({ projectId, kind: "producer", artifactIds }, key);
            else refs.delete(key);
          }
        }
        if (current !== generation) {
          tx.abort();
          await done.catch(() => {});
          throw new Error("SESSION_CHANGED");
        }
        await done;
        announceEvidenceChange(projectId);
      } finally {
        db.close();
      }
    },
    async catalog(runId) {
      const db = await open();
      try {
        const tx = db.transaction(CATALOGS, "readonly");
        const done = completed(tx);
        const record = (await value(
          tx.objectStore(CATALOGS).get([projectId, runId]),
        )) as StoredResultCatalog | undefined;
        await done;
        return record ?? null;
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
      const current = generation;
      if (
        new Blob([text]).size !== ref.byteLength ||
        ref.byteLength > MAX_ARTIFACT_BYTES
      )
        throw new Error("ARTIFACT_CAPACITY");
      const { body, encoding, storedBytes } = (await runArtifactCodec({
        action: "encode",
        text,
        mediaType: ref.mediaType,
        compression,
      })) as EncodedArtifact;
      await admit([{ ref, body }]);
      const db = await open();
      try {
        const tx = db.transaction([BODY, DIRECTORY, REFERENCES], "readwrite");
        // Attach both handlers before requests, including failure paths.
        let failure: unknown;
        const done = completed(tx).catch((error: unknown) => {
          failure = error;
        });
        try {
          if (current !== generation) throw new Error("SESSION_CHANGED");
          const directory = tx.objectStore(DIRECTORY);
          const entries: StoredFile[] = await value(
            directory.index("projectId").getAll(projectId),
          );
          const existing = entries.find((item) => item.ref.id === ref.id);
          if (existing) {
            if (JSON.stringify(existing.ref) !== JSON.stringify(ref))
              throw new Error("ARTIFACT_ID_CONFLICT");
          } else {
            if (
              entries.length >= fileLimit ||
              entries.reduce(
                (sum, item) => sum + chargedBytes(item),
                body.size,
              ) > byteLimit
            )
              throw capacity(
                entries.reduce((sum, entry) => sum + chargedBytes(entry), 0),
                body.size,
                entries.length,
                1,
              );
            const key = [projectId, ref.id];
            tx.objectStore(BODY).put(body, key);
            directory.put({ projectId, ref, encoding, storedBytes }, key);
          }
          await retainProduced(tx, [ref]);
          if (current !== generation) throw new Error("SESSION_CHANGED");
        } catch (error) {
          tx.abort();
          await done;
          throw error;
        }
        await done;
        if (failure) throw failure;
        announceEvidenceChange(projectId);
      } finally {
        db.close();
      }
    },
    async putMany(entries) {
      const current = generation;
      if (!entries.length) return;
      const bodies: Array<{ ref: ArtifactRef } & EncodedArtifact> = [];
      for (const { ref, text } of entries) {
        if (
          new Blob([text]).size !== ref.byteLength ||
          ref.byteLength > MAX_ARTIFACT_BYTES
        )
          throw new Error("ARTIFACT_CAPACITY");
        bodies.push({
          ref,
          ...((await runArtifactCodec({
            action: "encode",
            text,
            mediaType: ref.mediaType,
            compression,
          })) as EncodedArtifact),
        });
      }
      await admit(bodies);
      const db = await open();
      try {
        const tx = db.transaction([BODY, DIRECTORY, REFERENCES], "readwrite");
        let failure: unknown;
        const done = completed(tx).catch((error: unknown) => {
          failure = error;
        });
        try {
          const directory = tx.objectStore(DIRECTORY);
          const existing: StoredFile[] = await value(
            directory.index("projectId").getAll(projectId),
          );
          const byId = new Map(existing.map((item) => [item.ref.id, item.ref]));
          const fresh = [];
          for (const entry of bodies) {
            const { ref } = entry;
            const previous = byId.get(ref.id);
            if (previous && JSON.stringify(previous) !== JSON.stringify(ref))
              throw new Error("ARTIFACT_ID_CONFLICT");
            if (!previous) fresh.push(entry);
            byId.set(ref.id, ref);
          }
          if (
            existing.length + fresh.length > fileLimit ||
            existing.reduce(
              (sum, item) => sum + chargedBytes(item),
              fresh.reduce((sum, item) => sum + item.body.size, 0),
            ) > byteLimit
          )
            throw capacity(
              existing.reduce((sum, entry) => sum + chargedBytes(entry), 0),
              fresh.reduce((sum, entry) => sum + entry.body.size, 0),
              existing.length,
              fresh.length,
            );
          for (const { ref, body, encoding, storedBytes } of fresh) {
            const key = [projectId, ref.id];
            tx.objectStore(BODY).put(body, key);
            directory.put({ projectId, ref, encoding, storedBytes }, key);
          }
          await retainProduced(
            tx,
            bodies.map((entry) => entry.ref),
          );
          if (current !== generation) throw new Error("SESSION_CHANGED");
        } catch (error) {
          tx.abort();
          await done;
          throw error;
        }
        await done;
        if (failure) throw failure;
        announceEvidenceChange(projectId);
      } finally {
        db.close();
      }
    },
    async get(id) {
      const coordination = new ProjectEvidenceLease(projectId, locks);
      const reader = new ProjectEvidenceLease(projectId, locks, `file:${id}`);
      let db: IDBDatabase | undefined;
      try {
        await coordination.acquire();
        await reader.acquire();
        db = await open();
        const tx = db.transaction([BODY, DIRECTORY], "readonly");
        const key = [projectId, id];
        const [entry, body] = await Promise.all([
          value(tx.objectStore(DIRECTORY).get(key)) as Promise<
            StoredFile | undefined
          >,
          value(tx.objectStore(BODY).get(key)) as Promise<Blob | undefined>,
          completed(tx),
        ]);
        await coordination.release();
        if (!entry || !body) return null;
        if (entry.storedBytes !== undefined && entry.storedBytes !== body.size)
          throw new Error("ARTIFACT_CODEC_INTEGRITY");
        return {
          ref: entry.ref,
          text: (await runArtifactCodec({
            action: "decode",
            body,
            encoding: entry.encoding,
            ref: entry.ref,
          })) as string,
        };
      } finally {
        await reader.release();
        await coordination.release();
        try {
          if (db) {
            const tx = db.transaction(REFERENCES, "readonly");
            const [owners] = await Promise.all([
              value(
                tx.objectStore(REFERENCES).index("projectId").getAll(projectId),
              ) as Promise<Array<{ kind?: string; artifactIds: string[] }>>,
              completed(tx),
            ]);
            if (
              owners.some(
                (owner) =>
                  owner.kind === "removal" && owner.artifactIds.includes(id),
              )
            ) {
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
            }
          }
        } catch {
          /* A completed read does not fail because deferred cleanup failed. */
        } finally {
          db?.close();
        }
      }
    },
  };
}
