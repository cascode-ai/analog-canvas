import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import type { Prepared, Run } from "@icm/simulation-service/contract";
import { SimulationFiles } from "@icm/simulation-service/files";
import { createBrowserSimulationArchiveStore } from "./browser-simulation-archive-store";
import { restoreSimulationRunArchive } from "./simulation-run-archive";
import { ProjectRunHistory } from "./project-run-history";

async function fixture() {
  const files = new SimulationFiles();
  const outputData = {
    schemaVersion: 1 as const,
    analyses: [],
    diagnostics: [],
  };
  const artifact = await files.put(
    "outputs.json",
    "application/json",
    JSON.stringify(outputData),
  );
  const prepared: Prepared = {
    id: "prepared",
    digest: "a".repeat(64),
    inputRevision: "input",
    expiresAt: 100,
    mode: "source",
    environment: { profileId: "test" },
    vectors: [],
    outputs: [],
    deviceOperatingPoints: [],
    artifacts: [],
    warnings: [],
  };
  const run: Run = {
    id: "run",
    preparedId: prepared.id,
    inputRevision: prepared.inputRevision,
    state: "finished",
    artifacts: [artifact],
    outputData,
  };
  return {
    files,
    prepared,
    run,
    owner: "agent" as const,
    presentation: {
      folderId: "folder",
      folderName: "AC",
      analysisLabel: "AC",
      outputs: [],
    },
    active: () => true,
    read: vi.fn(async () => ({ ok: true as const, run })),
  };
}

describe("Project result handoff", () => {
  it.each([false, true])(
    "retains more than ten page results when persistence failure is %s",
    async (fail) => {
      const input = await fixture();
      const store = createBrowserSimulationArchiveStore({
        idbFactory: new IDBFactory(),
      });
      if (fail)
        vi.spyOn(store, "save").mockResolvedValue({
          ok: false,
          code: "quota-exceeded",
          message: "Quota full",
        });
      const history = new ProjectRunHistory("project", store);
      try {
        for (let i = 0; i < 12; i++) {
          history.track({ ...input, run: { ...input.run, id: `run-${i}` } });
          await vi.waitFor(() =>
            expect(
              history.snapshot().find((record) => record.id === `run-${i}`)
                ?.archive,
            ).toBeDefined(),
          );
        }
        expect(history.snapshot()).toHaveLength(12);
        const first = history
          .snapshot()
          .find((record) => record.id === "run-0")!;
        if (fail) {
          expect(first.memoryArchive?.artifacts).toHaveLength(1);
          expect(first.error).toContain("session only");
        } else {
          expect(first.memoryArchive).toBeUndefined();
          expect(await store.read(first.archive!.id)).toMatchObject({
            ok: true,
            value: { run: { id: "run-0" } },
          });
        }
      } finally {
        history.dispose();
      }
    },
  );
  it("does not open or save archives when disposed during lazy handoff", async () => {
    const input = await fixture();
    const store = createBrowserSimulationArchiveStore({
      idbFactory: new IDBFactory(),
    });
    const save = vi.spyOn(store, "save");
    const history = new ProjectRunHistory("project", store);
    history.track(input);
    history.dispose();
    await import("./simulation-run-archive");
    await import("./browser-simulation-archive-store");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(save).not.toHaveBeenCalled();
    expect(history.snapshot()[0]?.archive).toBeUndefined();
  });
  it("polls independently, archives once and restores after the owner and registry close", async () => {
    const input = await fixture();
    const idbFactory = new IDBFactory();
    const store = createBrowserSimulationArchiveStore({ idbFactory });
    const history = new ProjectRunHistory("project", store);
    history.dispose();
    history.activate();
    const start = {
      ...input,
      run: { ...input.run, state: "running" as const },
    };
    history.track(start);
    history.track(start);
    expect(history.snapshot()).toHaveLength(1);
    await vi.waitFor(
      () => expect(history.snapshot()[0]?.archive).toBeDefined(),
      { timeout: 3000 },
    );
    await vi.waitFor(async () =>
      expect((await store.list("project")).ok).toBe(true),
    );
    expect(input.read).toHaveBeenCalledTimes(1);
    const archiveId = history.snapshot()[0]!.archive!.id;
    expect(history.snapshot()[0]?.memoryArchive).toBeUndefined();
    expect(history.snapshot()[0]?.archive).not.toHaveProperty("artifacts");
    await vi.waitFor(async () =>
      expect(await store.read(archiveId)).toMatchObject({
        ok: true,
        value: { id: archiveId },
      }),
    );
    history.dispose();
    input.files.clear();
    const reopened = createBrowserSimulationArchiveStore({ idbFactory });
    const stored = await reopened.read(archiveId);
    expect(stored.ok && stored.value?.presentation.origin).toBe("agent");
    if (!stored.ok || !stored.value) throw Error("Missing archive");
    expect(
      await restoreSimulationRunArchive(new SimulationFiles(), stored.value),
    ).toMatchObject({
      ok: true,
      value: { run: { id: "run", outputData: input.run.outputData } },
    });
    reopened.close();
  });
  it("removes a deleted archive from live results as well as saved listings", async () => {
    const input = await fixture();
    const store = createBrowserSimulationArchiveStore({
      idbFactory: new IDBFactory(),
    });
    const history = new ProjectRunHistory("project", store);
    history.track(input);
    await vi.waitFor(() =>
      expect(history.snapshot()[0]?.archive).toBeDefined(),
    );
    history.forgetArchive(history.snapshot()[0]!.archive!.id);
    expect(history.snapshot()).toEqual([]);
    history.dispose();
  });
  it("keeps a viewable memory result and explains a persistence failure", async () => {
    const input = await fixture();
    const store = createBrowserSimulationArchiveStore({
      idbFactory: new IDBFactory(),
    });
    vi.spyOn(store, "save").mockResolvedValue({
      ok: false,
      code: "quota-exceeded",
      message: "Quota full",
    });
    const history = new ProjectRunHistory("project", store);
    history.track(input);
    await vi.waitFor(() =>
      expect(history.snapshot()[0]?.error).toContain("session only"),
    );
    expect(history.snapshot()[0]?.archive).toBeDefined();
    expect(history.snapshot()[0]?.memoryArchive?.artifacts).toHaveLength(1);
    expect(
      await restoreSimulationRunArchive(
        new SimulationFiles(),
        history.snapshot()[0]!.memoryArchive!,
      ),
    ).toMatchObject({ ok: true });
    history.dispose();
  });
  it("stops polling a revoked owner without calling another owner or deleting completed results", async () => {
    const input = await fixture();
    const history = new ProjectRunHistory(
      "project",
      createBrowserSimulationArchiveStore({ idbFactory: new IDBFactory() }),
    );
    history.track({
      ...input,
      active: () => false,
      run: { ...input.run, state: "running" },
    });
    await vi.waitFor(() => expect(history.snapshot()[0]?.state).toBe("lost"), {
      timeout: 2000,
    });
    expect(input.read).not.toHaveBeenCalled();
    history.dispose();
  });
});
