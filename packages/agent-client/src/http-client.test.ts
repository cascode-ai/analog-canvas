import { describe, expect, it } from "vitest";
import {
  capabilitiesResponse,
  snapshotResponse,
} from "./test-support/fake-relay.js";
import { AgentHttpClient } from "./http-client.js";
import { AgentSessionError } from "./errors.js";

const BASE = "https://relay.test";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("agent http client", () => {
  it("backs off on 429 with byte-identical mutation retries and a finite budget", async () => {
    const bodies: string[] = [];
    const waits: number[] = [];
    const http = new AgentHttpClient({
      baseUrl: BASE,
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetch: async (_url, init) => {
        bodies.push(String(init?.body));
        return new Response(
          JSON.stringify({
            error: { code: "RATE_LIMITED", message: "slow down" },
          }),
          { status: 429, headers: { "retry-after": "2" } },
        );
      },
    });
    await expect(
      http.circuit("s", "t", {
        apiVersion: "2.0",
        requestId: "same-id",
        transactionId: "same-tx",
        operation: "transact",
        documentId: "main",
        expectedRevision: 0,
        edits: [{ kind: "remove_instance", instanceId: "M1" }],
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(waits).toEqual([2000, 2000]);
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(1);
  });
  it("honors Retry-After beyond the local wait budget without retrying early", async () => {
    const http = new AgentHttpClient({
      baseUrl: BASE,
      sleep: async () => {
        throw new Error("must not wait");
      },
      fetch: async () =>
        new Response("{}", { status: 429, headers: { "retry-after": "120" } }),
    });
    await expect(http.claim("s.c")).rejects.toMatchObject({ httpStatus: 429 });
  });
  it("redeems a claim code and derives the session id from its prefix", async () => {
    const http = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async (input, init) => {
        expect(String(input)).toBe(`${BASE}/api/agent/claims`);
        const body = JSON.parse(String(init?.body)) as { claimCode: string };
        expect(body.claimCode).toBe("session-9.code-123");
        return jsonResponse(200, {
          ok: true,
          sessionId: "session-9",
          agentToken: "tok",
          tokenExpiresAt: 456,
          connectorToken: "connector",
          connectorExpiresAt: 789,
          scopes: ["circuit.snapshot"],
          projectId: "project-1",
          documentIds: ["main"],
        });
      },
    });
    const claim = await http.claim("session-9.code-123");
    expect(claim.sessionId).toBe("session-9");
    expect(claim.projectId).toBe("project-1");
  });

  it("normalizes a rejected claim into an unrecoverable credential error", async () => {
    const http = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async () =>
        jsonResponse(401, {
          ok: false,
          error: { code: "CLAIM_INVALID", message: "bad code" },
        }),
    });
    await expect(http.claim("x.y")).rejects.toMatchObject({
      code: "CLAIM_INVALID",
      category: "unrecoverable-credential",
      httpStatus: 401,
    });
  });

  it("exchanges a persistent connector for a fresh bearer", async () => {
    const http = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async (input, init) => {
        expect(String(input)).toBe(`${BASE}/api/agent/connectors/resume`);
        expect(JSON.parse(String(init?.body))).toEqual({
          sessionId: "session-9",
          connectorToken: "connector-old",
        });
        return jsonResponse(200, {
          ok: true,
          sessionId: "session-9",
          agentToken: "fresh-bearer",
          tokenExpiresAt: 900,
          connectorToken: "connector-old",
          connectorExpiresAt: 9_000,
          scopes: ["circuit.snapshot"],
          projectId: "project-1",
          documentIds: ["main"],
        });
      },
    });
    await expect(
      http.resumeConnector("session-9", "connector-old"),
    ).resolves.toMatchObject({ agentToken: "fresh-bearer" });
  });

  it("posts four-operation requests with the bearer token and parses responses", async () => {
    const http = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async (input, init) => {
        expect(String(input)).toBe(
          `${BASE}/api/agent/sessions/session-1/circuit`,
        );
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer tok",
        );
        return jsonResponse(200, capabilitiesResponse("req-1"));
      },
    });
    const response = await http.circuit("session-1", "tok", {
      apiVersion: "2.0",
      requestId: "req-1",
      operation: "capabilities",
    });
    expect(response.ok).toBe(true);
  });

  it("rejects schema-invalid success payloads", async () => {
    const http = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async () => jsonResponse(200, { ok: true, unexpected: true }),
    });
    await expect(
      http.circuit("s", "t", {
        apiVersion: "2.0",
        requestId: "req-1",
        operation: "capabilities",
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("maps editor-offline and bare status codes to typed failures", async () => {
    const offline = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async () =>
        jsonResponse(503, {
          ok: false,
          error: { code: "EDITOR_OFFLINE", message: "editor detached" },
        }),
    });
    await expect(
      offline.circuit("s", "t", {
        apiVersion: "2.0",
        requestId: "r",
        operation: "snapshot",
        documentId: "main",
      }),
    ).rejects.toMatchObject({
      code: "EDITOR_OFFLINE",
      category: "editor-offline",
    });

    const bare = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async () => jsonResponse(500, {}),
    });
    await expect(
      bare.circuit("s", "t", {
        apiVersion: "2.0",
        requestId: "r",
        operation: "snapshot",
        documentId: "main",
      }),
    ).rejects.toMatchObject({ code: "HTTP_ERROR", httpStatus: 500 });
  });

  it("normalizes network failures", async () => {
    const http = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(
      http.circuit("s", "t", {
        apiVersion: "2.0",
        requestId: "r",
        operation: "snapshot",
        documentId: "main",
      }),
    ).rejects.toMatchObject({ code: "NETWORK_FAILURE", category: "network" });
  });

  it("returns a snapshot response untouched", async () => {
    const http = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async () => jsonResponse(200, snapshotResponse("req-2")),
    });
    const response = await http.circuit("s", "t", {
      apiVersion: "2.0",
      requestId: "req-2",
      operation: "snapshot",
      documentId: "main",
    });
    expect(response.ok && response.operation === "snapshot").toBe(true);
  });
});
