import { describe, expect, it } from "vitest";

import {
  clearDeletedCloudProjects,
  forgetRecentCloudProject,
  noteCloudProjectDeleted,
  readDeletedCloudProjects,
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
    expect(readDeletedCloudProjects(unavailable)).toEqual(new Set());
    expect(() => noteCloudProjectDeleted("cloud-1", unavailable)).not.toThrow();
    expect(() => clearDeletedCloudProjects(unavailable)).not.toThrow();
  });

  it("carries Cloud Projects deleted away from the editor back to it (#1599)", () => {
    const storage = memoryStorage();
    expect(readDeletedCloudProjects(storage)).toEqual(new Set());
    noteCloudProjectDeleted("cloud-1", storage);
    noteCloudProjectDeleted("cloud-2", storage);
    noteCloudProjectDeleted("cloud-1", storage);
    expect(readDeletedCloudProjects(storage)).toEqual(
      new Set(["cloud-1", "cloud-2"]),
    );
    clearDeletedCloudProjects(storage);
    expect(readDeletedCloudProjects(storage)).toEqual(new Set());
    storage.setItem("analog-canvas.deleted-cloud-projects.v1", "{broken");
    expect(readDeletedCloudProjects(storage)).toEqual(new Set());
  });
});
