import { beforeEach, expect, it, vi } from "vitest";
import { BrowserAgentSimulationHost } from "./browser-agent-simulation-host";

const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("../features/simulation/browser-simulation-session", () => ({
  BrowserSimulationSession: class {
    handle = handle;
  },
}));

beforeEach(() => handle.mockReset());

it("waits for a newly accepted run inside one Agent request", async () => {
  handle
    .mockResolvedValueOnce({
      ok: true,
      run: { id: "run-1", state: "running" },
    })
    .mockResolvedValueOnce({
      ok: true,
      run: { id: "run-1", state: "finished" },
    });
  const host = new BrowserAgentSimulationHost({} as never);
  const response = await host.handle({
    apiVersion: "3.0",
    requestId: "submit-1",
    operation: "run",
    source: {
      kind: "project-folder",
      folderId: "folder",
      expectedStructureRevision: 0,
    },
    waitMs: 20_000,
  });
  expect(handle).toHaveBeenCalledTimes(2);
  expect(handle.mock.calls[0]).toMatchObject([
    { operation: "run" },
    "submit-1",
    { waitMs: 20_000 },
  ]);
  expect(handle.mock.calls[0]![0]).not.toHaveProperty("waitMs");
  expect(handle.mock.calls[1]).toMatchObject([
    { operation: "read", runId: "run-1" },
    expect.any(String),
    { waitMs: 20_000 },
  ]);
  expect(response).toMatchObject({
    ok: true,
    operation: "run",
    requestId: "submit-1",
    run: { state: "finished" },
  });
});
