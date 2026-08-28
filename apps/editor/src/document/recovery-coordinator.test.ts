import { describe, expect, it, vi, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import { createBrowserRecoveryStore } from "./browser-recovery-store";
import {
  WORKING_COPY_STORAGE_KEY,
  createRecoveryCoordinator,
  type RecoveryCoordinator,
  type RecoverySessionSummary,
  type RecoveryState,
} from "./recovery-coordinator";

function memorySessionStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    has: (key: string) => data.has(key),
  };
}

function fakes() {
  const handles: ReturnType<typeof vi.fn>[] = [];
  const timers: Map<unknown, () => void> = new Map();
  const setTimeout = vi.fn((handler: () => void, _ms: number) => {
    const handle = { handler };
    timers.set(handle, handler);
    handles.push(setTimeout);
    return handle;
  });
  const clearTimeout = vi.fn((handle: unknown) => {
    timers.delete(handle);
  });
  const fire = () => {
    const pending = [...timers.values()];
    timers.clear();
    for (const handler of pending) handler();
  };
  return { setTimeout, clearTimeout, fire };
}

interface Harness {
  coordinator: RecoveryCoordinator;
  states: RecoveryState[];
  notices: string[];
  sessions: RecoverySessionSummary[];
  storage: ReturnType<typeof memorySessionStorage>;
  fire: () => void;
  settle: () => Promise<void>;
}

function createHarness(
  options: { initialStorage?: Record<string, string> } = {},
): Harness {
  const factory = new IDBFactory() as unknown as IDBFactory;
  const store = createBrowserRecoveryStore({ idbFactory: factory });
  const storage = memorySessionStorage(options.initialStorage ?? {});
  const timers = fakes();
  const states: RecoveryState[] = [];
  const notices: string[] = [];
  const sessions: RecoverySessionSummary[] = [];
  let idCounter = 0;
  let tick = 0;
  const coordinator = createRecoveryCoordinator({
    store,
    events: {
      onStateChange: (state) => states.push(state),
      onNotice: (message) => notices.push(message),
      onSessionsChange: (next) => {
        sessions.length = 0;
        sessions.push(...next);
      },
    },
    setTimeout: timers.setTimeout as never,
    clearTimeout: timers.clearTimeout as never,
    getSessionStorage: () => storage,
    createId: () => `id-${(idCounter += 1)}`,
    now: () => new Date(2026, 7, 14, 10, 0, 0 + (tick += 1)).toISOString(),
  });
  return {
    coordinator,
    states,
    notices,
    sessions,
    storage,
    fire: timers.fire,
    settle: async () => {
      // Await the serial write chain (and with it the fake-indexeddb
      // transaction) through the coordinator's own settling point instead of
      // racing a wall-clock wait. Every settle site runs after `fire()` or a
      // cancel, so the scheduler holds no candidate and the flush half of
      // `flushNow()` is a no-op — were a supposedly dropped candidate still
      // pending, it would be written and fail the test's readAll assertions.
      await coordinator.flushNow();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

const projectA = createEmptyProject("project-alpha", "Alpha");
const projectB = createEmptyProject("project-alpha", "Beta");
const projectC = createEmptyProject("project-gamma", "Gamma");

describe("createRecoveryCoordinator", () => {
  it("creates and persists a working-copy identity", () => {
    const harness = createHarness();
    expect(harness.coordinator.workingCopyId).toBe("id-1");
    expect(harness.storage.getItem(WORKING_COPY_STORAGE_KEY)).toBe("id-1");
  });

  it("reuses the persisted identity so a reload continues the same session", () => {
    const harness = createHarness({
      initialStorage: { [WORKING_COPY_STORAGE_KEY]: "id-existing" },
    });
    expect(harness.coordinator.workingCopyId).toBe("id-existing");
  });

  it("stages a debounced write and publishes pending then stored", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    expect(harness.coordinator.state).toBe("idle");
    harness.fire();
    expect(harness.coordinator.state).toBe("pending");
    await harness.settle();
    expect(harness.coordinator.state).toBe("stored");
    const read = await harness.coordinator.store.readAll();
    expect(read.sessions).toHaveLength(1);
    expect(read.sessions[0]?.latest?.projectText).toBe(
      serializeProject(projectA),
    );
    expect(read.sessions[0]?.latest?.source).toBe("new");
    expect(read.sessions[0]?.latest?.unsavedAtSnapshot).toBe(true);
  });

  it("coalesces a burst of commits into the newest Project", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    harness.coordinator.stage(projectB);
    harness.fire();
    await harness.settle();
    const read = await harness.coordinator.store.readAll();
    expect(read.sessions).toHaveLength(1);
    expect(read.sessions[0]?.latest?.projectText).toBe(
      serializeProject(projectB),
    );
    expect(read.sessions[0]?.previous).toBeNull();
  });

  it("does not consume a generation for an unchanged Project", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    harness.fire();
    await harness.settle();
    harness.coordinator.stage(projectA);
    harness.fire();
    await harness.settle();
    const read = await harness.coordinator.store.readAll();
    expect(read.sessions[0]?.previous).toBeNull();
    expect(read.sessions[0]?.latest?.projectText).toBe(
      serializeProject(projectA),
    );
  });

  it("marks identical content clean without consuming the previous generation", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    await harness.coordinator.flushNow();
    harness.coordinator.stage(projectA, { unsavedAtSnapshot: false });
    await harness.coordinator.flushNow();
    const read = await harness.coordinator.store.readAll();
    expect(read.sessions[0]?.previous).toBeNull();
    expect(read.sessions[0]?.latest?.unsavedAtSnapshot).toBe(false);
  });

  it("rotates previous generations across separate writes", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    harness.fire();
    await harness.settle();
    harness.coordinator.stage(projectB);
    harness.fire();
    await harness.settle();
    const read = await harness.coordinator.store.readAll();
    expect(read.sessions[0]?.latest?.projectText).toBe(
      serializeProject(projectB),
    );
    expect(read.sessions[0]?.previous?.projectText).toBe(
      serializeProject(projectA),
    );
  });

  it("flushNow writes a pending Project without waiting for the timer", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    const state = await harness.coordinator.flushNow();
    expect(state).toBe("stored");
    const read = await harness.coordinator.store.readAll();
    expect(read.sessions[0]?.latest?.projectText).toBe(
      serializeProject(projectA),
    );
  });

  it("cancelPending drops a scheduled write", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    harness.coordinator.cancelPending();
    harness.fire();
    await harness.settle();
    const read = await harness.coordinator.store.readAll();
    expect(read.sessions).toHaveLength(0);
  });

  it("never loses the newest revision while a write is in flight", async () => {
    const factory = new IDBFactory() as unknown as IDBFactory;
    const realStore = createBrowserRecoveryStore({ idbFactory: factory });
    let releaseFirst: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const release = (): void => {
      releaseFirst?.();
    };
    let first = true;
    const blockingStore: typeof realStore = {
      ...realStore,
      writeRecord: async (record) => {
        if (first) {
          first = false;
          await gate;
        }
        return realStore.writeRecord(record);
      },
    };
    const storage = memorySessionStorage();
    const timers = fakes();
    const coordinator = createRecoveryCoordinator({
      store: blockingStore,
      setTimeout: timers.setTimeout as never,
      clearTimeout: timers.clearTimeout as never,
      getSessionStorage: () => storage,
      createId: () => "id-wc",
      now: () => new Date(2026, 7, 14, 10, 0, 0).toISOString(),
    });
    coordinator.stage(projectA);
    timers.fire();
    await Promise.resolve();
    await Promise.resolve();
    // Project B is committed while A's IndexedDB transaction is still in
    // flight; the serial chain must write B after A completes.
    coordinator.stage(projectB);
    timers.fire();
    release();
    const state = await coordinator.flushNow();
    expect(state).toBe("stored");
    const read = await realStore.readAll();
    expect(read.sessions[0]?.latest?.projectText).toBe(
      serializeProject(projectB),
    );
    expect(read.sessions[0]?.previous?.projectText).toBe(
      serializeProject(projectA),
    );
  });

  it("beginWorkingCopy forks the identity, keeps outgoing records, and re-sources", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    harness.fire();
    await harness.settle();
    const next = harness.coordinator.beginWorkingCopy("opened-file");
    expect(next).not.toBe("id-1");
    expect(harness.storage.getItem(WORKING_COPY_STORAGE_KEY)).toBe(next);
    harness.coordinator.stage(projectC);
    await harness.coordinator.flushNow();
    const read = await harness.coordinator.store.readAll();
    const ids = read.sessions.map((session) => session.workingCopyId).sort();
    expect(ids).toEqual(["id-1", next].sort());
    const incoming = read.sessions.find(
      (session) => session.workingCopyId === next,
    );
    expect(incoming?.latest?.source).toBe("opened-file");
    expect(incoming?.latest?.projectText).toBe(serializeProject(projectC));
  });

  it("beginWorkingCopy drops a pending write for the outgoing Project", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    harness.coordinator.beginWorkingCopy("opened-file");
    harness.fire();
    await harness.settle();
    const read = await harness.coordinator.store.readAll();
    expect(read.sessions).toHaveLength(0);
  });

  it("maps quota-exceeded to its state and keeps prior records", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    harness.fire();
    await harness.settle();
    vi.spyOn(harness.coordinator.store, "writeRecord").mockResolvedValue({
      status: "failed",
      failure: "quota-exceeded",
      message: "simulated quota",
    });
    harness.coordinator.stage(projectB);
    const state = await harness.coordinator.flushNow();
    expect(state).toBe("quota-exceeded");
    const read = await harness.coordinator.store.readAll();
    expect(read.sessions[0]?.latest?.projectText).toBe(
      serializeProject(projectA),
    );
  });

  it("notices and fails when the store rejects an oversized snapshot", async () => {
    const harness = createHarness();
    vi.spyOn(harness.coordinator.store, "writeRecord").mockResolvedValue({
      status: "rejected-too-large",
      byteLength: 5 * 1024 * 1024,
    });
    harness.coordinator.stage(projectA);
    const state = await harness.coordinator.flushNow();
    expect(state).toBe("failed");
    expect(harness.notices.join(" ")).toContain("4 MB");
  });

  it("discover summarizes and orders sessions with typed reviews", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    harness.fire();
    await harness.settle();
    harness.coordinator.beginWorkingCopy("opened-file");
    harness.coordinator.stage(projectB);
    await harness.coordinator.flushNow();
    await harness.coordinator.discover();
    expect(harness.sessions).toHaveLength(2);
    const byName = harness.sessions.map((s) => s.projectName).sort();
    expect(byName).toEqual(["Alpha", "Beta"]);
    expect(harness.sessions[0]?.latest?.review).toBe("valid");
    expect(harness.sessions[0]?.latest?.revision).not.toBeNull();
    expect(harness.sessions[0]?.latest?.unsavedAtSnapshot).toBe(true);
  });

  it("classifies corrupt and unsupported-schema generations in summaries", async () => {
    const harness = createHarness();
    // Seed one valid and one schema-99 record through the store directly.
    const store = harness.coordinator.store;
    const futureText = JSON.stringify({
      ...JSON.parse(serializeProject(projectA)),
      schemaVersion: 99,
    });
    await store.writeRecord({
      format: "analog-canvas-browser-recovery-v2",
      recordId: "record-future",
      workingCopyId: "copy-future",
      generation: "latest",
      projectId: projectA.id,
      projectName: projectA.name,
      projectSchemaVersion: 99,
      topDocumentId: projectA.topDocumentId,
      documentRevisions: { [projectA.topDocumentId]: 0 },
      source: "new",
      updatedAt: new Date(2026, 7, 14, 9, 0, 0).toISOString(),
      byteLength: futureText.length,
      projectText: futureText,
    });
    const corruptText = "not a project";
    await store.writeRecord({
      format: "analog-canvas-browser-recovery-v2",
      recordId: "record-corrupt",
      workingCopyId: "copy-corrupt",
      generation: "latest",
      projectId: projectA.id,
      projectName: projectA.name,
      projectSchemaVersion: projectA.schemaVersion,
      topDocumentId: projectA.topDocumentId,
      documentRevisions: { [projectA.topDocumentId]: 0 },
      source: "new",
      updatedAt: new Date(2026, 7, 14, 8, 0, 0).toISOString(),
      byteLength: corruptText.length,
      projectText: corruptText,
    });
    await harness.coordinator.discover();
    const future = harness.sessions.find(
      (session) => session.workingCopyId === "copy-future",
    );
    const corrupt = harness.sessions.find(
      (session) => session.workingCopyId === "copy-corrupt",
    );
    expect(future?.latest?.review).toBe("unsupported-schema");
    expect(corrupt?.latest?.review).toBe("corrupt");
  });

  it("readSessionProject returns typed results per generation", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    harness.fire();
    await harness.settle();
    harness.coordinator.stage(projectB);
    await harness.coordinator.flushNow();
    const id = harness.coordinator.workingCopyId;
    const latest = await harness.coordinator.readSessionProject(id, "latest");
    expect(latest).toMatchObject({ status: "valid" });
    if (latest.status === "valid") {
      expect(latest.project.name).toBe("Beta");
    }
    const previous = await harness.coordinator.readSessionProject(
      id,
      "previous",
    );
    expect(previous).toMatchObject({ status: "valid" });
    if (previous.status === "valid") {
      expect(previous.project.name).toBe("Alpha");
    }
    const missing = await harness.coordinator.readSessionProject(
      "unknown-copy",
      "latest",
    );
    expect(missing).toMatchObject({ status: "missing" });
  });

  it("deleteSession removes exactly one session", async () => {
    const harness = createHarness();
    harness.coordinator.stage(projectA);
    harness.fire();
    await harness.settle();
    harness.coordinator.beginWorkingCopy("opened-file");
    harness.coordinator.stage(projectC);
    await harness.coordinator.flushNow();
    const removed = await harness.coordinator.deleteSession("id-1");
    expect(removed).toBe(true);
    const read = await harness.coordinator.store.readAll();
    expect(read.sessions).toHaveLength(1);
    expect(read.sessions[0]?.workingCopyId).not.toBe("id-1");
  });
});
