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
  it("retains an accepted run when the internal wait loses transport", async () => {
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
        "simulation",
        {
          requestId: "start-once",
          waitMs: 1000,
          request: {
            operation: "start",
            preparedId: "prepared",
            digest: "a".repeat(64),
          },
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
        "start",
        "read",
      ]);
      expect(send.mock.calls[1]![0].requestId).not.toBe("start-once");
    } finally {
      vi.useRealTimers();
    }
  });
  it("polls one run with fresh request identities and stops at completion", async () => {
    vi.useFakeTimers();
    try {
      const read = vi
        .fn()
        .mockResolvedValueOnce(reply("running"))
        .mockResolvedValueOnce(reply("finished"));
      const client = {
        simulationResource: read,
      } as unknown as AgentSessionClient;
      const pending = waitForSimulation(client, reply("running"), 5000);
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({ run: { state: "finished" } });
      expect(read).toHaveBeenCalledTimes(2);
      for (const [request] of read.mock.calls)
        expect(request).toMatchObject({ operation: "read", runId: "run-1" });
      expect(new Set(read.mock.calls.map(([r]) => r.requestId)).size).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("returns the last running receipt at the budget and never reexecutes lost runs", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn().mockResolvedValue(reply("running"));
      const client = {
        simulationResource: read,
      } as unknown as AgentSessionClient;
      const pending = waitForSimulation(client, reply("running"), 1000);
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({
        run: { id: "run-1", state: "running" },
      });
      expect(read).toHaveBeenCalledTimes(2);
      read.mockClear();
      expect(
        await waitForSimulation(client, reply("lost"), 1000),
      ).toMatchObject({ run: { state: "lost" } });
      expect(read).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
