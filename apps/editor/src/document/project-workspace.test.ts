import { describe, expect, it, vi, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createProjectWorkspaceStore,
  holdWorkspaceWindow,
  journalProjectWorkspace,
  openWorkspaceWindows,
  workspaceRoute,
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
    expect(await reopened.read("first", "/editor?example=other")).toBeNull();
    expect(
      await reopened.read("first", "/editor?example=other", {
        allowRouteChange: true,
      }),
    ).toEqual(workspace());
    expect(await reopened.read("new-window", "/editor")).toBeNull();
    reopened.close();
  });
  it("brings a window's tabs back at plain /editor whichever link opened them (#1599)", async () => {
    // Account, Privacy and the Gallery all link back to /editor; the tabs
    // were saved while the address still carried the link that opened them.
    for (const url of [
      "/editor?project=cloud-1",
      "/editor?resume=1",
      "/editor?new=1",
      "/g/entry-1",
      "/editor/",
    ]) {
      const store = createProjectWorkspaceStore(new IDBFactory());
      await store.write({ ...workspace(), url });
      expect(await store.read("first", "/editor")).toEqual({
        ...workspace(),
        url,
      });
      store.close();
    }
    // What the editor saves under is that plain address.
    expect(workspaceRoute("/editor?project=cloud-1&resume=1")).toBe("/editor");
    expect(workspaceRoute("/g/entry-1")).toBe("/editor");
    // A link that starts the window afresh is still another address.
    expect(workspaceRoute("/editor?project=cloud-1&example=bandgap")).toBe(
      "/editor?example=bandgap",
    );
  });
  it("finds the newest workspace another window left and forgets it once taken over (#1250)", async () => {
    const factory = new IDBFactory();
    const store = createProjectWorkspaceStore(factory);
    await store.write(workspace("old", 1));
    await store.write(workspace("open-elsewhere", 9));
    await store.write(workspace("newest-closed", 5));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("analog-canvas-workspaces", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // A damaged record never hides a readable one.
    await new Promise<void>((resolve) => {
      const write = db.transaction("windows", "readwrite");
      write.objectStore("windows").put({ windowId: "broken", version: 1 });
      write.oncomplete = () => resolve();
    });
    db.close();

    const open = new Set(["open-elsewhere"]);
    const skip = (record: ProjectWorkspace) => open.has(record.windowId);
    expect((await store.latestElsewhere("fresh", skip))?.windowId).toBe(
      "newest-closed",
    );
    // A window's own record is never offered back to it.
    expect((await store.latestElsewhere("newest-closed", skip))?.windowId).toBe(
      "old",
    );

    await store.remove("newest-closed");
    expect(
      await store.read("newest-closed", "/editor", { allowRouteChange: true }),
    ).toBeNull();
    expect((await store.latestElsewhere("fresh", skip))?.windowId).toBe("old");
    store.close();
  });
  it("tells open windows by the lock each one holds for its lifetime", async () => {
    const granted = new Set<string>();
    const locks = {
      request: vi.fn(
        async (
          name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => unknown,
        ) => {
          const free = !granted.has(name);
          if (free) granted.add(name);
          // A held lock's callback never settles while its page lives.
          void callback(free ? ({ name, mode: "exclusive" } as Lock) : null);
        },
      ),
      query: vi.fn(async () => ({
        held: [...granted, "someone-else"].map((name) => ({ name })),
        pending: [],
      })),
    } as unknown as Pick<LockManager, "request" | "query">;
    holdWorkspaceWindow("first", locks);
    holdWorkspaceWindow("first", locks); // a duplicated browser tab
    holdWorkspaceWindow("second", locks);
    await Promise.resolve();
    expect(await openWorkspaceWindows(locks)).toEqual(
      new Set(["first", "second"]),
    );
    // Without Web Locks no window is known closed.
    expect(await openWorkspaceWindows(null)).toBeNull();
    const failing = {
      query: () => Promise.reject(new Error("blocked")),
    } as unknown as Pick<LockManager, "request" | "query">;
    expect(await openWorkspaceWindows(failing)).toBeNull();
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
