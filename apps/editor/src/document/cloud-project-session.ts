const RECENT_CLOUD_PROJECT_STORAGE_KEY =
  "analog-canvas.recent-cloud-project.v1";

export interface CloudProjectSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserSessionStorage(): CloudProjectSessionStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Return the Cloud Project that this browser tab last treated as active.
 * This is navigation state only: no Project bytes or save authority live here.
 */
export function readRecentCloudProjectId(
  storage: CloudProjectSessionStorage | null = browserSessionStorage(),
): string | null {
  try {
    const value = storage?.getItem(RECENT_CLOUD_PROJECT_STORAGE_KEY)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

/** Remember which formal Cloud Project should reopen after visiting Gallery. */
export function rememberRecentCloudProject(
  projectId: string,
  storage: CloudProjectSessionStorage | null = browserSessionStorage(),
): void {
  try {
    storage?.setItem(RECENT_CLOUD_PROJECT_STORAGE_KEY, projectId);
  } catch {
    // Tab navigation remains usable when sessionStorage is unavailable.
  }
}

/** Clear the tab pointer when the editor deliberately switches to unbound work. */
export function forgetRecentCloudProject(
  storage: CloudProjectSessionStorage | null = browserSessionStorage(),
): void {
  try {
    storage?.removeItem(RECENT_CLOUD_PROJECT_STORAGE_KEY);
  } catch {
    // The pointer is best-effort and never affects Project correctness.
  }
}

const DELETED_CLOUD_PROJECTS_STORAGE_KEY =
  "analog-canvas.deleted-cloud-projects.v1";

/** The Cloud Projects this browser tab deleted away from the editor. */
export function readDeletedCloudProjects(
  storage: CloudProjectSessionStorage | null = browserSessionStorage(),
): Set<string> {
  try {
    const ids: unknown = JSON.parse(
      storage?.getItem(DELETED_CLOUD_PROJECTS_STORAGE_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

/**
 * Note a Cloud Project deleted on the account page or Gallery shelf. The
 * editor's tabs, when this browser tab returns to them, stop treating it as
 * saved (#1599).
 */
export function noteCloudProjectDeleted(
  projectId: string,
  storage: CloudProjectSessionStorage | null = browserSessionStorage(),
): void {
  try {
    const deleted = readDeletedCloudProjects(storage).add(projectId);
    storage?.setItem(
      DELETED_CLOUD_PROJECTS_STORAGE_KEY,
      JSON.stringify([...deleted]),
    );
  } catch {
    // Best effort: the tab then keeps a binding its next Save reports missing.
  }
}

/** Forget the deletions once the editor's tabs have taken them in. */
export function clearDeletedCloudProjects(
  storage: CloudProjectSessionStorage | null = browserSessionStorage(),
): void {
  try {
    storage?.removeItem(DELETED_CLOUD_PROJECTS_STORAGE_KEY);
  } catch {
    // Nothing more is read from it while storage is unavailable.
  }
}
