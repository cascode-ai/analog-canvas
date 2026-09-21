import { describe, expect, it, vi } from "vitest";
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
  it.each(["dirty", "other-project"])(
    "does not submit a %s operation snapshot",
    async (reason) => {
      const { client, http } = await freshClient();
      await client.connect("session-1.code");
      const snapshot = structuredClone(await client.snapshot());
      if (reason === "dirty") snapshot.dirty = true;
      else snapshot.snapshot.project.id = "other-project";
      http.circuitHandler = async ({ request }) => {
        expect(request.operation).toBe("snapshot");
        return snapshotResponse(request.requestId);
      };
      const report = await client.advancedTransact(
        {
          edits: [
            {
              kind: "set_instance_reference",
              instanceId: "R1",
              reference: "R2",
            },
          ],
        },
        { snapshot },
      );
      expect(report.ok).toBe(false);
    },
  );
  it("reuses a composed operation's snapshot and preserves its revision on conflicts", async () => {
    const { client, http } = await freshClient();
    await client.connect("session-1.code");
    const snapshot = await client.snapshot();
    const calls: string[] = [];
    http.circuitHandler = async ({ request }) => {
      calls.push(request.operation);
      if (request.operation === "transact") {
        expect(request.expectedRevision).toBe(snapshot.revision);
        return errorResponse(
          request.requestId,
          "transact",
          "REVISION_CONFLICT",
          "Human changed the document",
        );
      }
      throw new Error("Unexpected refetch");
    };
    const report = await client.advancedTransact(
      {
        edits: [
          { kind: "set_instance_reference", instanceId: "R1", reference: "R2" },
        ],
      },
      { snapshot },
    );
    expect(report).toMatchObject({
      ok: false,
      stage: "commit",
      code: "REVISION_CONFLICT",
    });
    expect(calls).toEqual(["transact"]);
  });
  it("waits for publication using fresh descriptor IDs without restarting the simulation", async () => {
    const ids: string[] = [];
    const http = new FakeAgentHttp({
      files: async (request) => {
        ids.push(request.requestId);
        return {
          apiVersion: "3.0",
          requestId: request.requestId,
          operation: "simulation-input",
          ok: true,
          result:
            ids.length < 3
              ? {
                  ok: false,
                  error: {
                    code: "ARTIFACT_TRANSFER_PENDING",
                    message: "Uploading",
                    stage: "export",
                    recovery: "retry-after",
                    retryAfterMs: 2000,
                  },
                }
              : {
                  ok: true,
                  artifact: {
                    id: "file",
                    name: "out.raw",
                    mediaType: "text/plain",
                    byteLength: 1,
                    sha256: "a".repeat(64),
                  },
                  download: {
                    path: "/api/agent/sessions/session-1/artifacts/file",
                  },
                },
        };
      },
    });
    const client = new AgentSessionClient({ http });
    await client.connect("session-1.code");
    const simulation = vi.spyOn(http, "simulation");
    const sleep = vi.fn(async () => undefined);
    expect(
      await client.prepareArtifactDownload("file", "first", { sleep }),
    ).toMatchObject({
      result: {
        ok: true,
        download: { path: "/api/agent/sessions/session-1/artifacts/file" },
      },
    });
    expect(ids[0]).toBe("first");
    expect(new Set(ids).size).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(simulation).not.toHaveBeenCalled();
    expect(http.claims).toHaveLength(1);
  });
  it("retains a canonical request ID and payload through network recovery", async () => {
    const { client, http } = await freshClient();
    await client.connect("session-1.code");
    const circuit = vi.spyOn(http, "circuit");
    circuit.mockRejectedValueOnce(
      new AgentSessionError("NETWORK_FAILURE", "lost response", "network"),
    );
    const request = {
      apiVersion: "3.0",
      operation: "snapshot",
      documentId: "main",
      requestId: "caller-owned-id",
    };
    expect(await client.request(request)).toMatchObject({ ok: true });
    expect(circuit).toHaveBeenCalledTimes(2);
    expect(circuit.mock.calls.map((call) => call[2])).toEqual([
      request,
      request,
    ]);
    await expect(
      client.request({ ...request, secret: "invalid" }),
    ).rejects.toThrow("Invalid Agent Circuit request");
  });
  it("probes status and clears a replaced project instead of reporting cached online", async () => {
    const { client, http } = await freshClient();
    await client.connect("session-1.code");
    vi.spyOn(http, "status").mockImplementation(async () => {
      throw new AgentSessionError(
        "PROJECT_REPLACED",
        "replaced",
        "unrecoverable-credential",
        410,
      );
    });
    expect((await client.status()).state).toBe("online");
    expect(await client.status({ refresh: true })).toMatchObject({
      state: "revoked",
      projectId: null,
      documentIds: [],
    });
  });
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

  it("reads relay observations without a Circuit probe and retains pairing on network failure", async () => {
    const { client, http } = await freshClient();
    await client.connect("session-1.code");
    const calls = http.circuitCalls.length;
    const probe = vi.spyOn(http, "status").mockResolvedValue({
      ok: true,
      sessionId: "session-1",
      projectId: "project-1",
      documentIds: ["main"],
      authorization: "paused",
      editor: "attached",
      observedAt: 1000,
      expiresAt: 999999,
    });
    expect(await client.status({ refresh: true })).toMatchObject({
      state: "paused",
    });
    probe.mockRejectedValueOnce(
      new AgentSessionError("NETWORK_FAILURE", "timeout", "network"),
    );
    expect(await client.status({ refresh: true })).toMatchObject({
      state: "unknown",
      projectId: "project-1",
      tokenValid: true,
    });
    probe.mockResolvedValue({
      ok: true,
      sessionId: "session-1",
      projectId: "project-1",
      documentIds: ["main"],
      authorization: "active",
      editor: "attached",
      observedAt: 2000,
      expiresAt: 999999,
    });
    expect(await client.status({ refresh: true })).toMatchObject({
      state: "attached",
    });
    expect(http.circuitCalls).toHaveLength(calls);
    await client.snapshot("main", { refresh: true });
    expect((await client.status()).state).toBe("online");
    expect(http.claims).toHaveLength(1);
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

  it.each(["snapshot", "refreshSnapshot", "render", "traceNet"] as const)(
    "resumes before selecting the default document for %s in a fresh process",
    async (operation) => {
      const directory = await mkdtemp(
        join(tmpdir(), "analog-default-document-"),
      );
      try {
        const store = new ConnectorStore(join(directory, "connector.json"));
        const http = new FakeAgentHttp();
        await new AgentSessionClient({ http, connectorStore: store }).connect(
          "session-1.code",
        );
        const restarted = new AgentSessionClient({
          http,
          connectorStore: store,
        });
        if (operation === "traceNet")
          await restarted.traceNet({ netId: "net-1" });
        else await restarted[operation]();
        expect(http.resumes).toHaveLength(1);
        expect(http.claims).toHaveLength(1);
        expect(http.circuitCalls.at(-1)?.request).toMatchObject({
          documentId: "main",
        });
        expect(
          restarted.cachedSnapshot("main") === null || operation !== "render",
        ).toBe(true);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("does not retry a revoked connector or fetch a document after failed recovery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analog-revoked-document-"));
    try {
      const store = new ConnectorStore(join(directory, "connector.json"));
      const http = new FakeAgentHttp();
      await new AgentSessionClient({ http, connectorStore: store }).connect(
        "session-1.code",
      );
      const calls = http.circuitCalls.length;
      const resume = vi
        .spyOn(http, "resumeConnector")
        .mockRejectedValue(
          new AgentSessionError(
            "SESSION_REVOKED",
            "revoked",
            "unrecoverable-credential",
          ),
        );
      const restarted = new AgentSessionClient({ http, connectorStore: store });
      expect(restarted.cachedSnapshot("main")).toBeNull();
      expect(resume).not.toHaveBeenCalled();
      await expect(restarted.snapshot()).rejects.toMatchObject({
        code: "SESSION_REVOKED",
      });
      expect(resume).toHaveBeenCalledTimes(1);
      expect(http.circuitCalls).toHaveLength(calls);
      expect(await store.load()).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not delete another origin's connector from an explicit shared path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analog-origin-"));
    try {
      const store = new ConnectorStore(join(directory, "connector.json"));
      const saved = {
        version: 1 as const,
        apiBaseUrl: "https://other.test",
        sessionId: "other",
        connectorToken: "private",
        connectorExpiresAt: 1,
        storedAt: 0,
      };
      await store.save(saved);
      const client = new AgentSessionClient({
        http: new FakeAgentHttp(),
        connectorStore: store,
      });
      await expect(client.connect()).rejects.toThrow();
      expect(await store.load()).toEqual(saved);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refreshes an expired bearer even after the saved connector deadline passed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analog-session-refresh-"));
    let nowMs = 1_000;
    try {
      const store = new ConnectorStore(join(directory, "connector.json"));
      const claim = {
        sessionId: "session-1",
        agentToken: "initial-token",
        tokenExpiresAt: 50_000,
        connectorToken: "connector-token",
        connectorExpiresAt: 60_000,
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

  it("uses the commit receipt without a redundant post-commit snapshot", async () => {
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
        kind: "set-reference",
        target: { kind: "instance", reference: "M1" },
        reference: "M2",
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
    // One relayed request per edit: the commit validates atomically, so no
    // client-side dry-run pass precedes it.
    expect(transactCalls).toEqual([{ dryRun: false, expectedRevision: 5 }]);
    // The API diff is authoritative, even if a later Snapshot would differ.
    expect(report.changedObjectIds).toEqual(["instance-3"]);
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
    expect(
      http.circuitCalls.filter((call) => call.request.operation === "snapshot"),
    ).toHaveLength(2);
    expect(client.recentTransactions()).toHaveLength(1);
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

  it("uses the explicitly selected document for refresh and commit", async () => {
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
      { documentId: "child" },
    );
    expect(report.ok).toBe(true);
    const documentIds = http.circuitCalls.flatMap((call) =>
      call.request.operation === "snapshot" ||
      call.request.operation === "transact"
        ? [call.request.documentId]
        : [],
    );
    expect(documentIds.slice(-2)).toEqual(["child", "child"]);
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

  it("does not silently rebase a source helper after a concurrent Project edit", async () => {
    const { client, http } = await freshClient();
    await client.connect("session-1.code");
    const current = testSnapshot();
    current.project.structureRevision = 12;
    http.circuitHandler = async ({ request }) =>
      snapshotResponse(request.requestId, current);
    const result = await client.advancedTransact(
      {
        structureEdits: [
          { kind: "remove_simulation_folder", folderId: "folder-1" },
        ],
      },
      { expectedStructureRevision: 11 },
    );
    expect(result).toMatchObject({ ok: false, code: "STATE_CHANGED" });
    expect(
      http.circuitCalls.some((call) => call.request.operation === "transact"),
    ).toBe(false);
    expect(client.connection.snapshot.state).toBe("online");
  });
});
