import { describe, expect, it, vi } from "vitest";
import {
  AgentSessionMachine,
  AgentSessionStatusResponseSchema,
} from "@icm/agent-adapter";
import { AgentSessionDO } from "./agent-session-do";
import {
  SESSION_STATE_KEY,
  routeAgentSessionRequest,
} from "./agent-session-runtime";

describe("Session observation", () => {
  it("routes status through the existing session service", async () => {
    const fetch = vi.fn(
      async (_request: string | Request) => new Response("{}"),
    );
    await routeAgentSessionRequest(
      new Request("https://example.test/api/agent/sessions/session/status"),
      {
        AGENT_SESSION: { getByName: () => ({ fetch }) },
      },
    );
    const request = fetch.mock.calls[0]?.[0] as unknown as Request;
    expect(request.url).toBe("https://agent-session.internal/status");
  });

  it("authenticates paused observations, never forwards or renews, and rejects expired authority", async () => {
    const now = Date.now();
    let counter = 0;
    const { machine, session } = AgentSessionMachine.create({
      projectSessionId: "work",
      projectId: "project",
      documentIds: ["doc"],
      scopes: ["circuit.snapshot"],
      now,
      random: () => `secret-${counter++}`,
    });
    const claimed = machine.redeemClaim(session.claimCode, now);
    if (!claimed.ok) throw new Error("fixture claim failed");
    machine.pause();
    const saved = machine.serialize();
    const put = vi.fn(async () => undefined);
    const socket = { readyState: 1, send: vi.fn() } as unknown as WebSocket;
    let sockets = [socket];
    const object = new AgentSessionDO(
      {
        storage: {
          get: async <T>(key: string) =>
            key === SESSION_STATE_KEY ? (saved as T) : undefined,
          put,
        },
        getWebSockets: () => sockets,
      },
      {},
    );
    const request = (token: string) =>
      new Request("https://internal/status", {
        headers: { authorization: `Bearer ${token}` },
      });
    // Let Durable Object initialization restore and persist its existing state.
    expect((await object.fetch(request("wrong"))).status).toBe(401);
    put.mockClear();
    vi.mocked(socket.send).mockClear();
    const response = await object.fetch(request(claimed.claim.agentToken));
    expect(response.status).toBe(200);
    const result = AgentSessionStatusResponseSchema.parse(
      await response.json(),
    );
    expect(result).toMatchObject({
      authorization: "paused",
      editor: "attached",
      expiresAt: machine.expiresAt,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      vi
        .mocked(socket.send)
        .mock.calls.every(
          ([message]) => JSON.parse(String(message)).kind === "event",
        ),
    ).toBe(true);
    expect(put).not.toHaveBeenCalled();
    const editorRequest = () =>
      new Request("https://internal/status", {
        headers: { "x-editor-secret": session.editorSecret },
      });
    expect(await (await object.fetch(editorRequest())).json()).toMatchObject({
      authorization: "paused",
      expiresAt: machine.expiresAt,
    });
    expect(put).not.toHaveBeenCalled();
    expect((await object.fetch(request("wrong"))).status).toBe(401);
    sockets = [];
    expect(
      await (await object.fetch(request(claimed.claim.agentToken))).json(),
    ).toMatchObject({ editor: "detached", authorization: "paused" });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(machine.expiresAt);
      expect(await (await object.fetch(editorRequest())).json()).toMatchObject({
        ok: false,
        error: { code: "SESSION_EXPIRED" },
      });
      expect(
        await (await object.fetch(request(claimed.claim.agentToken))).json(),
      ).toMatchObject({ ok: false, error: { code: "SESSION_EXPIRED" } });
    } finally {
      vi.useRealTimers();
    }
  });
});
