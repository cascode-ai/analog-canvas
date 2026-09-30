// Transactional IndexedDB adapter for bounded browser recovery records.
//
// This module owns storage only. Every limit, rotation, deduplication, and
// retention decision comes from `browser-recovery-contract.ts`; the store
// executes those decisions inside single IndexedDB transactions so a failed
// or quota-rejected write leaves every previous record readable.
//
// The database and object store names are application-specific and this store
// never issues `deleteDatabase`, `clear`, or any operation against another
// database or object store. Records left undecodable by a future format
// change are left untouched rather than deleted.

import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  ProjectFormatError,
  serializeProject,
} from "@icm/project-protocol";

import {
  BROWSER_RECOVERY_MAX_RECORD_BYTES,
  browserRecoveryByteLength,
  browserRecoveryRecordKey,
  decodeBrowserRecoveryRecord,
  finalizeBrowserRecoveryRecord,
  planBrowserRecoveryRetention,
  rotateBrowserRecoverySession,
  type BrowserRecoveryGeneration,
  type BrowserRecoveryRecordV2,
  type BrowserRecoverySession,
} from "./browser-recovery-contract";
import {
  PROJECT_RECOVERY_KEY,
  type ProjectRecoveryStorage,
} from "./project-recovery";

export const BROWSER_RECOVERY_DATABASE_NAME = "analog-canvas-recovery";
export const BROWSER_RECOVERY_STORE_NAME = "browser-recovery-v2";
export const BROWSER_RECOVERY_DATABASE_VERSION = 1;

export type BrowserRecoveryStorageFailure =
  "quota-exceeded" | "storage-unavailable" | "storage-failed";

export type BrowserRecoveryWriteOutcome =
  | {
      status: "stored";
      record: BrowserRecoveryRecordV2;
      deletedRecordIds: string[];
      /** The open working copies alone exceed the total byte cap. */
      overCapacity: boolean;
    }
  | { status: "unchanged"; overCapacity: boolean }
  | { status: "rejected-too-large"; byteLength: number }
  | {
      status: "failed";
      failure: BrowserRecoveryStorageFailure;
      message: string;
    };

export interface BrowserRecoveryReadOutcome {
  status: "ready" | "failed";
  sessions: BrowserRecoverySession[];
  undecodableCount: number;
  failure?: BrowserRecoveryStorageFailure;
  message?: string;
}

export type BrowserRecoveryDeleteOutcome =
  | { status: "deleted"; count: number }
  | {
      status: "failed";
      failure: BrowserRecoveryStorageFailure;
      message: string;
    };

export interface BrowserRecoveryStoreSeams {
  /** Injectable IndexedDB factory for deterministic tests. */
  readonly idbFactory?: IDBFactory;
}

interface StoredRecord {
  key: string;
  record: BrowserRecoveryRecordV2;
}

export interface BrowserRecoveryStore {
  /** Decode all owned records, grouped into working-copy sessions. */
  readAll(): Promise<BrowserRecoveryReadOutcome>;
  /**
   * Atomically rotate the candidate into its session's `latest` slot and
   * apply retention. A rejected, unchanged, or failed candidate performs no
   * destructive operation. `openWorkingCopyIds` names the working copies
   * the editor has open besides the candidate's: retention never evicts
   * their latest copy.
   */
  writeRecord(
    candidate: BrowserRecoveryRecordV2,
    openWorkingCopyIds?: readonly string[],
  ): Promise<BrowserRecoveryWriteOutcome>;
  /** Delete exactly the record with this id, if owned by this store. */
  deleteRecord(recordId: string): Promise<BrowserRecoveryDeleteOutcome>;
  /** Delete every owned record of one working-copy session. */
  deleteSession(workingCopyId: string): Promise<BrowserRecoveryDeleteOutcome>;
  /** Close the database connection, if one was opened. */
  close(): void;
}

function classifyStorageFailure(error: unknown): BrowserRecoveryStorageFailure {
  if (error instanceof RecoveryStorageUnavailableError) {
    return "storage-unavailable";
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") return "quota-exceeded";
  if (
    name === "NotFoundError" ||
    name === "InvalidStateError" ||
    name === "SecurityError" ||
    name === "VersionError"
  ) {
    return "storage-unavailable";
  }
  return "storage-failed";
}

/** Thrown when the runtime exposes no IndexedDB at all (SSR, hard denial). */
class RecoveryStorageUnavailableError extends Error {
  constructor() {
    super("IndexedDB is unavailable in this environment");
    this.name = "RecoveryStorageUnavailable";
  }
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "storage failed";
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("transaction failed"));
  });
}

function groupStoredRecords(
  entries: ReadonlyArray<{ key: IDBValidKey; value: unknown }>,
): { stored: StoredRecord[]; undecodableCount: number } {
  const stored: StoredRecord[] = [];
  let undecodableCount = 0;
  for (const entry of entries) {
    const decoded = decodeBrowserRecoveryRecord(entry.value);
    if (decoded.status === "valid") {
      stored.push({ key: String(entry.key), record: decoded.record });
    } else {
      undecodableCount += 1;
    }
  }
  return { stored, undecodableCount };
}

function buildSessions(
  stored: ReadonlyArray<StoredRecord>,
): Map<string, BrowserRecoverySession> {
  const sessions = new Map<string, BrowserRecoverySession>();
  const upsert = (
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
    record: BrowserRecoveryRecordV2,
  ) => {
    const session = sessions.get(workingCopyId) ?? {
      workingCopyId,
      latest: null,
      previous: null,
    };
    const existing = session[generation];
    if (
      existing === null ||
      Date.parse(record.updatedAt) >= Date.parse(existing.updatedAt)
    ) {
      session[generation] = record;
    }
    sessions.set(workingCopyId, session);
  };
  for (const { record } of stored) {
    upsert(record.workingCopyId, record.generation, record);
  }
  return sessions;
}

function rekeyedAs(
  record: BrowserRecoveryRecordV2,
  generation: BrowserRecoveryGeneration,
): BrowserRecoveryRecordV2 {
  return record.generation === generation ? record : { ...record, generation };
}

export function createBrowserRecoveryStore(
  seams: BrowserRecoveryStoreSeams = {},
): BrowserRecoveryStore {
  let database: IDBDatabase | null = null;
  let opening: Promise<IDBDatabase> | null = null;

  async function openDatabase(): Promise<IDBDatabase> {
    if (database !== null) return database;
    if (opening !== null) return opening;
    const factory = seams.idbFactory ?? globalThis.indexedDB ?? null;
    if (factory === null) {
      throw new RecoveryStorageUnavailableError();
    }
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(
        BROWSER_RECOVERY_DATABASE_NAME,
        BROWSER_RECOVERY_DATABASE_VERSION,
      );
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(BROWSER_RECOVERY_STORE_NAME)) {
          db.createObjectStore(BROWSER_RECOVERY_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("failed to open recovery store"));
      request.onblocked = () =>
        reject(new Error("recovery store upgrade is blocked"));
    });
    try {
      database = await opening;
      return database;
    } catch (error) {
      opening = null;
      throw error;
    }
  }

  /**
   * Run one readwrite transaction: read and decode every owned record, let
   * the caller schedule mutations against decoded records, then wait for
   * commit. Planned deletes run BEFORE any put so a retention delete of a
   * slot the caller rewrites cannot remove the freshly written record.
   */
  async function runMutation(
    mutate: (
      objectStore: IDBObjectStore,
      stored: StoredRecord[],
    ) => Promise<void>,
  ): Promise<void> {
    const db = await openDatabase();
    const transaction = db.transaction(
      BROWSER_RECOVERY_STORE_NAME,
      "readwrite",
    );
    try {
      const objectStore = transaction.objectStore(BROWSER_RECOVERY_STORE_NAME);
      const keys = await requestToPromise(objectStore.getAllKeys());
      const values = await requestToPromise(objectStore.getAll());
      const { stored } = groupStoredRecords(
        keys.map((key, index) => ({ key, value: values[index] })),
      );
      await mutate(objectStore, stored);
      await transactionDone(transaction);
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be closed after the failure.
      }
      throw error;
    }
  }

  function deleteStoredRecords(
    objectStore: IDBObjectStore,
    stored: ReadonlyArray<StoredRecord>,
    shouldDelete: (record: BrowserRecoveryRecordV2) => boolean,
  ): Promise<void> {
    const targets = stored.filter((entry) => shouldDelete(entry.record));
    return (async () => {
      for (const entry of targets) {
        await requestToPromise(objectStore.delete(entry.key));
      }
    })();
  }

  return {
    async readAll(): Promise<BrowserRecoveryReadOutcome> {
      try {
        const db = await openDatabase();
        const transaction = db.transaction(
          BROWSER_RECOVERY_STORE_NAME,
          "readonly",
        );
        const objectStore = transaction.objectStore(
          BROWSER_RECOVERY_STORE_NAME,
        );
        const keys = await requestToPromise(objectStore.getAllKeys());
        const values = await requestToPromise(objectStore.getAll());
        await transactionDone(transaction);
        const { stored, undecodableCount } = groupStoredRecords(
          keys.map((key, index) => ({ key, value: values[index] })),
        );
        return {
          status: "ready",
          sessions: [...buildSessions(stored).values()],
          undecodableCount,
        };
      } catch (error) {
        return {
          status: "failed",
          sessions: [],
          undecodableCount: 0,
          failure: classifyStorageFailure(error),
          message: failureMessage(error),
        };
      }
    },

    async writeRecord(
      candidate: BrowserRecoveryRecordV2,
      openWorkingCopyIds: readonly string[] = [],
    ): Promise<BrowserRecoveryWriteOutcome> {
      const byteLength = browserRecoveryByteLength(candidate.projectText);
      if (byteLength > BROWSER_RECOVERY_MAX_RECORD_BYTES) {
        return { status: "rejected-too-large", byteLength };
      }
      const asLatest: BrowserRecoveryRecordV2 = {
        ...candidate,
        generation: "latest",
      };
      try {
        let written = false;
        let deletedRecordIds: string[] = [];
        let overCapacity = false;
        await runMutation(async (objectStore, stored) => {
          const sessions = buildSessions(stored);
          const current = sessions.get(candidate.workingCopyId) ?? {
            workingCopyId: candidate.workingCopyId,
            latest: null,
            previous: null,
          };
          const rotation = rotateBrowserRecoverySession(current, asLatest);
          if (rotation.status === "rejected-too-large") {
            throw new Error("unreachable: record size pre-checked");
          }
          const others = [...sessions.values()].filter(
            (session) => session.workingCopyId !== candidate.workingCopyId,
          );
          const plan = planBrowserRecoveryRetention(
            [...others, rotation.session],
            new Set([candidate.workingCopyId, ...openWorkingCopyIds]),
          );
          overCapacity = plan.overCapacity;
          const plannedIds = new Set(plan.deleteRecordIds);
          await deleteStoredRecords(objectStore, stored, (record) =>
            plannedIds.has(record.recordId),
          );
          if (rotation.status === "rotated" || rotation.status === "updated") {
            written = true;
            // A previous generation dropped by retention must not be
            // re-written into its new slot.
            const previousCandidate =
              rotation.status === "rotated" ? rotation.session.previous : null;
            const previous =
              previousCandidate !== null &&
              !plannedIds.has(previousCandidate.recordId)
                ? rekeyedAs(previousCandidate, "previous")
                : null;
            await requestToPromise(
              objectStore.put(
                asLatest,
                browserRecoveryRecordKey(asLatest.workingCopyId, "latest"),
              ),
            );
            if (previous !== null) {
              await requestToPromise(
                objectStore.put(
                  previous,
                  browserRecoveryRecordKey(previous.workingCopyId, "previous"),
                ),
              );
            }
          }
          deletedRecordIds = plan.deleteRecordIds;
        });
        if (!written) return { status: "unchanged", overCapacity };
        return {
          status: "stored",
          record: asLatest,
          deletedRecordIds,
          overCapacity,
        };
      } catch (error) {
        return {
          status: "failed",
          failure: classifyStorageFailure(error),
          message: failureMessage(error),
        };
      }
    },

    async deleteRecord(
      recordId: string,
    ): Promise<BrowserRecoveryDeleteOutcome> {
      try {
        let count = 0;
        await runMutation(async (objectStore, stored) => {
          const targets = stored.filter(
            (entry) => entry.record.recordId === recordId,
          );
          count = targets.length;
          await deleteStoredRecords(
            objectStore,
            stored,
            (record) => record.recordId === recordId,
          );
        });
        return { status: "deleted", count };
      } catch (error) {
        return {
          status: "failed",
          failure: classifyStorageFailure(error),
          message: failureMessage(error),
        };
      }
    },

    async deleteSession(
      workingCopyId: string,
    ): Promise<BrowserRecoveryDeleteOutcome> {
      try {
        let count = 0;
        await runMutation(async (objectStore, stored) => {
          const targets = stored.filter(
            (entry) => entry.record.workingCopyId === workingCopyId,
          );
          count = targets.length;
          await deleteStoredRecords(
            objectStore,
            stored,
            (record) => record.workingCopyId === workingCopyId,
          );
        });
        return { status: "deleted", count };
      } catch (error) {
        return {
          status: "failed",
          failure: classifyStorageFailure(error),
          message: failureMessage(error),
        };
      }
    },

    close(): void {
      database?.close();
      database = null;
      opening = null;
    },
  };
}

export type LegacyRecoveryMigrationOutcome =
  | { status: "migrated"; workingCopyId: string; recordId: string }
  | { status: "not-needed" }
  | {
      status: "retained";
      reason:
        | "corrupt"
        | "unsupported-schema"
        | "rejected-too-large"
        | "store-unavailable"
        | "store-failed";
      message: string;
    };

export interface LegacyRecoveryMigrationSeams {
  readonly store: BrowserRecoveryStore;
  /** Injectable localStorage-like slot holding the legacy recovery text. */
  readonly getLegacyStorage?: () => ProjectRecoveryStorage | null;
  readonly createWorkingCopyId?: () => string;
  readonly createRecordId?: () => string;
  readonly now?: () => string;
}

function randomId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * One-time migration of the retired `icm.recovery.v1` localStorage slot into
 * the IndexedDB store. The legacy key is removed ONLY after the IndexedDB
 * transaction commits. Anything that cannot be migrated is retained in place
 * so the user can still download or discard the raw text.
 */
export async function migrateLegacyProjectRecovery(
  seams: LegacyRecoveryMigrationSeams,
): Promise<LegacyRecoveryMigrationOutcome> {
  let storage: ProjectRecoveryStorage | null;
  if (seams.getLegacyStorage !== undefined) {
    storage = seams.getLegacyStorage();
  } else {
    try {
      storage = globalThis.localStorage as ProjectRecoveryStorage | null;
    } catch {
      storage = null;
    }
  }
  if (storage === null || storage === undefined) {
    return { status: "not-needed" };
  }
  const legacyText = storage.getItem(PROJECT_RECOVERY_KEY);
  if (legacyText === null || legacyText.length === 0) {
    return { status: "not-needed" };
  }

  let project;
  try {
    project = parseProject(legacyText);
  } catch (error) {
    if (
      error instanceof ProjectFormatError &&
      error.diagnostics.some(
        (diagnostic) => diagnostic.code === "UNSUPPORTED_SCHEMA_VERSION",
      )
    ) {
      return {
        status: "retained",
        reason: "unsupported-schema",
        message: error.message,
      };
    }
    return {
      status: "retained",
      reason: "corrupt",
      message: error instanceof Error ? error.message : "invalid data",
    };
  }

  const workingCopyId =
    seams.createWorkingCopyId?.() ?? randomId("working-copy");
  const recordId = seams.createRecordId?.() ?? randomId("record");
  const documentRevisions: Record<string, number> = {};
  for (const document of project.documents) {
    documentRevisions[document.id] = document.revision;
  }
  const record = finalizeBrowserRecoveryRecord({
    recordId,
    workingCopyId,
    generation: "latest",
    projectId: project.id,
    projectName: project.name,
    projectSchemaVersion: CURRENT_PROJECT_FILE_VERSION,
    topDocumentId: project.topDocumentId,
    documentRevisions,
    source: "recovered",
    updatedAt: seams.now?.() ?? new Date().toISOString(),
    projectText: serializeProject(project),
  });

  const outcome = await seams.store.writeRecord(record);
  if (outcome.status === "stored" || outcome.status === "unchanged") {
    storage.removeItem(PROJECT_RECOVERY_KEY);
    return { status: "migrated", workingCopyId, recordId };
  }
  if (outcome.status === "rejected-too-large") {
    return {
      status: "retained",
      reason: "rejected-too-large",
      message: "legacy recovery exceeds the 4 MB record limit",
    };
  }
  return {
    status: "retained",
    reason:
      outcome.failure === "storage-unavailable"
        ? "store-unavailable"
        : "store-failed",
    message: outcome.message,
  };
}
