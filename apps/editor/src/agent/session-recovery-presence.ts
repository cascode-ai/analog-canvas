export const AGENT_SESSION_RECOVERY_STORAGE_KEY =
  "icm.agent-session-recovery.v1";

export interface BrowserStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Lightweight runtime-loading hint; full validation stays in the Agent owner. */
export function hasAgentSessionRecovery(storage: BrowserStorageLike): boolean {
  try {
    const value = JSON.parse(
      storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY) ?? "null",
    ) as unknown;
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
      record.version === 1 &&
      typeof record.sessionId === "string" &&
      record.sessionId.length > 0 &&
      typeof record.editorSecret === "string" &&
      record.editorSecret.length > 0 &&
      typeof record.projectId === "string" &&
      record.projectId.length > 0 &&
      typeof record.projectSessionId === "string" &&
      record.projectSessionId.length > 0 &&
      Array.isArray(record.scopes) &&
      typeof record.expiresAt === "number" &&
      Number.isFinite(record.expiresAt)
    );
  } catch {
    return false;
  }
}
