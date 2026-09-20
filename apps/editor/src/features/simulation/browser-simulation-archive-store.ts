import {
  readSimulationRunArchive,
  summarizeSimulationRunArchive,
  type SimulationRunArchiveSummary,
  type SimulationRunArchiveV1,
} from "./simulation-run-archive";
import { createBrowserSimulationArtifactStore } from "./browser-simulation-artifact-store";
import type { ArtifactRef } from "@icm/simulation-service/contract";

const DATABASE_NAME = "analog-canvas-simulation-archives";
const DATABASE_VERSION = 2;
const STORE_NAME = "runs";
const DIRECTORY_NAME = "run-directory";

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
  close(): void;
}

export interface BrowserSimulationArchiveStoreOptions {
  readonly idbFactory?: IDBFactory;
  readonly databaseName?: string;
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

  return {
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
      try {
        // Commit the directory only after every referenced body is durable.
        // Existing records remain usable if any evidence write fails.
        stored = await retain(archive);
        const db = await open();
        const transaction = db.transaction(
          [STORE_NAME, DIRECTORY_NAME],
          "readwrite",
        );
        const directory = transaction.objectStore(DIRECTORY_NAME);
        const done = transactionDone(transaction);
        const store = transaction.objectStore(STORE_NAME);
        const previous = (await requestValue(store.get(archive.id))) as
          StoredArchive | undefined;
        const summary = summarizeSimulationRunArchive(archive);
        store.put(stored, archive.id);
        directory.put(summary, archive.id);
        await done;
        // Old references can safely leak if cleanup fails; the new archive is
        // already committed and must not be reported as a failed save.
        await release(previous);
        return { ok: true, value: summary };
      } catch (error) {
        await release(stored);
        return failure(error);
      }
    },
    async delete(id) {
      try {
        const db = await open();
        const transaction = db.transaction(
          [STORE_NAME, DIRECTORY_NAME],
          "readwrite",
        );
        const done = transactionDone(transaction);
        const store = transaction.objectStore(STORE_NAME);
        const previous = (await requestValue(store.get(id))) as
          StoredArchive | undefined;
        store.delete(id);
        transaction.objectStore(DIRECTORY_NAME).delete(id);
        await done;
        await release(previous);
        return { ok: true, value: true };
      } catch (error) {
        return failure(error);
      }
    },
    close() {
      database?.close();
      database = null;
      opening = null;
    },
  };
}
