import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import {
  BROWSER_RECOVERY_DATABASE_NAME,
  BROWSER_RECOVERY_STORE_NAME,
  createBrowserRecoveryStore,
  migrateLegacyProjectRecovery,
  type BrowserRecoveryStore,
} from "./browser-recovery-store";
import {
  finalizeBrowserRecoveryRecord,
  type BrowserRecoveryRecordDraft,
  type BrowserRecoveryRecordV2,
  type BrowserRecoverySession,
} from "./browser-recovery-contract";
import { PROJECT_RECOVERY_KEY } from "./project-recovery";

const project = createEmptyProject("project-alpha", "Alpha Amp");
const projectText = serializeProject(project);

let recordCounter = 0;

function draft(
  overrides: Partial<BrowserRecoveryRecordDraft> = {},
): BrowserRecoveryRecordDraft {
  recordCounter += 1;
  return {
    recordId: `record-${recordCounter}`,
    workingCopyId: "copy-a",
    generation: "latest",
    projectId: project.id,
    projectName: project.name,
    projectSchemaVersion: project.schemaVersion,
    topDocumentId: project.topDocumentId,
    documentRevisions: { [project.topDocumentId]: 1 },
    source: "new",
    updatedAt: `2026-08-14T10:0${recordCounter % 10}:00.000Z`,
    projectText,
    ...overrides,
  };
}

function record(overrides: Partial<BrowserRecoveryRecordDraft> = {}) {
  return finalizeBrowserRecoveryRecord(draft(overrides));
}

function freshStore(): { store: BrowserRecoveryStore; factory: IDBFactory } {
  const factory = new IDBFactory() as unknown as IDBFactory;
  const store = createBrowserRecoveryStore({ idbFactory: factory });
  return { store, factory };
}

function firstSession(read: {
  sessions: BrowserRecoverySession[];
}): BrowserRecoverySession {
  const session = read.sessions[0];
  if (session === undefined) {
    throw new Error("expected at least one stored session");
  }
  return session;
}

/**
 * Wrap a fake factory so puts into the recovery store fail with the given
 * DOMException once `failFromPut` (1-based) is reached. Every other request,
 * including reads inside the same transaction, keeps working, which is how
 * real quota errors surface on the write request only.
 */
function withFailingPuts(
  factory: IDBFactory,
  failFromPut: number,
  error: DOMException,
): IDBFactory {
  let putCount = 0;
  const wrapped = Object.create(factory) as IDBFactory;
  wrapped.open = ((name: string, version?: number) => {
    const request = factory.open(name, version);
    request.addEventListener("success", () => {
      const db = request.result;
      const originalTransaction = db.transaction.bind(db);
      db.transaction = ((
        stores: string | string[],
        mode?: IDBTransactionMode,
      ) => {
        const transaction = originalTransaction(stores, mode);
        const originalObjectStore = transaction.objectStore.bind(transaction);
        transaction.objectStore = (storeName: string) => {
          const objectStore = originalObjectStore(storeName);
          if (storeName === BROWSER_RECOVERY_STORE_NAME) {
            const originalPut = objectStore.put.bind(objectStore);
            objectStore.put = (value: unknown, key?: IDBValidKey) => {
              putCount += 1;
              if (putCount >= failFromPut) {
                return failingRequest(error);
              }
              return originalPut(value, key);
            };
          }
          return objectStore;
        };
        return transaction;
      }) as IDBDatabase["transaction"];
    });
    return request;
  }) as IDBFactory["open"];
  return wrapped;
}

function failingRequest(error: DOMException): IDBRequest {
  const pending: { onerror: ((event: Event) => void) | null } = {
    onerror: null,
  };
  let onsuccess: ((event: Event) => void) | null = null;
  Promise.resolve().then(() => {
    pending.onerror?.(new Event("error"));
    onsuccess?.(new Event("success"));
  });
  return {
    get error() {
      return error;
    },
    get result() {
      return undefined;
    },
    get readyState() {
      return "pending";
    },
    set onerror(handler) {
      pending.onerror = handler;
    },
    get onerror() {
      return pending.onerror;
    },
    set onsuccess(handler) {
      onsuccess = handler;
    },
    get onsuccess() {
      return onsuccess;
    },
  } as unknown as IDBRequest;
}

async function readForeignRecords(
  factory: IDBFactory,
  databaseName: string,
  storeName: string,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }
      const tx = db.transaction(storeName, "readonly");
      const getAll = tx.objectStore(storeName).getAll();
      getAll.onsuccess = () => {
        resolve(getAll.result);
        db.close();
      };
      getAll.onerror = () => {
        reject(getAll.error);
        db.close();
      };
    };
  });
}

async function writeForeignRecord(
  factory: IDBFactory,
  databaseName: string,
  storeName: string,
  value: unknown,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(storeName, "readwrite");
      if (!db.objectStoreNames.contains(storeName)) {
        reject(new Error("foreign store missing"));
        return;
      }
      const put = tx.objectStore(storeName).put(value, "foreign-key");
      put.onsuccess = () => resolve();
      put.onerror = () => reject(put.error);
      tx.oncomplete = () => db.close();
    };
  });
}

describe("createBrowserRecoveryStore", () => {
  it("stores a first record and reads it back as a session", async () => {
    const { store } = freshStore();
    const outcome = await store.writeRecord(record());
    expect(outcome).toMatchObject({ status: "stored" });
    const read = await store.readAll();
    expect(read.status).toBe("ready");
    expect(read.sessions).toHaveLength(1);
    expect(firstSession(read).latest?.workingCopyId).toBe("copy-a");
    expect(firstSession(read).previous).toBeNull();
  });

  it("rotates latest to previous on changed content and dedups identical text", async () => {
    const { store } = freshStore();
    const first = record({ recordId: "record-1", projectText });
    await store.writeRecord(first);
    const changedProject = createEmptyProject("project-alpha", "Alpha Amp v2");
    const changedText = serializeProject(changedProject);
    const second = await store.writeRecord(
      record({
        recordId: "record-2",
        projectText: changedText,
        projectName: "Alpha Amp v2",
      }),
    );
    expect(second).toMatchObject({ status: "stored" });
    const afterChange = await store.readAll();
    expect(firstSession(afterChange).latest?.recordId).toBe("record-2");
    expect(firstSession(afterChange).previous?.recordId).toBe("record-1");

    const deduped = await store.writeRecord(
      record({ recordId: "record-3", projectText: changedText }),
    );
    expect(deduped).toEqual({ status: "unchanged" });
    const afterRepeat = await store.readAll();
    expect(firstSession(afterRepeat).latest?.recordId).toBe("record-2");
    expect(firstSession(afterRepeat).previous?.recordId).toBe("record-1");
  });

  it("prunes the oldest inactive session when a third session appears", async () => {
    const { store } = freshStore();
    await store.writeRecord(
      record({
        workingCopyId: "copy-old",
        recordId: "record-old",
        updatedAt: "2026-08-14T08:00:00.000Z",
      }),
    );
    await store.writeRecord(
      record({
        workingCopyId: "copy-mid",
        recordId: "record-mid",
        updatedAt: "2026-08-14T09:00:00.000Z",
      }),
    );
    const third = await store.writeRecord(
      record({
        workingCopyId: "copy-new",
        recordId: "record-new",
        updatedAt: "2026-08-14T10:00:00.000Z",
      }),
    );
    expect(third).toMatchObject({
      status: "stored",
      deletedRecordIds: ["record-old"],
    });
    const read = await store.readAll();
    const ids = read.sessions.map((session) => session.workingCopyId).sort();
    expect(ids).toEqual(["copy-mid", "copy-new"]);
  });

  it("rejects an oversized candidate without touching stored records", async () => {
    const { store } = freshStore();
    await store.writeRecord(record({ recordId: "record-good" }));
    const outcome = await store.writeRecord(
      record({
        recordId: "record-huge",
        projectText: `${projectText}${"x".repeat(5 * 1024 * 1024)}`,
      }),
    );
    expect(outcome).toMatchObject({ status: "rejected-too-large" });
    const read = await store.readAll();
    expect(read.sessions).toHaveLength(1);
    expect(firstSession(read).latest?.recordId).toBe("record-good");
  });

  it("maps a quota failure on put to quota-exceeded and leaves prior records readable", async () => {
    const factory = new IDBFactory() as unknown as IDBFactory;
    const store = createBrowserRecoveryStore({
      idbFactory: withFailingPuts(
        factory,
        2,
        new DOMException("quota", "QuotaExceededError"),
      ),
    });
    const first = await store.writeRecord(record({ recordId: "record-1" }));
    expect(first).toMatchObject({ status: "stored" });
    const second = await store.writeRecord(
      record({
        recordId: "record-2",
        projectText: serializeProject(
          createEmptyProject("project-alpha", "Alpha Amp v2"),
        ),
      }),
    );
    expect(second).toEqual({
      status: "failed",
      failure: "quota-exceeded",
      message: "quota",
    });
    const read = await store.readAll();
    expect(read.status).toBe("ready");
    expect(read.sessions).toHaveLength(1);
    expect(firstSession(read).latest?.recordId).toBe("record-1");
  });

  it("maps a missing IndexedDB environment to storage-unavailable", async () => {
    const store = createBrowserRecoveryStore({});
    const read = await store.readAll();
    expect(read).toMatchObject({
      status: "failed",
      failure: "storage-unavailable",
    });
    const write = await store.writeRecord(record());
    expect(write).toMatchObject({
      status: "failed",
      failure: "storage-unavailable",
    });
  });

  it("never touches records in another database or object store", async () => {
    const { store, factory } = freshStore();
    await writeForeignRecord(factory, "foreign-database", "foreign-store", {
      keep: true,
    });
    await writeForeignRecord(
      factory,
      BROWSER_RECOVERY_DATABASE_NAME,
      "foreign-store",
      { keep: true },
    );
    await store.writeRecord(
      record({
        workingCopyId: "copy-old",
        updatedAt: "2026-08-14T08:00:00.000Z",
      }),
    );
    await store.writeRecord(
      record({
        workingCopyId: "copy-mid",
        updatedAt: "2026-08-14T09:00:00.000Z",
      }),
    );
    await store.writeRecord(
      record({
        workingCopyId: "copy-new",
        updatedAt: "2026-08-14T10:00:00.000Z",
      }),
    );
    expect(
      await readForeignRecords(factory, "foreign-database", "foreign-store"),
    ).toEqual([{ keep: true }]);
    expect(
      await readForeignRecords(
        factory,
        BROWSER_RECOVERY_DATABASE_NAME,
        "foreign-store",
      ),
    ).toEqual([{ keep: true }]);
  });

  it("keeps undecodable records untouched and separate from valid sessions", async () => {
    const { store, factory } = freshStore();
    await store.writeRecord(record({ recordId: "record-valid" }));
    // A future-format record must survive our reads and writes unchanged.
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(BROWSER_RECOVERY_DATABASE_NAME);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(BROWSER_RECOVERY_STORE_NAME, "readwrite");
        const put = tx
          .objectStore(BROWSER_RECOVERY_STORE_NAME)
          .put({ format: "analog-canvas-browser-recovery-v99" }, "future-key");
        put.onsuccess = () => undefined;
        put.onerror = () => reject(put.error);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    const read = await store.readAll();
    expect(read.status).toBe("ready");
    expect(read.undecodableCount).toBe(1);
    expect(read.sessions).toHaveLength(1);
    await store.writeRecord(
      record({
        recordId: "record-next",
        projectText: serializeProject(
          createEmptyProject("project-alpha", "v3"),
        ),
      }),
    );
    const after = await store.readAll();
    expect(after.undecodableCount).toBe(1);
    expect(firstSession(after).latest?.recordId).toBe("record-next");
  });

  it("reopens the database idempotently from a second store instance", async () => {
    const factory = new IDBFactory() as unknown as IDBFactory;
    const first = createBrowserRecoveryStore({ idbFactory: factory });
    await first.writeRecord(record({ recordId: "record-1" }));
    first.close();
    const second = createBrowserRecoveryStore({ idbFactory: factory });
    const read = await second.readAll();
    expect(read.status).toBe("ready");
    expect(firstSession(read).latest?.recordId).toBe("record-1");
    const write = await second.writeRecord(
      record({
        recordId: "record-2",
        projectText: serializeProject(createEmptyProject("p", "n")),
      }),
    );
    expect(write).toMatchObject({ status: "stored" });
    second.close();
  });

  it("deletes exactly one record by id and a whole session by working copy", async () => {
    const { store } = freshStore();
    await store.writeRecord(
      record({
        workingCopyId: "copy-a",
        recordId: "record-a1",
        updatedAt: "2026-08-14T10:00:00.000Z",
      }),
    );
    await store.writeRecord(
      record({
        workingCopyId: "copy-a",
        recordId: "record-a2",
        updatedAt: "2026-08-14T10:01:00.000Z",
        projectText: serializeProject(createEmptyProject("p", "v2")),
      }),
    );
    await store.writeRecord(
      record({
        workingCopyId: "copy-b",
        recordId: "record-b1",
        updatedAt: "2026-08-14T10:02:00.000Z",
      }),
    );
    const one = await store.deleteRecord("record-a1");
    expect(one).toEqual({ status: "deleted", count: 1 });
    const afterOne = await store.readAll();
    expect(afterOne.sessions).toHaveLength(2);
    expect(
      afterOne.sessions.find((s) => s.workingCopyId === "copy-a")?.previous,
    ).toBeNull();
    const session = await store.deleteSession("copy-a");
    expect(session).toEqual({ status: "deleted", count: 1 });
    const afterSession = await store.readAll();
    expect(afterSession.sessions).toHaveLength(1);
    expect(firstSession(afterSession).workingCopyId).toBe("copy-b");
  });

  it("reports zero deletions for unknown ids and sessions", async () => {
    const { store } = freshStore();
    await store.writeRecord(record());
    expect(await store.deleteRecord("missing")).toEqual({
      status: "deleted",
      count: 0,
    });
    expect(await store.deleteSession("missing-copy")).toEqual({
      status: "deleted",
      count: 0,
    });
  });
});

describe("migrateLegacyProjectRecovery", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      has: (key: string) => data.has(key),
    };
  }

  async function migrate(
    storage: ReturnType<typeof memoryStorage>,
    store: BrowserRecoveryStore,
  ) {
    return migrateLegacyProjectRecovery({
      store,
      getLegacyStorage: () => storage,
      createWorkingCopyId: () => "copy-migrated",
      createRecordId: () => "record-migrated",
      now: () => "2026-08-14T12:00:00.000Z",
    });
  }

  it("returns not-needed when the legacy slot is empty", async () => {
    const { store } = freshStore();
    const outcome = await migrate(memoryStorage(), store);
    expect(outcome).toEqual({ status: "not-needed" });
  });

  it("migrates a valid legacy Project and removes the key only after commit", async () => {
    const { store } = freshStore();
    const storage = memoryStorage({ [PROJECT_RECOVERY_KEY]: projectText });
    const outcome = await migrate(storage, store);
    expect(outcome).toEqual({
      status: "migrated",
      workingCopyId: "copy-migrated",
      recordId: "record-migrated",
    });
    expect(storage.has(PROJECT_RECOVERY_KEY)).toBe(false);
    const read = await store.readAll();
    expect(read.sessions).toHaveLength(1);
    expect(firstSession(read).workingCopyId).toBe("copy-migrated");
    expect(firstSession(read).latest?.source).toBe("recovered");
  });

  it("stores a schema-21 legacy slot as internally consistent schema 22", async () => {
    const { store } = freshStore();
    const previous = JSON.parse(projectText);
    previous.schemaVersion = 21;
    delete previous.documents[0].connectivityEvidence;
    const previousText = JSON.stringify(previous);
    const storage = memoryStorage({ [PROJECT_RECOVERY_KEY]: previousText });

    expect(await migrate(storage, store)).toMatchObject({ status: "migrated" });
    const latest = firstSession(await store.readAll()).latest!;
    expect(latest.projectSchemaVersion).toBe(22);
    expect(JSON.parse(latest.projectText).schemaVersion).toBe(22);
  });

  it("retains an unsupported-schema legacy slot", async () => {
    const { store } = freshStore();
    const futureText = JSON.stringify({
      ...JSON.parse(projectText),
      schemaVersion: 99,
    });
    const storage = memoryStorage({ [PROJECT_RECOVERY_KEY]: futureText });
    const outcome = await migrate(storage, store);
    expect(outcome).toMatchObject({
      status: "retained",
      reason: "unsupported-schema",
    });
    expect(storage.has(PROJECT_RECOVERY_KEY)).toBe(true);
    expect((await store.readAll()).sessions).toHaveLength(0);
  });

  it("retains a corrupt legacy slot", async () => {
    const { store } = freshStore();
    const storage = memoryStorage({ [PROJECT_RECOVERY_KEY]: "not a project" });
    const outcome = await migrate(storage, store);
    expect(outcome).toMatchObject({ status: "retained", reason: "corrupt" });
    expect(storage.has(PROJECT_RECOVERY_KEY)).toBe(true);
  });

  it("retains the legacy slot when the store write fails", async () => {
    const factory = new IDBFactory() as unknown as IDBFactory;
    const store = createBrowserRecoveryStore({
      idbFactory: withFailingPuts(
        factory,
        1,
        new DOMException("boom", "UnknownError"),
      ),
    });
    const storage = memoryStorage({ [PROJECT_RECOVERY_KEY]: projectText });
    const outcome = await migrate(storage, store);
    expect(outcome).toMatchObject({
      status: "retained",
      reason: "store-failed",
    });
    expect(storage.has(PROJECT_RECOVERY_KEY)).toBe(true);
  });

  it("retains the legacy slot when IndexedDB is unavailable", async () => {
    const store = createBrowserRecoveryStore({});
    const storage = memoryStorage({ [PROJECT_RECOVERY_KEY]: projectText });
    const outcome = await migrate(storage, store);
    expect(outcome).toMatchObject({
      status: "retained",
      reason: "store-unavailable",
    });
    expect(storage.has(PROJECT_RECOVERY_KEY)).toBe(true);
  });
});

describe("record size precheck", () => {
  it("uses the contract limit as an executable constant", async () => {
    const { store } = freshStore();
    const huge: BrowserRecoveryRecordV2 = record({
      projectText: `${projectText}${"x".repeat(5 * 1024 * 1024)}`,
    });
    const outcome = await store.writeRecord(huge);
    expect(outcome.status).toBe("rejected-too-large");
    if (outcome.status === "rejected-too-large") {
      expect(outcome.byteLength).toBeGreaterThan(4 * 1024 * 1024);
    }
  });
});
