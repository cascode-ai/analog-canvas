import { describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createEmptyProject } from "@icm/model";
import { SimulationFiles } from "@icm/simulation-service/files";
import { createBrowserSimulationArtifactStore } from "./browser-simulation-artifact-store";
import { ProjectRunHistory } from "./project-run-history";
import {
  BrowserSimulationSession,
  unchangedProjectSnapshot,
  isModuleLoadFailure,
} from "./browser-simulation-session";

describe("browser simulation ownership", () => {
  it("does not misreport an execution exception as module loading", async () => {
    const { SimulationService } = await import("@icm/simulation-service");
    const handle = vi
      .spyOn(SimulationService.prototype, "handle")
      .mockRejectedValueOnce(new Error("secret exception"));
    const session = new BrowserSimulationSession({
      getProject: () => createEmptyProject("p", "P"),
      getProjectSessionId: () => "p",
    });
    expect(
      await session.handle({ operation: "capabilities" }, "execution-error"),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_OPERATION_FAILED",
        recovery: "retry-same-request",
        correlationId: "execution-error",
      },
    });
    handle.mockRestore();
    await session.clear();
  });
  it("recognizes loader failures without mistaking execution failures for loading", () => {
    expect(
      isModuleLoadFailure(
        new TypeError(
          "Failed to fetch dynamically imported module: https://example.test/chunk.js",
        ),
      ),
    ).toBe(true);
    expect(isModuleLoadFailure(new Error("invalid circuit"))).toBe(false);
  });
  it("refreshes Project run views after an Agent history deletion", async () => {
    const project = createEmptyProject("project", "Project");
    const files = new SimulationFiles(
      Date.now,
      undefined,
      undefined,
      createBrowserSimulationArtifactStore(project.id, new IDBFactory()),
    );
    await files.saveCatalog({
      schemaVersion: 1,
      runId: "old-run",
      preparedId: "prepared",
      inputRevision: "rev",
      execution: "completed",
      collection: "complete",
      files: [],
      datasets: [],
    });
    const history = new ProjectRunHistory(project.id);
    const forget = vi.spyOn(history, "forgetRun");
    const session = new BrowserSimulationSession({
      files,
      runHistory: history,
      getProject: () => project,
      getProjectSessionId: () => "project",
    });
    expect(
      await session.handle({ operation: "history-delete", runId: "old-run" }),
    ).toMatchObject({ ok: true, deletion: { deleted: true } });
    expect(forget).toHaveBeenCalledWith("old-run");
    await files.saveCatalog({
      schemaVersion: 1,
      runId: "old-run",
      preparedId: "prepared",
      inputRevision: "rev",
      execution: "completed",
      collection: "complete",
      files: [],
      datasets: [],
    });
    forget.mockImplementation(() => {
      throw new Error("history unavailable");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await session.handle({ operation: "history-delete", runId: "old-run" }),
    ).toMatchObject({ ok: true });
    expect(warn).toHaveBeenCalledWith(
      "SIMULATION_HISTORY_UPDATE_FAILED",
      expect.any(Object),
    );
    warn.mockRestore();
    await session.clear();
    history.dispose();
  });
  it("omits the Project snapshot when editing races with preparation", () => {
    const before = createEmptyProject("project", "Before");
    const after = structuredClone(before);
    expect(unchangedProjectSnapshot(before, after)).toContain("Before");
    after.documents[0]!.revision++;
    after.documents[0]!.name = "Changed during prepare";
    expect(unchangedProjectSnapshot(before, after)).toBe("");
  });
  it("loads only on demand, keeps failures recoverable, and isolates owners", async () => {
    const project = createEmptyProject("project", "Project");
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            configured: true,
            inputs: ["structured", "raw"],
            analyses: ["op", "ac"],
            parsedAnalyses: ["op", "ac", "tran"],
            profiles: [],
            maxTimeoutMs: 10000,
            maxInputBytes: 10000,
            cancel: true,
          }),
        ),
    );
    const options = {
      getProject: () => project,
      getProjectSessionId: () => "project",
      fetch,
    };
    const human = new BrowserSimulationSession(options);
    const agent = new BrowserSimulationSession(options);
    expect(fetch).not.toHaveBeenCalled();
    const artifact = await human.files.put(
      "deck.cir",
      "text/plain",
      "test\n.end",
    );
    await agent.clear();
    expect(
      await human.files.handle({ action: "artifact", artifactId: artifact.id }),
    ).toMatchObject({ ok: true, text: "test\n.end" });
    expect(
      await human.handle({
        operation: "prepare",
        source: {
          kind: "project-folder",
          folderId: "missing-folder",
          expectedStructureRevision: project.structureRevision,
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_FOLDER_MISSING" },
    });
    expect(await human.handle({ operation: "capabilities" })).toMatchObject({
      ok: true,
    });
    await human.clear();
    expect(
      await human.files.handle({ action: "artifact", artifactId: artifact.id }),
    ).toMatchObject({ ok: false });
  });
  it("rejects work bound to a replaced Project without touching the new Project", async () => {
    let id = "first";
    const fetch = vi.fn<typeof globalThis.fetch>();
    const session = new BrowserSimulationSession({
      getProject: () => createEmptyProject("project", "Project"),
      getProjectSessionId: () => id,
      fetch,
    });
    id = "second";
    expect(await session.handle({ operation: "capabilities" })).toMatchObject({
      ok: false,
      error: { code: "PROJECT_REPLACED" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not revive an owner cleared while its lazy service was loading", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const session = new BrowserSimulationSession({
      getProject: () => createEmptyProject("project", "Project"),
      getProjectSessionId: () => "same",
      fetch,
    });
    const reading = session.handle({ operation: "capabilities" });
    await session.clear();
    expect(await reading).toMatchObject({
      ok: false,
      error: { code: "SESSION_CHANGED" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
