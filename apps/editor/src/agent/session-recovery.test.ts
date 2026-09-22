import { describe, expect, it } from "vitest";

import {
  AGENT_SESSION_RECOVERY_STORAGE_KEY,
  clearAgentSessionRecovery,
  readAgentSessionRecovery,
  writeAgentSessionRecovery,
  type BrowserStorageLike,
} from "./session-recovery";
import { hasAgentSessionRecovery } from "./session-recovery-presence";

class MemoryStorage implements BrowserStorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const target = {
  projectId: "project-main",
  projectSessionId: "project-main:1",
  now: 1_000,
};

function record() {
  return {
    version: 1 as const,
    sessionId: "session-1",
    editorSecret: "editor-secret",
    projectId: target.projectId,
    projectSessionId: target.projectSessionId,
    scopes: [
      "circuit.snapshot",
      "editor.semantic-control",
      "project.download",
      "project.import",
      "visual.download",
    ] as const,
    expiresAt: 2_000,
  };
}

describe("Agent same-browser session recovery", () => {
  it("round-trips only the bounded browser reconnect proof", () => {
    const storage = new MemoryStorage();
    writeAgentSessionRecovery(storage, record());

    expect(readAgentSessionRecovery(storage, target)).toEqual(record());
    expect(hasAgentSessionRecovery(storage)).toBe(true);
    expect(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)).not.toContain(
      "agentToken",
    );
    expect(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)).not.toContain(
      "claimCode",
    );
  });

  it("checks Gallery recovery presence without accepting malformed storage", () => {
    const storage = new MemoryStorage();
    expect(hasAgentSessionRecovery(storage)).toBe(false);
    storage.setItem(AGENT_SESSION_RECOVERY_STORAGE_KEY, "not-json");
    expect(hasAgentSessionRecovery(storage)).toBe(false);
    storage.setItem(
      AGENT_SESSION_RECOVERY_STORAGE_KEY,
      JSON.stringify({ ...record(), sessionId: "" }),
    );
    expect(hasAgentSessionRecovery(storage)).toBe(false);
  });

  it("deletes malformed records and preserves pairing across Projects; the server verifies deadlines", () => {
    const storage = new MemoryStorage();
    storage.setItem(AGENT_SESSION_RECOVERY_STORAGE_KEY, "not-json");
    expect(readAgentSessionRecovery(storage, target)).toBeNull();
    expect(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)).toBeNull();

    writeAgentSessionRecovery(storage, { ...record(), expiresAt: target.now });
    expect(readAgentSessionRecovery(storage, target)).toEqual({
      ...record(),
      expiresAt: target.now,
    });

    writeAgentSessionRecovery(storage, record());
    expect(
      readAgentSessionRecovery(storage, {
        ...target,
        projectSessionId: "different-project:1",
      }),
    ).toEqual(record());
  });

  it("clears recovery only when a terminal lifecycle action requests it", () => {
    const storage = new MemoryStorage();
    writeAgentSessionRecovery(storage, record());
    clearAgentSessionRecovery(storage);
    expect(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)).toBeNull();
  });
});
