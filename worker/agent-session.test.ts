import { describe, expect, it, vi } from "vitest";
import mcpDistribution from "../config/agent-mcp-distribution.json";
import { SESSION_STATE_KEY } from "./agent-session-runtime";

import {
  AGENT_SSE_KEEPALIVE_INTERVAL_MS,
  AGENT_MCP_BOOTSTRAP_FORMAT,
  AgentSessionMachine,
  type AgentMcpBootstrapManifest,
  type AgentSessionLimits,
} from "@icm/agent-adapter";
import {
  AGENT_OPERATING_KIT_FORMAT,
  AGENT_OPERATING_KIT_VERSION,
  type AgentOperatingKit,
} from "@icm/agent-adapter/kit";

import {
  AgentSessionDO,
  forwardCircuitRequest,
  redeemClaimResponse,
  relayHeaders,
  revokeSession,
  routeAgentSessionRequest,
  type AgentSessionNamespaceLike,
} from "./agent-session";

const limits: Partial<AgentSessionLimits> = {
  claimTtlMs: 60_000,
  tokenTtlMs: 60_000,
  sessionTtlMs: 120_000,
  maxRequestBytes: 128,
  rateLimit: { windowMs: 60_000, maxRequests: 10 },
};

function setup() {
  let counter = 0;
  const random = () => `rand-${counter++}`;
  let time = 1_000_000;
  const created = AgentSessionMachine.create({
    limits,
    projectSessionId: "project-session-1",
    projectId: "project-1",
    documentIds: ["document-1"],
    scopes: ["circuit.snapshot", "circuit.edit.geometry"],
    now: time,
    random,
  });
  return {
    machine: created.machine,
    session: created.session,
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

function tokenFor(
  machine: AgentSessionMachine,
  code: string,
  now: number,
): string {
  const redeemed = machine.redeemClaim(code, now);
  if (!redeemed.ok) throw new Error("claim failed in fixture");
  return redeemed.claim.agentToken;
}

// WP-WA4: the relay orchestration (authorize → size → idempotency → forward →
// cache) is tested with an injected forward callback; the real Cloudflare
// WebSocket browser channel is the deployment-verified transport.

describe("agent-session relay", () => {
  it("redeems a valid claim again by replacing the prior bearer", () => {
    const { machine, session, now } = setup();
    const first = redeemClaimResponse(machine, session.claimCode, now());
    expect(first).toMatchObject({
      ok: true,
      sessionId: machine.sessionId,
      projectId: "project-1",
      documentIds: ["document-1"],
    });

    const retry = redeemClaimResponse(machine, session.claimCode, now());
    expect(retry).toMatchObject({ ok: true, projectId: "project-1" });
    if (!first.ok || !retry.ok) return;
    expect(retry.agentToken).not.toBe(first.agentToken);
    expect(machine.authorize(first.agentToken, now()).ok).toBe(false);
    expect(machine.authorize(retry.agentToken, now()).ok).toBe(true);
  });

  it("forwards an authorized request and caches its result", async () => {
    const { machine, session, now } = setup();
    const token = tokenFor(machine, session.claimCode, now());
    const forward = vi.fn(async () => ({ revision: 9 }));

    const result = await forwardCircuitRequest(
      machine,
      token,
      "request-1",
      10,
      { example: true },
      now(),
      forward,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result).toEqual({ revision: 9 });
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("serves the cached result on retry and never calls forward again", async () => {
    const { machine, session, now } = setup();
    const token = tokenFor(machine, session.claimCode, now());
    const forward = vi.fn(async () => ({ revision: 9 }));

    await forwardCircuitRequest(
      machine,
      token,
      "request-1",
      10,
      {},
      now(),
      forward,
    );
    const replay = await forwardCircuitRequest(
      machine,
      token,
      "request-1",
      10,
      {},
      now(),
      forward,
    );

    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.result).toEqual({ revision: 9 });
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("does not forward a concurrent duplicate request", async () => {
    const { machine, session, now } = setup();
    const token = tokenFor(machine, session.claimCode, now());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const forward = vi.fn(async () => {
      await gate;
      return { revision: 9 };
    });
    const first = forwardCircuitRequest(
      machine,
      token,
      "request-1",
      10,
      {},
      now(),
      forward,
      "payload-a",
    );
    await Promise.resolve();
    const duplicate = await forwardCircuitRequest(
      machine,
      token,
      "request-1",
      10,
      {},
      now(),
      forward,
      "payload-a",
    );
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: "REQUEST_IN_PROGRESS" },
    });
    expect(forward).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it("rejects an oversized payload before forwarding", async () => {
    const { machine, session, now } = setup();
    const token = tokenFor(machine, session.claimCode, now());
    const forward = vi.fn(async () => "should-not-run");

    const result = await forwardCircuitRequest(
      machine,
      token,
      "request-big",
      129, // maxRequestBytes is 128
      {},
      now(),
      forward,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REQUEST_TOO_LARGE");
    expect(forward).not.toHaveBeenCalled();
  });

  it("rejects a bad token before forwarding", async () => {
    const { machine, now } = setup();
    const forward = vi.fn(async () => "should-not-run");

    const result = await forwardCircuitRequest(
      machine,
      "not-a-token",
      "request-1",
      10,
      {},
      now(),
      forward,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TOKEN_INVALID");
    expect(forward).not.toHaveBeenCalled();
  });

  it("revokes the session so subsequent forwarding fails", async () => {
    const { machine, session, now } = setup();
    const token = tokenFor(machine, session.claimCode, now());
    const forward = vi.fn(async () => ({}));

    expect(revokeSession(machine).ok).toBe(true);

    const result = await forwardCircuitRequest(
      machine,
      token,
      "request-1",
      10,
      {},
      now(),
      forward,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_REVOKED");
    expect(forward).not.toHaveBeenCalled();
  });

  it("emits no-store and allowlisted CORS headers", () => {
    const headers = relayHeaders("https://editor.example");
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("access-control-allow-origin")).toBe(
      "https://editor.example",
    );
    expect(headers.get("vary")).toBe("Origin");

    const denied = relayHeaders(null);
    expect(denied.get("access-control-allow-origin")).toBeNull();
    expect(denied.get("cache-control")).toBe("no-store");
  });
});

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
  async deleteAll(): Promise<void> {
    this.values.clear();
  }
  async setAlarm(scheduledTime: number): Promise<void> {
    this.alarm = scheduledTime;
  }
}

function routedFixture() {
  const objects = new Map<string, AgentSessionDO>();
  const storages = new Map<string, MemoryStorage>();
  const sockets = new Map<string, WebSocket[]>();
  const namespace: AgentSessionNamespaceLike = {
    getByName(name) {
      let object = objects.get(name);
      if (!object) {
        const storage = storages.get(name) ?? new MemoryStorage();
        storages.set(name, storage);
        object = new AgentSessionDO(
          { storage, getWebSockets: () => sockets.get(name) ?? [] },
          { AGENT_ALLOWED_ORIGIN: "https://editor.example" },
        );
        objects.set(name, object);
      }
      return {
        fetch: (input, init) => object!.fetch(new Request(input, init)),
      };
    },
  };
  return {
    env: {
      AGENT_SESSION: namespace,
      AGENT_ALLOWED_ORIGIN: "https://editor.example",
    },
    objects,
    storages,
    sockets,
  };
}

describe("public Agent session routes", () => {
  it("publishes the exact Agent API contract", async () => {
    const { env } = routedFixture();
    const response = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/openapi.json"),
      env,
    );
    expect(response?.status).toBe(200);
    const contract = await response!.json();
    expect(contract).toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/api/agent/claims": { post: { operationId: "agentClaimRedeem" } },
      },
    });
    expect(Object.keys(contract.paths).sort()).toEqual([
      "/api/agent/claims",
      "/api/agent/connectors/resume",
      "/api/agent/sessions/{sessionId}/circuit",
      "/api/agent/sessions/{sessionId}/files",
    ]);
  });

  it("publishes the small static Agent Kit without creating another API operation", async () => {
    const { env } = routedFixture();
    const response = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/kit"),
      env,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    const kit = (await response!.json()) as AgentOperatingKit;
    expect(kit).toMatchObject({
      format: AGENT_OPERATING_KIT_FORMAT,
      version: AGENT_OPERATING_KIT_VERSION,
    });
    expect(kit.files.map((file) => file.path)).toEqual([
      "README.md",
      "AGENTS.md",
      "skills/icm-circuit-session/SKILL.md",
      "references/session-contract.md",
      "references/authoring-contract.md",
      "references/razavi-authoring-catalog.json",
    ]);
  });

  it("publishes a compact versioned MCP bootstrap manifest", async () => {
    const { env } = routedFixture();
    const response = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/mcp-manifest.json"),
      env,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("public, max-age=300");
    const manifest = (await response!.json()) as AgentMcpBootstrapManifest;
    expect(manifest).toMatchObject({
      format: AGENT_MCP_BOOTSTRAP_FORMAT,
      name: "analog-canvas",
      version: mcpDistribution.version,
      transport: "stdio",
      requirements: { node: ">=24.0.0" },
      fallback: {
        kitUrl: "https://editor.example/api/agent/kit",
        openApiUrl: "https://editor.example/api/agent/openapi.json",
      },
    });
    expect(manifest.launch.args.join(" ")).toContain(
      mcpDistribution.release.asset,
    );
    expect(manifest.hosts.codex.command).toContain("codex mcp add");
    expect(manifest.hosts.cursor.config.mcpServers["analog-canvas"]).toEqual(
      manifest.launch,
    );
  });

  it("allows only one concurrent creation for a session object", async () => {
    const storage = new MemoryStorage();
    const object = new AgentSessionDO(
      { storage },
      { AGENT_ALLOWED_ORIGIN: "https://editor.example" },
    );
    const body = JSON.stringify({
      sessionId: "fixed-session",
      projectSessionId: "project:1",
      projectId: "project",
      documentIds: ["document-main"],
      scopes: ["circuit.snapshot"],
    });
    const [first, second] = await Promise.all([
      object.fetch(
        new Request("https://agent-session.internal/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      ),
      object.fetch(
        new Request("https://agent-session.internal/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
  });

  it("gates the File Resource independently from Circuit edit scopes", async () => {
    const { env } = routedFixture();
    const createdResponse = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectSessionId: "project:files",
          projectId: "project",
          documentIds: ["document-main"],
          scopes: ["project.download"],
        }),
      }),
      env,
    );
    const created = (await createdResponse!.json()) as {
      session: { sessionId: string; claimCode: string };
    };
    const claimResponse = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimCode: created.session.claimCode }),
      }),
      env,
    );
    const claim = (await claimResponse!.json()) as { agentToken: string };
    const response = await routeAgentSessionRequest(
      new Request(
        `https://editor.example/api/agent/sessions/${created.session.sessionId}/files`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${claim.agentToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiVersion: "2.0",
            requestId: "not-visual-download",
            operation: "download",
            artifact: "svg",
            documentId: "document-main",
          }),
        },
      ),
      env,
    );
    expect(response?.status).toBe(403);
    expect(await response!.json()).toMatchObject({
      error: { code: "TOKEN_SCOPE_INSUFFICIENT" },
    });
  });

  it("resumes a claimed session with its connector credential", async () => {
    const { env } = routedFixture();
    const createdResponse = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectSessionId: "project:connector",
          projectId: "project",
          documentIds: ["document-main"],
          scopes: ["circuit.snapshot"],
        }),
      }),
      env,
    );
    const created = (await createdResponse!.json()) as {
      session: { sessionId: string; claimCode: string };
    };
    const claimResponse = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimCode: created.session.claimCode }),
      }),
      env,
    );
    const claim = (await claimResponse!.json()) as {
      agentToken: string;
      connectorToken: string;
    };
    const resumeResponse = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/connectors/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: created.session.sessionId,
          connectorToken: claim.connectorToken,
        }),
      }),
      env,
    );
    expect(resumeResponse?.status).toBe(200);
    expect(await resumeResponse!.json()).toMatchObject({
      ok: true,
      sessionId: created.session.sessionId,
      connectorToken: claim.connectorToken,
    });
  });

  it("does not reopen a revoked browser session from a retained editor proof", async () => {
    const storage = new MemoryStorage();
    const object = new AgentSessionDO(
      { storage },
      { AGENT_ALLOWED_ORIGIN: "https://editor.example" },
    );
    const createdResponse = await object.fetch(
      new Request("https://agent-session.internal/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-terminal",
          projectSessionId: "project:1",
          projectId: "project",
          documentIds: ["document-main"],
          scopes: ["circuit.snapshot"],
        }),
      }),
    );
    const created = (await createdResponse.json()) as {
      session: { editorSecret: string };
    };
    const revoked = await object.fetch(
      new Request("https://agent-session.internal/control", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-editor-secret": created.session.editorSecret,
        },
        body: JSON.stringify({ action: "revoke" }),
      }),
    );
    expect(revoked.status).toBe(200);

    const reconnect = await object.fetch(
      new Request("https://agent-session.internal/editor", {
        headers: {
          upgrade: "websocket",
          "sec-websocket-protocol": `icm-agent-session, ${created.session.editorSecret}`,
        },
      }),
    );
    expect(reconnect.status).toBe(409);
    expect(await reconnect.json()).toMatchObject({
      error: { code: "SESSION_REVOKED" },
    });
  });

  it("does not mark the editor offline when a replacement socket is open", async () => {
    const storage = new MemoryStorage();
    const replacement = { readyState: WebSocket.OPEN } as WebSocket;
    const object = new AgentSessionDO(
      { storage, getWebSockets: () => [replacement] },
      { AGENT_ALLOWED_ORIGIN: "https://editor.example" },
    );
    const put = vi.spyOn(storage, "put");
    await object.webSocketClose({ readyState: WebSocket.CLOSED } as WebSocket);
    expect(put).not.toHaveBeenCalled();
  });

  it("acknowledges a session-bound browser heartbeat outside business dispatch", async () => {
    const storage = new MemoryStorage();
    const object = new AgentSessionDO(
      { storage },
      { AGENT_ALLOWED_ORIGIN: "https://editor.example" },
    );
    await object.fetch(
      new Request("https://agent-session.internal/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-heartbeat",
          projectSessionId: "project:1",
          projectId: "project",
          documentIds: ["document-main"],
          scopes: ["circuit.snapshot"],
        }),
      }),
    );
    const send = vi.fn();
    await object.webSocketMessage(
      { send } as unknown as WebSocket,
      JSON.stringify({
        protocolVersion: "1.0",
        sessionId: "session-heartbeat",
        kind: "heartbeat",
        nonce: "heartbeat-1",
        projectId: "project",
        documentIds: ["document-main", "new-cell"],
      }),
    );

    expect(await storage.get(SESSION_STATE_KEY)).toMatchObject({
      documentIds: ["document-main", "new-cell"],
    });
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse(send.mock.calls[0]![0] as string)).toEqual({
      protocolVersion: "1.0",
      sessionId: "session-heartbeat",
      kind: "heartbeat-ack",
      nonce: "heartbeat-1",
    });
  });

  it("keeps an idle Agent event stream alive with SSE comments", async () => {
    const storage = new MemoryStorage();
    const object = new AgentSessionDO(
      { storage },
      { AGENT_ALLOWED_ORIGIN: "https://editor.example" },
    );
    const createdResponse = await object.fetch(
      new Request("https://agent-session.internal/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-events",
          projectSessionId: "project:1",
          projectId: "project",
          documentIds: ["document-main"],
          scopes: ["circuit.snapshot"],
        }),
      }),
    );
    const created = (await createdResponse.json()) as {
      session: { claimCode: string };
    };
    const claimResponse = await object.fetch(
      new Request("https://agent-session.internal/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: created.session.claimCode }),
      }),
    );
    const claim = (await claimResponse.json()) as { agentToken: string };

    vi.useFakeTimers();
    try {
      const response = await object.fetch(
        new Request("https://agent-session.internal/events", {
          headers: { authorization: `Bearer ${claim.agentToken}` },
        }),
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      expect(decoder.decode((await reader.read()).value)).toBe(
        ": connected\n\n",
      );
      const keepalive = reader.read();
      await vi.advanceTimersByTimeAsync(AGENT_SSE_KEEPALIVE_INTERVAL_MS);
      expect(decoder.decode((await keepalive).value)).toBe(": keepalive\n\n");
      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a real Project-bound session and redeems a body claim", async () => {
    const { env, storages } = routedFixture();
    const createdResponse = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/sessions", {
        method: "POST",
        headers: {
          origin: "https://editor.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectSessionId: "project:1",
          projectId: "project",
          documentIds: ["document-main"],
          scopes: ["circuit.snapshot"],
        }),
      }),
      env,
    );
    expect(createdResponse?.status).toBe(200);
    const created = (await createdResponse!.json()) as {
      session: {
        sessionId: string;
        editorSecret: string;
        claimCode: string;
        expiresAt: number;
      };
    };
    expect(
      created.session.claimCode.startsWith(`${created.session.sessionId}.`),
    ).toBe(true);
    expect(storages.get(created.session.sessionId)?.alarm).toBe(
      created.session.expiresAt - 60_000,
    );

    const claimResponse = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimCode: created.session.claimCode }),
      }),
      env,
    );
    expect(claimResponse?.status).toBe(200);
    const claim = (await claimResponse!.json()) as {
      sessionId: string;
      agentToken: string;
    };
    expect(claim.sessionId).toBe(created.session.sessionId);
    expect(claim.agentToken).toBeTruthy();

    const offline = await routeAgentSessionRequest(
      new Request(
        `https://editor.example/api/agent/sessions/${claim.sessionId}/circuit`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${claim.agentToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiVersion: "2.0",
            requestId: "snapshot-1",
            operation: "snapshot",
            documentId: "document-main",
          }),
        },
      ),
      env,
    );
    expect(offline?.status).toBe(503);
    expect(await offline!.json()).toMatchObject({
      error: { code: "EDITOR_OFFLINE" },
    });

    const disconnected = await routeAgentSessionRequest(
      new Request(
        `https://editor.example/api/agent/sessions/${claim.sessionId}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${claim.agentToken}` },
        },
      ),
      env,
    );
    expect(disconnected?.status).toBe(204);
    expect(storages.get(claim.sessionId)?.values.size).toBe(0);
  });

  it("rejects foreign origins before allocating a session", async () => {
    const { env } = routedFixture();
    const response = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/sessions", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      env,
    );
    expect(response?.status).toBe(403);
  });

  it("rejects an oversized claim before allocating or parsing it", async () => {
    const { env } = routedFixture();
    const response = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimCode: "x".repeat(9_000) }),
      }),
      env,
    );
    expect(response?.status).toBe(413);
    expect(await response!.json()).toMatchObject({
      error: { code: "REQUEST_TOO_LARGE" },
    });
  });

  it("forwards through the browser socket and enforces granted scopes", async () => {
    const { env, objects, storages, sockets } = routedFixture();
    const createdResponse = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectSessionId: "project:1",
          projectId: "project",
          documentIds: ["document-main"],
          scopes: ["circuit.snapshot", "circuit.edit.geometry"],
        }),
      }),
      env,
    );
    const created = (await createdResponse!.json()) as {
      session: { sessionId: string; claimCode: string };
    };
    const claimResponse = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimCode: created.session.claimCode }),
      }),
      env,
    );
    const claim = (await claimResponse!.json()) as { agentToken: string };
    const object = objects.get(created.session.sessionId)!;
    let sent = 0;
    const socket = {
      readyState: WebSocket.OPEN,
      send: (text: string) => {
        sent += 1;
        const request = JSON.parse(text) as { requestId: string };
        queueMicrotask(() => {
          void object.webSocketMessage(
            socket as WebSocket,
            JSON.stringify({
              protocolVersion: "1.0",
              sessionId: created.session.sessionId,
              messageId: "response-message",
              requestId: request.requestId,
              sentAt: new Date().toISOString(),
              kind: "circuit-response",
              payload: {
                apiVersion: "2.0",
                requestId: request.requestId,
                operation: "snapshot",
                ok: false,
                revision: 3,
                error: { code: "TEST_RESPONSE", message: "fixture" },
                diagnostics: [],
              },
            }),
          );
        });
      },
    } as unknown as WebSocket;
    sockets.set(created.session.sessionId, [socket]);

    const invalid = await routeAgentSessionRequest(
      new Request(
        `https://editor.example/api/agent/sessions/${created.session.sessionId}/circuit`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${claim.agentToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiVersion: "2.0",
            requestId: "invalid-edit-1",
            operation: "transact",
            documentId: "document-main",
            transactionId: "invalid-edit-1",
            expectedRevision: 0,
            edits: [
              {
                kind: "add_instance",
                instance: {
                  id: "VIN",
                  symbolId: "port",
                  symbolVariantId: "",
                  placement: null,
                },
              },
            ],
          }),
        },
      ),
      env,
    );
    expect(invalid?.status).toBe(400);
    expect(await invalid!.json()).toMatchObject({
      operation: "error",
      ok: false,
      error: { code: "INVALID_REQUEST" },
      diagnostics: [
        {
          code: "SCHEMA_VIOLATION",
          path: ["edits", 0, "instance", "symbolVariantId"],
        },
      ],
    });
    expect(sent).toBe(0);

    const snapshot = await routeAgentSessionRequest(
      new Request(
        `https://editor.example/api/agent/sessions/${created.session.sessionId}/circuit`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${claim.agentToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiVersion: "2.0",
            requestId: "snapshot-1",
            operation: "snapshot",
            documentId: "document-main",
          }),
        },
      ),
      env,
    );
    expect(snapshot?.status).toBe(200);
    expect(await snapshot!.json()).toMatchObject({ ok: false, revision: 3 });
    expect(sent).toBe(1);
    expect(
      JSON.stringify([
        ...(storages.get(created.session.sessionId)?.values.values() ?? []),
      ]),
    ).not.toContain("revision");

    const geometryEdit = await routeAgentSessionRequest(
      new Request(
        `https://editor.example/api/agent/sessions/${created.session.sessionId}/circuit`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${claim.agentToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiVersion: "2.0",
            requestId: "edit-1",
            operation: "transact",
            documentId: "document-main",
            transactionId: "tx-1",
            expectedRevision: 3,
            edits: [{ kind: "noop" }],
          }),
        },
      ),
      env,
    );
    expect(geometryEdit?.status).toBe(200);
    expect(sent).toBe(2);

    const forbidden = await routeAgentSessionRequest(
      new Request(
        `https://editor.example/api/agent/sessions/${created.session.sessionId}/circuit`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${claim.agentToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiVersion: "2.0",
            requestId: "presentation-edit-1",
            operation: "transact",
            documentId: "document-main",
            transactionId: "tx-2",
            expectedRevision: 3,
            edits: [
              {
                kind: "patch_instance_netlist_parameters",
                instanceId: "M1",
                set: { name: "changed" },
              },
            ],
          }),
        },
      ),
      env,
    );
    expect(forbidden?.status).toBe(403);
    expect(sent).toBe(2);

    const semanticForbidden = await routeAgentSessionRequest(
      new Request(
        `https://editor.example/api/agent/sessions/${created.session.sessionId}/circuit`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${claim.agentToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiVersion: "2.0",
            requestId: "semantic-without-scope",
            operation: "transact",
            documentId: "document-main",
            transactionId: "semantic-without-scope-tx",
            expectedRevision: 3,
            semanticIntent: { kind: "fit-document" },
          }),
        },
      ),
      env,
    );
    expect(semanticForbidden?.status).toBe(403);
    expect(sent).toBe(2);
  });
});
