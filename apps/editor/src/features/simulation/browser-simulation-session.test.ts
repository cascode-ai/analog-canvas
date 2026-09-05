import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import { BrowserSimulationSession } from "./browser-simulation-session";

describe("browser simulation ownership", () => {
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
          kind: "project-setup",
          expectedStructureRevision: project.structureRevision,
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "SIMULATION_SETUP_MISSING" } });
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
