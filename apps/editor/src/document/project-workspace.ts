/** A whole browser-window workspace. Independent from bounded crash recovery:
 * no tab can evict another tab's unsaved Project. Never writes Cloud Projects. */
export interface ProjectWorkspace<T = unknown> {
  version: 1;
  windowId: string;
  url: string;
  savedAt: number;
  activeId: string;
  tabs: { id: string; session: T }[];
}
const DATABASE = "analog-canvas-workspaces";
const STORE = "windows";
const WINDOW_KEY = "icm.workspace-window.v1";
const JOURNAL_KEY = "icm.workspace-journal.v1";
let identity: string | undefined;

export function workspaceWindowId(): string {
  if (identity) return identity;
  try {
    identity = sessionStorage.getItem(WINDOW_KEY) || crypto.randomUUID();
    sessionStorage.setItem(WINDOW_KEY, identity);
  } catch {
    identity = undefined;
    throw new Error("Browser session storage is unavailable");
  }
  return identity;
}

function decode(
  value: unknown,
  id: string,
  url: string,
): ProjectWorkspace | null {
  if (!value) return null;
  const record = value as ProjectWorkspace;
  if (record.version !== 1 || record.windowId !== id || record.url !== url)
    return null;
  if (
    !Number.isFinite(record.savedAt) ||
    !Array.isArray(record.tabs) ||
    !record.tabs.length ||
    record.tabs.some((tab) => typeof tab?.id !== "string" || !tab.session) ||
    new Set(record.tabs.map((tab) => tab.id)).size !== record.tabs.length ||
    !record.tabs.some((tab) => tab.id === record.activeId)
  )
    throw new Error(
      "Saved project tabs could not be read. The original workspace is retained.",
    );
  return record;
}

export function createProjectWorkspaceStore(factory: IDBFactory = indexedDB) {
  let database: Promise<IDBDatabase> | undefined;
  const open = () =>
    (database ??= new Promise((resolve, reject) => {
      const request = factory.open(DATABASE, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE, { keyPath: "windowId" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(
          new Error(
            "Close an older editor window to unlock workspace storage.",
          ),
        );
    }));
  return {
    async read(id: string, url: string): Promise<ProjectWorkspace | null> {
      const db = await open();
      const stored = await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      let journal: ProjectWorkspace | null = null;
      try {
        journal = decode(
          JSON.parse(sessionStorage.getItem(JOURNAL_KEY) || "null"),
          id,
          url,
        );
      } catch {
        /* IndexedDB remains the primary snapshot. */
      }
      const record = decode(stored, id, url);
      return journal && (!record || journal.savedAt > record.savedAt)
        ? journal
        : record;
    },
    async write(record: ProjectWorkspace): Promise<void> {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onabort = () =>
          reject(tx.error ?? new Error("Workspace save aborted"));
        tx.onerror = () => reject(tx.error);
      });
    },
    close() {
      void database?.then((db) => db.close());
      database = undefined;
    },
  };
}

/** Synchronous final snapshot covers immediate refresh, before IDB can commit.
 * Quota failure leaves the preceding durable snapshot intact and is reported. */
export function journalProjectWorkspace(record: ProjectWorkspace): void {
  sessionStorage.setItem(JOURNAL_KEY, JSON.stringify(record));
}
