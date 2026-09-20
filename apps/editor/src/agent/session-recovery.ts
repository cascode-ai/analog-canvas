import {
  isAgentSessionScope,
  type AgentSessionScope,
} from "@icm/agent-adapter";
import {
  AGENT_SESSION_RECOVERY_STORAGE_KEY,
  type BrowserStorageLike,
} from "./session-recovery-presence";

export {
  AGENT_SESSION_RECOVERY_STORAGE_KEY,
  type BrowserStorageLike,
} from "./session-recovery-presence";

export interface AgentSessionRecoveryRecord {
  readonly version: 1;
  readonly sessionId: string;
  readonly editorSecret: string;
  readonly projectId: string;
  readonly projectSessionId: string;
  readonly scopes: readonly AgentSessionScope[];
  readonly expiresAt: number;
}

export interface RecoveryTarget {
  readonly projectId: string;
  readonly projectSessionId: string;
  readonly now: number;
}

function parseRecord(value: unknown): AgentSessionRecoveryRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.sessionId !== "string" ||
    record.sessionId.length === 0 ||
    typeof record.editorSecret !== "string" ||
    record.editorSecret.length === 0 ||
    typeof record.projectId !== "string" ||
    record.projectId.length === 0 ||
    typeof record.projectSessionId !== "string" ||
    record.projectSessionId.length === 0 ||
    !Array.isArray(record.scopes) ||
    !record.scopes.every(isAgentSessionScope) ||
    typeof record.expiresAt !== "number" ||
    !Number.isFinite(record.expiresAt)
  ) {
    return null;
  }
  return {
    version: 1,
    sessionId: record.sessionId,
    editorSecret: record.editorSecret,
    projectId: record.projectId,
    projectSessionId: record.projectSessionId,
    scopes: [...record.scopes],
    expiresAt: record.expiresAt,
  };
}

export function writeAgentSessionRecovery(
  storage: BrowserStorageLike,
  record: AgentSessionRecoveryRecord,
): void {
  storage.setItem(AGENT_SESSION_RECOVERY_STORAGE_KEY, JSON.stringify(record));
}

export function clearAgentSessionRecovery(storage: BrowserStorageLike): void {
  storage.removeItem(AGENT_SESSION_RECOVERY_STORAGE_KEY);
}

/** Local recovery evidence, not an observation of relay availability. */
export function peekAgentSessionRecovery(
  storage: BrowserStorageLike,
): AgentSessionRecoveryRecord | null {
  try {
    return parseRecord(
      JSON.parse(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY) ?? "null"),
    );
  } catch {
    return null;
  }
}

/**
 * Reads a same-browser reconnect proof only when it belongs to the Project that is
 * currently open. Any malformed, expired, or Project-mismatched record is
 * deleted before it can reach the relay.
 */
export function readAgentSessionRecovery(
  storage: BrowserStorageLike,
  target: RecoveryTarget,
): AgentSessionRecoveryRecord | null {
  const raw = storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY);
  if (raw === null) return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw) as unknown;
  } catch {
    clearAgentSessionRecovery(storage);
    return null;
  }
  const record = parseRecord(candidate);
  if (
    record === null ||
    record.expiresAt <= target.now ||
    record.projectId !== target.projectId ||
    record.projectSessionId !== target.projectSessionId
  ) {
    clearAgentSessionRecovery(storage);
    return null;
  }
  return record;
}
