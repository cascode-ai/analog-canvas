import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionError } from "./errors.js";
import {
  capabilitiesResponse,
  errorResponse,
  FakeAgentHttp,
  snapshotResponse,
  transactSuccessResponse,
} from "./test-support/fake-relay.js";
import { testSnapshot } from "./test-support/snapshot-fixture.js";
import { AgentSessionClient } from "./session-client.js";
import { ConnectorStore } from "./connector-store.js";

async function freshClient(
  options: { http?: FakeAgentHttp; now?: () => number } = {},
): Promise<{
  client: AgentSessionClient;
  http: FakeAgentHttp;
}> {
  const http = options.http ?? new FakeAgentHttp();
  const client = new AgentSessionClient({
    http,
    ...(options.now ? { now: options.now } : {}),
  });
  return { client, http };
}

describe("agent session client", () => {
  it("claims a code, caches capabilities, snapshots once, and reports online", async () => {
    const { client, http } = await freshClient();
    const report = await client.connect("session-1.claim-code");
    expect(http.claims).toEqual(["session-1.claim-code"]);
    expect(report.mode).toBe("claimed");
    expect(report.projectId).toBe("project-1");
    expect(report.context?.revision).toBe(5);
    expect(client.connection.snapshot.state).toBe("online");
    expect(http.circuitCalls.map((call) => call.request.operation)).toEqual([
      "capabilities",
      "snapshot",
    ]);
    // A second capabilities call reuses the cache without another request.
    const calls = http.circuitCalls.length;
    await client.capabilities();
    expect(http.circuitCalls.length).toBe(calls);
  });

  it("never exposes the token through status or connect reports", async () => {
    const { client } = await freshClient();
    const report = await client.connect("session-1.claim-code");
    const status = JSON.stringify({ report, status: await client.status() });
    expect(status).not.toContain("token-0123456789abcdef");
    expect(status).not.toContain("agentToken");
  });

  it("re-checks the active session without a new claim", async () => {
    const { client, http } = await freshClient();
    await client.connect("session-1.claim-code");
    const report = await client.connect();
    expect(report.mode).toBe("resumed");
    expect(http.claims).toEqual(["session-1.claim-code"]);
    expect(http.circuitCalls.at(-1)?.request.operation).toBe("capabilities");
  });

  it("resumes a browser-approved connector in a new Helper process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analog-session-client-"));
    try {
      const store = new ConnectorStore(join(directory, "connector.json"));
      const http = new FakeAgentHttp();
      const first = new AgentSessionClient({ http, connectorStore: store });
      await first.connect("session-1.claim-code");

      const restarted = new AgentSessionClient({ http, connectorStore: store });
      const report = await restarted.connect();
      expect(report.mode).toBe("resumed");
      expect(http.resumes).toEqual([
        {
          sessionId: "session-1",
          connectorToken: "connector-0123456789abcdef0123456789abcdef",
        },
      ]);
      expect(JSON.stringify(await restarted.status())).not.toContain(
        "connectorToken",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refreshes an expired bearer from the connector and retries the request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analog-session-refresh-"));
    let nowMs = 1_000;
    try {
      const store = new ConnectorStore(join(directory, "connector.json"));
      const claim = {
        sessionId: "session-1",
        agentToken: "initial-token",
        tokenExpiresAt: 50_000,
        connectorToken: "connector-token",
        connectorExpiresAt: 500_000,
        scopes: ["circuit.snapshot"],
        projectId: "project-1",
        documentIds: ["main"],
      };
      const http = new FakeAgentHttp({
        claim: () => claim,
        resume: () => ({
          ...claim,
          agentToken: "refreshed-token",
          tokenExpiresAt: 400_000,
        }),
      });
      const client = new AgentSessionClient({
        http,
        connectorStore: store,
        now: () => nowMs,
      });
      await client.connect("session-1.code");
      nowMs = 100_000;
      await client.refreshSnapshot();
      expect(http.resumes).toHaveLength(1);
      expect(http.circuitCalls.at(-1)?.token).toBe("refreshed-token");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires a claim code when nothing valid is stored", async () => {
    const { client } = await freshClient();
    await expect(client.connect()).rejects.toMatchObject({
      code: "CLAIM_REQUIRED",
    });
  });

  it("fails with TOKEN_EXPIRED when the clock passes tokenExpiresAt", async () => {
    let nowMs = 1_000;
    const { client } = await freshClient({
      http: new FakeAgentHttp({
        claim: () => ({
          sessionId: "session-1",
          agentToken: "token-0123456789abcdef0123456789abcdef",
          tokenExpiresAt: 1_000_000,
          connectorToken: "connector-expiring-token",
          connectorExpiresAt: 3_000_000,
          scopes: [],
          projectId: "project-1",
          documentIds: ["main"],
        }),
      }),
      now: () => nowMs,
    });
    await client.connect("session-1.code");
    nowMs = 2_000_000;
    await expect(client.status()).resolves.toMatchObject({ tokenValid: false });
    await expect(client.refreshSnapshot()).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
    expect(client.connection.snapshot.state).toBe("revoked");
  });

  it("clears the active credential when the server revokes the session", async () => {
    let revoked = false;
    const { client } = await freshClient({
      http: new FakeAgentHttp({
        circuit: async ({ request }) => {
          if (request.operation === "capabilities" && revoked) {
            throw new AgentSessionError(
              "SESSION_REVOKED",
              "revoked",
              "unrecoverable-credential",
              401,
            );
          }
          if (request.operation === "capabilities") {
            return capabilitiesResponse(request.requestId);
          }
          return snapshotResponse(request.requestId);
        },
      }),
    });
    await client.connect("session-1.code");
    revoked = true;
    await expect(client.capabilities({ force: true })).rejects.toMatchObject({
      code: "SESSION_REVOKED",
    });
    expect(client.connection.snapshot.state).toBe("revoked");
    await expect(client.connect()).rejects.toMatchObject({
      code: "CLAIM_REQUIRED",
    });
  });

  it("applies actions through dry-run, commit, and verify refresh", async () => {
    const transactCalls: {
      dryRun: boolean | undefined;
      expectedRevision: number;
    }[] = [];
    const http = new FakeAgentHttp();
    const { client } = await freshClient({ http });
    await client.connect("session-1.code");
    transactCalls.length = 0;
    http.circuitHandler = async ({ request }) => {
      switch (request.operation) {
        case "capabilities":
          return capabilitiesResponse(request.requestId);
        case "transact": {
          transactCalls.push({
            dryRun: request.dryRun,
            expectedRevision: request.expectedRevision,
          });
          return transactSuccessResponse(
            request.requestId,
            request.expectedRevision,
            ["instance-3"],
          );
        }
        case "snapshot": {
          const snapshotCalls = http.circuitCalls.filter(
            (call) => call.request.operation === "snapshot",
          ).length;
          if (snapshotCalls > 2) {
            const after = testSnapshot();
            after.document.revision = 6;
            after.document.instances.push({
              ...after.document.instances[1]!,
              id: "instance-3",
              reference: "R2",
            });
            return snapshotResponse(request.requestId, after, 6);
          }
          return snapshotResponse(request.requestId);
        }
        default:
          return errorResponse(
            request.requestId,
            "render",
            "UNSUPPORTED_EDIT",
            "x",
          );
      }
    };
    const report = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R2",
        position: { x: 700, y: 200 },
      },
      {
        kind: "move",
        target: { kind: "instance", reference: "M1" },
        position: { x: 320, y: 240 },
      },
    ]);
    expect(report.ok).toBe(true);
    expect(report.stage).toBe("done");
    expect(report.transactions).toBe(1);
    expect(report.revision).toBe(6);
    expect(transactCalls).toEqual([
      { dryRun: true, expectedRevision: 5 },
      { dryRun: false, expectedRevision: 5 },
    ]);
    // the simulated post-commit snapshot contains exactly the new instance
    expect(report.changedObjectIds).toEqual(["instance-3"]);
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(1);
  });

  it("surfaces STATE_CHANGED with affected objects instead of overwriting", async () => {
    let commitAttempted = false;
    const http = new FakeAgentHttp();
    const { client } = await freshClient({ http });
    await client.connect("session-1.code");
    http.circuitHandler = async ({ request }) => {
      switch (request.operation) {
        case "capabilities":
          return capabilitiesResponse(request.requestId);
        case "transact": {
          if (request.dryRun) {
            return transactSuccessResponse(
              request.requestId,
              request.expectedRevision,
            );
          }
          commitAttempted = true;
          return errorResponse(
            request.requestId,
            "transact",
            "STALE_REVISION",
            "document moved on",
          );
        }
        case "snapshot": {
          const snapshotCalls = http.circuitCalls.filter(
            (call) => call.request.operation === "snapshot",
          ).length;
          if (snapshotCalls > 2) {
            const after = testSnapshot();
            after.document.revision = 9;
            after.document.instances = after.document.instances.map(
              (instance) =>
                instance.id === "instance-2"
                  ? { ...instance, parameters: { moved: "true" } }
                  : instance,
            );
            return snapshotResponse(request.requestId, after, 9);
          }
          return snapshotResponse(request.requestId);
        }
        default:
          return errorResponse(
            request.requestId,
            "render",
            "UNSUPPORTED_EDIT",
            "x",
          );
      }
    };
    const report = await client.applyActions([
      {
        kind: "move",
        target: { kind: "instance", reference: "M1" },
        position: { x: 1, y: 1 },
      },
    ]);
    expect(commitAttempted).toBe(true);
    expect(report).toMatchObject({
      ok: false,
      stage: "commit",
      code: "STATE_CHANGED",
      revision: 9,
    });
    expect(report.changedObjectIds).toContain("instance-2");
    expect(client.summary("main")?.revision).toBe(9);
  });

  it("uses the explicitly selected document for refresh, dry-run, and commit", async () => {
    const child = testSnapshot();
    child.document.id = "child";
    child.document.name = "Child";
    child.project.documents.push({
      id: "child",
      name: "Child",
      instanceCount: child.document.instances.length,
      netCount: child.document.nets.length,
      references: [],
    });
    const http = new FakeAgentHttp({
      claim: () => ({
        sessionId: "session-1",
        agentToken: "token-0123456789abcdef0123456789abcdef",
        tokenExpiresAt: Number.MAX_SAFE_INTEGER,
        connectorToken: "connector-multi-document",
        connectorExpiresAt: Number.MAX_SAFE_INTEGER,
        scopes: ["circuit.snapshot", "circuit.edit.geometry"],
        projectId: "project-1",
        documentIds: ["main", "child"],
      }),
      circuit: async ({ request }) => {
        switch (request.operation) {
          case "capabilities":
            return capabilitiesResponse(request.requestId);
          case "snapshot":
            return snapshotResponse(
              request.requestId,
              request.documentId === "child" ? child : testSnapshot(),
            );
          case "transact":
            return transactSuccessResponse(
              request.requestId,
              request.expectedRevision,
            );
          default:
            return errorResponse(
              request.requestId,
              "render",
              "UNSUPPORTED",
              "x",
            );
        }
      },
    });
    const { client } = await freshClient({ http });
    await client.connect("session-1.code");
    const report = await client.applyActions(
      [
        {
          kind: "move",
          target: { kind: "instance", reference: "M1" },
          position: { x: 340, y: 240 },
        },
      ],
      { documentId: "child", verify: false },
    );
    expect(report.ok).toBe(true);
    const documentIds = http.circuitCalls.flatMap((call) =>
      call.request.operation === "snapshot" ||
      call.request.operation === "transact"
        ? [call.request.documentId]
        : [],
    );
    expect(documentIds.slice(-3)).toEqual(["child", "child", "child"]);
  });

  it("retries the exact same request payload once on a network failure", async () => {
    let failures = 0;
    const payloads: string[] = [];
    const http = new FakeAgentHttp({
      circuit: async ({ request, payload }) => {
        if (request.operation === "capabilities") {
          payloads.push(payload);
          failures += 1;
          if (failures === 1) {
            throw new AgentSessionError("NETWORK_FAILURE", "down", "network");
          }
          return capabilitiesResponse(request.requestId);
        }
        return snapshotResponse(request.requestId);
      },
    });
    const { client } = await freshClient({ http });
    const report = await client.connect("session-1.code");
    expect(report.mode).toBe("claimed");
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toBe(payloads[1]);
    expect(client.connection.snapshot.state).toBe("online");
  });

  it("keeps the pairing but marks the editor offline when the relay reports EDITOR_OFFLINE", async () => {
    const { client } = await freshClient({
      http: new FakeAgentHttp({
        circuit: async ({ request }) => {
          if (request.operation === "capabilities") {
            return capabilitiesResponse(request.requestId);
          }
          throw new AgentSessionError(
            "EDITOR_OFFLINE",
            "editor detached",
            "editor-offline",
            503,
          );
        },
      }),
    });
    const report = await client.connect("session-1.code");
    expect(report.mode).toBe("claimed");
    expect(report.context).toBeNull();
    expect(client.connection.snapshot.state).toBe("editor-offline");
    // The active pairing survives for a later connect() re-check.
    await expect(client.connect()).resolves.toMatchObject({ mode: "resumed" });
  });

  it("validates advanced edits against the contract before sending", async () => {
    const { client, http } = await freshClient();
    await client.connect("session-1.code");
    const calls = http.circuitCalls.length;
    const report = await client.advancedTransact([
      {
        kind: "move_instance",
        instanceId: "instance-1",
        position: { x: 1, y: 2 },
      },
      { kind: "not_a_real_edit" },
    ]);
    expect(report.ok).toBe(false);
    expect(report.code).toBe("EDIT_SCHEMA_INVALID");
    expect(http.circuitCalls.length).toBe(calls);
  });

  it("commits a valid advanced transaction and refreshes the revision", async () => {
    const { client } = await freshClient({
      http: new FakeAgentHttp({
        circuit: async ({ request }) => {
          switch (request.operation) {
            case "capabilities":
              return capabilitiesResponse(request.requestId);
            case "transact":
              return transactSuccessResponse(
                request.requestId,
                request.expectedRevision,
              );
            default:
              return snapshotResponse(request.requestId);
          }
        },
      }),
    });
    await client.connect("session-1.code");
    const report = await client.advancedTransact([
      {
        kind: "move_instance",
        instanceId: "instance-1",
        position: { x: 1, y: 2 },
      },
    ]);
    expect(report.ok).toBe(true);
    expect(report.revision).toBe(6);
    expect(client.summary("main")?.revision).toBe(6);
  });
});
