import { describe, expect, it } from "vitest";

import {
  readDismissedStartupRecoveries,
  rememberDismissedStartupRecovery,
} from "./startup-recovery-dismissals";

describe("startup recovery offers are made once", () => {
  it("remembers each turned-down record across reloads, newest last, within a limit", () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    };
    expect(readDismissedStartupRecoveries(storage).size).toBe(0);
    rememberDismissedStartupRecovery("record-a", storage);
    rememberDismissedStartupRecovery("record-b", storage);
    rememberDismissedStartupRecovery("record-a", storage);
    // A fresh page reads what the last one remembered.
    expect([...readDismissedStartupRecoveries(storage)]).toEqual([
      "record-b",
      "record-a",
    ]);
    for (let index = 0; index < 60; index += 1)
      rememberDismissedStartupRecovery(`record-${index}`, storage);
    const kept = readDismissedStartupRecoveries(storage);
    expect(kept.size).toBe(50);
    expect(kept.has("record-59")).toBe(true);
    expect(kept.has("record-a")).toBe(false);
  });

  it("reads nothing from damaged or missing storage", () => {
    expect(
      readDismissedStartupRecoveries({ getItem: () => "{not json" }).size,
    ).toBe(0);
    expect(readDismissedStartupRecoveries(null).size).toBe(0);
  });
});
