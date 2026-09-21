import { describe, expect, it, vi, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createProjectWorkspaceStore,
  journalProjectWorkspace,
  type ProjectWorkspace,
} from "./project-workspace";

function workspace(windowId = "first", savedAt = 1): ProjectWorkspace {
  return {
    version: 1,
    windowId,
    savedAt,
    url: "/editor",
    activeId: "tab3",
    tabs: [1, 2, 3, 4].map((n) => ({
      id: `tab${n}`,
      session: { text: `unsaved-${n}` },
    })),
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("browser project workspace", () => {
  it("persists all tabs atomically across store restarts, isolated by window and URL", async () => {
    const factory = new IDBFactory();
    const store = createProjectWorkspaceStore(factory);
    await store.write(workspace());
    await store.write(workspace("second", 2));
    store.close();
    const reopened = createProjectWorkspaceStore(factory);
    expect(await reopened.read("first", "/editor")).toEqual(workspace());
    expect(await reopened.read("second", "/editor")).toEqual(
      workspace("second", 2),
    );
    expect(await reopened.read("first", "/g/other")).toBeNull();
    expect(await reopened.read("new-window", "/editor")).toBeNull();
    reopened.close();
  });
  it("an immediate-refresh journal wins only when newer and for the same window", async () => {
    const memory = new Map();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => memory.get(key),
      setItem: (key: string, value: string) => memory.set(key, value),
    });
    const store = createProjectWorkspaceStore(new IDBFactory());
    await store.write(workspace());
    journalProjectWorkspace(workspace("first", 3));
    expect((await store.read("first", "/editor"))?.savedAt).toBe(3);
    journalProjectWorkspace(workspace("second", 8));
    expect((await store.read("first", "/editor"))?.savedAt).toBe(1);
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("Quota", "QuotaExceededError");
      },
    });
    expect(() => journalProjectWorkspace(workspace())).toThrow("Quota");
    expect(await store.read("first", "/editor")).toEqual(workspace());
    // Uncloneable update aborts before replacing the last committed record.
    await expect(
      store.write({ ...workspace(), tabs: [{ id: "bad", session: () => {} }] }),
    ).rejects.toThrow();
    expect(await store.read("first", "/editor")).toEqual(workspace());
    store.close();
  });
});
