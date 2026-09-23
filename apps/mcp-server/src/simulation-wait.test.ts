import { describe, expect, it, vi } from "vitest";
import { AgentSessionClient, AgentSessionError } from "@icm/agent-client";
import { FakeAgentHttp } from "../../../packages/agent-client/src/test-support/fake-relay.js";
import { callTool } from "./tools.js";
import type { AgentSimulationResourceResponse } from "@icm/agent-adapter";
import { waitForSimulation } from "./simulation-wait.js";

function reply(
  state: "running" | "finished" | "lost",
): AgentSimulationResourceResponse {
  return {
    apiVersion: "3.0",
    requestId: "start",
    operation: "start",
    ok: true,
    run: {
      id: "run-1",
      preparedId: "prepared",
      inputRevision: "revision",
      state,
      artifacts: [],
    },
  };
}
describe("bounded simulation waiting", () => {
  it("returns a fast completed run with one Agent relay request", async () => {
    const session = {
      client: new AgentSessionClient({ http: new FakeAgentHttp() }),
    };
    const send = vi
      .spyOn(session.client, "simulationResource")
      .mockResolvedValueOnce(reply("finished"));
    const result = await callTool(
      "simulation_run",
      {
        requestId: "one-run",
        waitMs: 20_000,
        request: {
          operation: "run",
          source: {
            kind: "project-folder",
            folderId: "folder",
            expectedStructureRevision: 0,
          },
        },
      },
      session,
    );
    expect(JSON.parse(result.content[0]!.text!)).toMatchObject({
      ok: true,
      run: { state: "finished" },
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toMatchObject({
      operation: "run",
      waitMs: 20_000,
      requestId: "one-run",
    });
  });

  it.each(["run", "start"] as const)(
    "retains an accepted %s when the internal wait loses transport",
    async (operation) => {
      vi.useFakeTimers();
      try {
        const session = {
          client: new AgentSessionClient({ http: new FakeAgentHttp() }),
        };
        const send = vi
          .spyOn(session.client, "simulationResource")
          .mockResolvedValueOnce({
            apiVersion: "3.0",
            requestId: "start-once",
            operation: "start",
            ok: true,
            run: {
              id: "accepted",
              preparedId: "prepared",
              inputRevision: "revision",
              state: "running",
              artifacts: [],
            },
          })
          .mockRejectedValueOnce(
            new AgentSessionError(
              "HTTP_ERROR",
              "HTTP 502",
              "request-rejected",
              502,
            ),
          );
        const pending = callTool(
          "simulation_run",
          {
            requestId: "start-once",
            waitMs: 1000,
            request:
              operation === "run"
                ? {
                    operation,
                    source: {
                      kind: "project-folder",
                      folderId: "folder",
                      expectedStructureRevision: 0,
                    },
                  }
                : { operation, preparedId: "prepared", digest: "a".repeat(64) },
          },
          session,
        );
        await vi.runAllTimersAsync();
        expect(JSON.parse((await pending).content[0]!.text!)).toMatchObject({
          ok: false,
          runId: "accepted",
          nextRequest: { operation: "read", runId: "accepted" },
          error: { stage: "read", recovery: "read-run" },
        });
        expect(send.mock.calls.map(([r]) => r.operation)).toEqual([
          operation,
          "read",
        ]);
        expect(send.mock.calls[1]![0].requestId).not.toBe("start-once");
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("waits for one run in a single bounded Agent read", async () => {
    const read = vi.fn().mockResolvedValueOnce(reply("finished"));
    const client = {
      simulationResource: read,
    } as unknown as AgentSessionClient;
    expect(
      await waitForSimulation(client, reply("running"), 5000),
    ).toMatchObject({ run: { state: "finished" } });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0]).toMatchObject({
      operation: "read",
      runId: "run-1",
      waitMs: 5000,
    });
  });
  it("returns the bounded read receipt and never reexecutes lost runs", async () => {
    const read = vi.fn().mockResolvedValue(reply("running"));
    const client = {
      simulationResource: read,
    } as unknown as AgentSessionClient;
    expect(
      await waitForSimulation(client, reply("running"), 1000),
    ).toMatchObject({ run: { id: "run-1", state: "running" } });
    expect(read).toHaveBeenCalledOnce();
    read.mockClear();
    expect(await waitForSimulation(client, reply("lost"), 1000)).toMatchObject({
      run: { state: "lost" },
    });
    expect(read).not.toHaveBeenCalled();
  });
  it("falls back to legacy polling for an older browser contract", async () => {
    vi.useFakeTimers();
    try {
      const read = vi
        .fn()
        .mockResolvedValueOnce({
          apiVersion: "3.0",
          requestId: "unsupported",
          operation: "read",
          ok: false,
          error: {
            code: "SIMULATION_REQUEST_INVALID",
            message: "old browser",
            stage: "input",
            recovery: "fix-input",
          },
        })
        .mockResolvedValueOnce(reply("finished"));
      const client = {
        simulationResource: read,
      } as unknown as AgentSessionClient;
      const pending = waitForSimulation(client, reply("running"), 5000);
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({ run: { state: "finished" } });
      expect(read).toHaveBeenCalledTimes(2);
      expect(read.mock.calls[0]![0]).toMatchObject({ waitMs: 5000 });
      expect(read.mock.calls[1]![0]).not.toHaveProperty("waitMs");
    } finally {
      vi.useRealTimers();
    }
  });
});
