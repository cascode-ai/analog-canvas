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

const WINDOW_LOCK_PREFIX = "analog-canvas-window:";
type WindowLocks = Pick<LockManager, "request" | "query">;
function browserLocks(): WindowLocks | null {
  return (typeof navigator === "undefined" ? null : navigator.locks) ?? null;
}

/**
 * Holds a lock named after this window until its page goes away, so a fresh
 * window can tell the workspaces of open windows from the ones a closed
 * window left behind (#1250). A second page sharing the window id (a
 * duplicated browser tab) leaves the lock with the first.
 */
export function holdWorkspaceWindow(
  id: string,
  locks: WindowLocks | null = browserLocks(),
): void {
  if (!locks) return;
  void locks
    .request(WINDOW_LOCK_PREFIX + id, { ifAvailable: true }, (lock) =>
      lock ? new Promise<void>(() => {}) : undefined,
    )
    .catch(() => {});
}

/** Ids of the windows whose page is open, or null when the browser cannot
 * tell; then no window counts as closed and nothing is offered. */
export async function openWorkspaceWindows(
  locks: WindowLocks | null = browserLocks(),
): Promise<ReadonlySet<string> | null> {
  if (!locks) return null;
  try {
    const { held = [], pending = [] } = await locks.query();
    return new Set(
      [...held, ...pending].flatMap(({ name }) =>
        name?.startsWith(WINDOW_LOCK_PREFIX)
          ? [name.slice(WINDOW_LOCK_PREFIX.length)]
          : [],
      ),
    );
  } catch {
    return null;
  }
}

function decode(
  value: unknown,
  id: string,
  url: string,
  allowRouteChange = false,
): ProjectWorkspace | null {
  if (!value) return null;
  const record = value as ProjectWorkspace;
  if (
    record.version !== 1 ||
    record.windowId !== id ||
    (!allowRouteChange && record.url !== url)
  )
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
    async read(
      id: string,
      url: string,
      options: { allowRouteChange?: boolean } = {},
    ): Promise<ProjectWorkspace | null> {
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
          options.allowRouteChange,
        );
      } catch {
        /* IndexedDB remains the primary snapshot. */
      }
      const record = decode(stored, id, url, options.allowRouteChange);
      return journal && (!record || journal.savedAt > record.savedAt)
        ? journal
        : record;
    },
    /**
     * The newest workspace another window left behind, which a fresh window
     * offers to reopen (#1250). Records `skip` accepts (a window still open,
     * or one with nothing worth reopening) are passed over, and an
     * unreadable record never hides a readable one.
     */
    async latestElsewhere(
      id: string,
      skip: (record: ProjectWorkspace) => boolean = () => false,
    ): Promise<ProjectWorkspace | null> {
      const db = await open();
      const stored = await new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      let newest: ProjectWorkspace | null = null;
      for (const value of stored) {
        const windowId = (value as ProjectWorkspace | null)?.windowId;
        if (typeof windowId !== "string" || windowId === id) continue;
        let record: ProjectWorkspace | null;
        try {
          record = decode(value, windowId, "", true);
        } catch {
          continue;
        }
        if (!record || skip(record)) continue;
        if (!newest || record.savedAt > newest.savedAt) newest = record;
      }
      return newest;
    },
    /**
     * Forget a closed window's workspace once this window has taken its tabs
     * over and saved them under its own record, so no other window offers
     * the same tabs again (#1250).
     */
    async remove(windowId: string): Promise<void> {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(windowId);
        tx.oncomplete = () => resolve();
        tx.onabort = () =>
          reject(tx.error ?? new Error("Workspace removal aborted"));
        tx.onerror = () => reject(tx.error);
      });
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
