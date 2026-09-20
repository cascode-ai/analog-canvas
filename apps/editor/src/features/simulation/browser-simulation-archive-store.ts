import {
  readSimulationRunArchive,
  summarizeSimulationRunArchive,
  type SimulationRunArchiveSummary,
  type SimulationRunArchiveV1,
} from "./simulation-run-archive";

const DATABASE_NAME = "analog-canvas-simulation-archives";
const DATABASE_VERSION = 2;
const STORE_NAME = "runs";
const DIRECTORY_NAME = "run-directory";
const MAX_ARCHIVES_PER_PROJECT = 10;

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
          value: readSimulationRunArchive(value),
        };
      } catch (error) {
        return failure(error);
      }
    },
    async save(archive) {
      try {
        const db = await open();
        const transaction = db.transaction(
          [STORE_NAME, DIRECTORY_NAME],
          "readwrite",
        );
        const directory = transaction.objectStore(DIRECTORY_NAME);
        const done = transactionDone(transaction);
        const existing: SimulationRunArchiveSummary[] = await requestValue(
          directory.index("projectId").getAll(archive.projectId),
        );
        const store = transaction.objectStore(STORE_NAME);
        const summary = summarizeSimulationRunArchive(archive);
        store.put(archive, archive.id);
        directory.put(summary, archive.id);
        const ordered = [
          ...existing.filter((item) => item.id !== archive.id),
          summary,
        ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        for (const stale of ordered.slice(MAX_ARCHIVES_PER_PROJECT)) {
          store.delete(stale.id);
          directory.delete(stale.id);
        }
        await done;
        return { ok: true, value: summary };
      } catch (error) {
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
        transaction.objectStore(STORE_NAME).delete(id);
        transaction.objectStore(DIRECTORY_NAME).delete(id);
        await transactionDone(transaction);
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
