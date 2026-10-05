import { describe, expect, it } from "vitest";
import { AgentHttpClient } from "./http-client.js";

const BASE = "https://relay.test";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Bodies an editor answers with are tested against the real editor, in
// apps/editor/src/agent/agent-http-client-live.test.ts. These are the relay
// and network side.
describe("agent http client", () => {
  it("keeps streamed artifact authorization on this session and refuses redirects", async () => {
    let calls = 0;
    const http = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async (url, init) => {
        calls++;
        expect(String(url)).toBe(
          `${BASE}/api/agent/sessions/session/artifacts/file`,
        );
        expect(init?.redirect).toBe("error");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer private-token",
        );
        expect(new Headers(init?.headers).get("range")).toBe("bytes=5-");
        return new Response("bytes");
      },
    });
    const response = await http.downloadArtifact(
      "session",
      "private-token",
      "/api/agent/sessions/session/artifacts/file",
      5,
    );
    expect(await response.text()).toBe("bytes");
    for (const path of [
      "https://elsewhere.test/file",
      "/api/agent/sessions/other/artifacts/file",
      "/api/agent/sessions/session/artifacts/../status",
    ]) {
      await expect(
        http.downloadArtifact("session", "private-token", path),
      ).rejects.toThrow();
    }
    expect(calls).toBe(1);
  });
  it("reads the canonical Session status using bearer authentication and a short deadline", async () => {
    const observation = {
      ok: true,
      sessionId: "s",
      projectId: "p",
      documentIds: ["d"],
      authorization: "paused",
      editor: "detached",
      observedAt: 100,
      expiresAt: 200,
    };
    let invalid = false;
    const client = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async (url, init) => {
        expect(String(url)).toBe(`${BASE}/api/agent/sessions/s/status`);
        expect(init?.method).toBe("GET");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer private",
        );
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return jsonResponse(
          200,
          invalid ? { ...observation, agentToken: "leak" } : observation,
        );
      },
    });
    expect(await client.status("s", "private")).toEqual(observation);
    invalid = true;
    await expect(client.status("s", "private")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("reads captured Specs without legacy waveform projections and still rejects unknown fields", async () => {
    const outputData = {
      schemaVersion: 1,
      analyses: [],
      diagnostics: [],
      specs: {
        schemaVersion: 1,
        runId: "run",
        preparedId: "prepared",
        inputDigest: "a".repeat(64),
        results: [],
      },
    };
    const body = {
      apiVersion: "3.0",
      requestId: "spec-read",
      operation: "read",
      ok: true,
      run: {
        id: "run",
        preparedId: "prepared",
        inputRevision: "input",
        state: "finished",
        artifacts: [],
        outputData,
      },
    };
    const http = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async () => jsonResponse(200, body),
    });
    const request = {
      apiVersion: "3.0" as const,
      requestId: "spec-read",
      operation: "read" as const,
      runId: "run",
    };
    expect(await http.simulation("session", "token", request)).toEqual(body);
    Object.assign(outputData.specs, { unknown: true });
    await expect(http.simulation("session", "token", request)).rejects.toThrow(
      "schema validation",
    );
    const rejected = await http
      .simulation("session", "token", request)
      .catch((error: unknown) => error);
    expect(rejected).toMatchObject({
      code: "INVALID_RESPONSE",
      category: "request-rejected",
    });
    expect(String(rejected)).toContain(
      "run.outputData.specs (unrecognized_keys)",
    );
    expect(String(rejected)).toContain("MCP manifest");
    expect(String(rejected)).not.toContain("unknown");
    delete (outputData.specs as Record<string, unknown>).unknown;
    expect(await http.simulation("session", "token", request)).toEqual(body);
  });
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
        apiVersion: "3.0",
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
  it("rejects schema-invalid success payloads", async () => {
    const http = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async () => jsonResponse(200, { ok: true, unexpected: true }),
    });
    await expect(
      http.circuit("s", "t", {
        apiVersion: "3.0",
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
        apiVersion: "3.0",
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
        apiVersion: "3.0",
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
        apiVersion: "3.0",
        requestId: "r",
        operation: "snapshot",
        documentId: "main",
      }),
    ).rejects.toMatchObject({ code: "NETWORK_FAILURE", category: "network" });
  });
});
