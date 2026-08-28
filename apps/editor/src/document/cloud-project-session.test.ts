import { describe, expect, it } from "vitest";

import {
  forgetRecentCloudProject,
  readRecentCloudProjectId,
  rememberRecentCloudProject,
  type CloudProjectSessionStorage,
} from "./cloud-project-session";

function memoryStorage(): CloudProjectSessionStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("Cloud Project tab session", () => {
  it("remembers only the active Cloud Project identity", () => {
    const storage = memoryStorage();

    expect(readRecentCloudProjectId(storage)).toBeNull();
    rememberRecentCloudProject("cloud-1", storage);
    expect(readRecentCloudProjectId(storage)).toBe("cloud-1");
    forgetRecentCloudProject(storage);
    expect(readRecentCloudProjectId(storage)).toBeNull();
  });

  it("treats unavailable browser storage as optional navigation state", () => {
    const unavailable: CloudProjectSessionStorage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };

    expect(readRecentCloudProjectId(unavailable)).toBeNull();
    expect(() =>
      rememberRecentCloudProject("cloud-1", unavailable),
    ).not.toThrow();
    expect(() => forgetRecentCloudProject(unavailable)).not.toThrow();
  });
});
