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
