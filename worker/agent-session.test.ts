import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  BROWSER_LAUNCH_PATH,
  BROWSER_LAUNCH_PENDING_PROJECT,
  DEVICE_TRUST_PATH,
  browserLaunchProofText,
} from "@icm/agent-adapter/browser-launch";
import mcpDistribution from "../config/agent-mcp-distribution.json";
import {
  REQUEST_LEDGER_KEY_PREFIX,
  SESSION_STATE_KEY,
  fileOperationScopes,
  projectOperationAccess,
  requestLedgerKey,
  simulationOperationScopes,
} from "./agent-session-runtime";

import {
  AGENT_SSE_KEEPALIVE_INTERVAL_MS,
  AGENT_MCP_BOOTSTRAP_FORMAT,
  AgentFileResourceRequestSchema,
  AgentProjectResourceRequestSchema,
  AgentSessionMachine,
  AgentSessionScopeSchema,
  AgentSimulationResourceRequestSchema,
  agentMcpServerName,
  agentSiteTag,
  type AgentMcpBootstrapManifest,
  type AgentSessionLimits,
  type AgentSessionScope,
  type PersistedAgentSessionState,
} from "@icm/agent-adapter";
import {
  emptyAgentProject,
  liveAgentEditor,
} from "../apps/editor/src/agent/live-agent-editor.test-support";
import {
  HostedSimulationService,
  dividerFolder,
} from "../apps/editor/src/agent/live-simulation.test-support";
import {
  AGENT_OPERATING_KIT_FORMAT,
  AGENT_OPERATING_KIT_VERSION,
  agentOperatingKit,
  type AgentOperatingKit,
} from "@icm/agent-adapter/kit";

import {
  AgentSessionDO,
  redeemClaimResponse,
  relayHeaders,
  routeAgentSessionRequest,
  type AgentSessionNamespaceLike,
} from "./agent-session";
import { AgentDeviceTrustDirectory } from "./agent-device-trust";
import { purgeTrustedDevices } from "./agent-device-directory";

const limits: Partial<AgentSessionLimits> = {
  claimTtlMs: 60_000,
  tokenTtlMs: 60_000,
  sessionTtlMs: 120_000,
  maxRequestBytes: 128,
  rateLimit: { windowMs: 60_000, maxRequests: 10 },
};

it("requires import and all existing edit scopes for staged Cell body writes", () => {
  expect(
    fileOperationScopes({
      apiVersion: "3.0",
      requestId: "body",
      operation: "import-cell",
      candidateId: "c",
      sourceDocumentId: "s",
      targetDocumentId: "t",
      mode: "append",
      expectedStructureRevision: 0,
      expectedRevision: 0,
    }),
  ).toEqual([
    "project.import",
    "circuit.edit.geometry",
    "circuit.edit.connectivity",
    "circuit.edit.presentation",
  ]);
});

it("requires no spending grant for static authoring help without relaxing run access", () => {
  const scopes = (op: object) =>
    simulationOperationScopes(
      AgentSimulationResourceRequestSchema.parse({
        apiVersion: "3.0",
        requestId: "scope",
        ...op,
      }),
    );
  expect(scopes({ operation: "authoring-help", name: "embed" })).toEqual([]);
  expect(scopes({ operation: "capabilities" })).toEqual([]);
  expect(
    scopes({ operation: "start", preparedId: "p", digest: "a".repeat(64) }),
  ).toEqual(["simulation.run"]);
  expect(scopes({ operation: "read", runId: "r" })).toEqual(["simulation.run"]);
  expect(scopes({ operation: "catalog", runId: "r" })).toEqual([
    "simulation.run",
  ]);
  expect(scopes({ operation: "history-usage" })).toEqual(["simulation.run"]);
  expect(scopes({ operation: "history-delete", runId: "r" })).toEqual([
    "simulation.run",
  ]);
});

it("authorizes Project-owned Testbench files by Project grants, without simulation.run", () => {
  const scopes = (input: unknown) =>
    fileOperationScopes(
      AgentFileResourceRequestSchema.parse({
        apiVersion: "3.0",
        requestId: "files",
        operation: "simulation-input",
        input,
      }),
    );
  expect(
    scopes({
      action: "list",
      owner: { kind: "project-folder", folderId: "s" },
    }),
  ).toEqual(["project.download"]);
  expect(
    scopes({
      action: "read",
      owner: { kind: "project-folder", folderId: "s" },
      path: "testbench.spice",
    }),
  ).toEqual(["project.download"]);
  expect(scopes({ action: "list" })).toEqual(["simulation.run"]);
  expect(
    scopes({
      action: "update",
      owner: { kind: "session-workspace", workspaceId: "w" },
      expectedRevision: 0,
    }),
  ).toEqual(["simulation.run"]);
  expect(
    scopes({
      action: "update",
      owner: { kind: "project-folder", folderId: "s" },
      expectedRevision: 0,
    }),
  ).toEqual(["project.import"]);
  expect(scopes({ action: "artifact", artifactId: "a" })).toEqual([
    "simulation.run",
  ]);
});

it("opens a staged import under the Project import scope", () => {
  expect(
    fileOperationScopes(
      AgentFileResourceRequestSchema.parse({
        apiVersion: "3.0",
        requestId: "open-candidate",
        operation: "open",
        candidateId: "candidate-1",
      }),
    ),
  ).toEqual(["project.import"]);
});

it("authorizes Gallery, Project Code and Netlist operations by their real effects", () => {
  const access = (operation: Record<string, unknown>) =>
    projectOperationAccess(
      AgentProjectResourceRequestSchema.parse({
        apiVersion: "3.0",
        requestId: "projects",
        ...operation,
      }),
    );
  const scopes = (operation: Record<string, unknown>) =>
    access(operation).scopes;
  expect(scopes({ operation: "list-gallery" })).toEqual(["circuit.snapshot"]);
  const target = {
    projectId: "project",
    projectSessionId: "session",
    draftId: "draft",
    sessionId: "open-epoch",
  };
  expect(
    scopes({ operation: "components", request: { action: "authoring-read" } }),
  ).toEqual(["circuit.snapshot"]);
  expect(
    scopes({
      operation: "components",
      request: {
        action: "authoring-apply",
        target,
        expectedCandidateRevision: 0,
        dryRun: true,
      },
    }),
  ).toEqual(["circuit.snapshot"]);
  for (const action of ["authoring-save", "authoring-apply"])
    expect(
      scopes({
        operation: "components",
        request: { action, target, expectedCandidateRevision: 0 },
      }),
    ).toEqual([
      "project.import",
      "circuit.edit.geometry",
      "circuit.edit.connectivity",
      "circuit.edit.presentation",
    ]);
  expect(
    scopes({
      operation: "components",
      request: { action: "read", componentId: "native-model" },
    }),
  ).toEqual(["circuit.snapshot"]);
  expect(
    scopes({
      operation: "components",
      request: {
        action: "publish",
        componentId: "native-model",
        idempotencyKey: "publish",
        projectId: "project",
        expectedStructureRevision: 0,
        selection: { kind: "component", symbolId: "symbol" },
      },
    }),
  ).toEqual(["components.publish"]);
  expect(
    scopes({
      operation: "components",
      request: {
        action: "inspect",
        projectId: "project",
        expectedStructureRevision: 0,
        selection: { kind: "component", symbolId: "symbol" },
      },
    }),
  ).toEqual(["circuit.snapshot"]);
  expect(
    scopes({
      operation: "components",
      request: {
        action: "insert",
        componentId: "native-model",
        expectedLibraryRevision: 1,
        projectId: "project",
        targetDocumentId: "main",
        expectedStructureRevision: 0,
        expectedRevision: 0,
        position: { x: 0, y: 0 },
      },
    }),
  ).toEqual([
    "project.import",
    "circuit.edit.geometry",
    "circuit.edit.connectivity",
    "circuit.edit.presentation",
  ]);
  expect(
    scopes({
      operation: "insert-gallery-entry",
      galleryEntryId: "g1",
      targetDocumentId: "main",
      expectedRevision: 0,
      expectedStructureRevision: 0,
      position: { x: 0, y: 0 },
    }),
  ).toEqual([
    "project.import",
    "circuit.edit.geometry",
    "circuit.edit.connectivity",
    "circuit.edit.presentation",
  ]);
  expect(
    scopes({ operation: "read-gallery-entries", galleryEntryIds: ["g1"] }),
  ).toEqual(["circuit.snapshot"]);
  // Publishing is its own grant: drawing a circuit is not publishing it.
  expect(scopes({ operation: "publish-gallery-entry", name: "Amp" })).toEqual([
    "gallery.publish",
  ]);
  expect(
    scopes({ operation: "update-gallery-entry", galleryEntryId: "g1" }),
  ).toEqual(["gallery.publish"]);
  expect(scopes({ operation: "read-project-code" })).toEqual([
    "project.download",
  ]);
  expect(
    scopes({
      operation: "replace-project-code",
      projectCode: "{}",
      expectedStructureRevision: 0,
    }),
  ).toEqual([
    "circuit.edit.geometry",
    "circuit.edit.connectivity",
    "circuit.edit.presentation",
  ]);
  expect(
    scopes({
      operation: "replace-netlist",
      netlist: ".end\n",
      expectedStructureRevision: 0,
    }),
  ).toEqual(["circuit.edit.connectivity", "circuit.edit.presentation"]);
  expect(scopes({ operation: "list-projects" })).toEqual(["project.import"]);

  // A trusted-device task keeps to the browser's own tabs and copies.
  for (const local of [
    { operation: "read-project-code" },
    { operation: "read-netlist" },
    {
      operation: "replace-netlist",
      netlist: ".end\n",
      expectedStructureRevision: 0,
    },
    { operation: "workspace", request: { action: "list" } },
    {
      operation: "workspace",
      request: { action: "activate", workspaceId: "w" },
    },
    { operation: "workspace", request: { action: "new" } },
    { operation: "workspace", request: { action: "rename", name: "Amp" } },
    // Between open tabs; a tab holding a Cloud Project ends a trusted task.
    {
      operation: "workspace",
      request: {
        action: "copy",
        sourceWorkspaceId: "a",
        sourceDocumentId: "main",
        sourceRevision: 0,
        sourceStructureRevision: 0,
        targetWorkspaceId: "b",
        targetDocumentId: "main",
        expectedStructureRevision: 0,
        expectedRevision: 0,
        offset: { x: 0, y: 0 },
      },
    },
  ])
    expect(access(local).reachesAccount, JSON.stringify(local)).toBe(false);
  for (const account of [
    { operation: "list-gallery" },
    { operation: "list-projects" },
    { operation: "list-cells", cloudProjectId: "cloud" },
    { operation: "components", request: { action: "authoring-read" } },
    {
      operation: "workspace",
      request: { action: "open", cloudProjectId: "c" },
    },
    { operation: "workspace", request: { action: "save" } },
    { operation: "publish-gallery-entry", name: "Amp" },
  ])
    expect(access(account).reachesAccount, JSON.stringify(account)).toBe(true);
});

function folder() {
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

describe("agent-session relay", () => {
  it("answers the redeemer's retry by replacing the prior bearer, and no other redemption", () => {
    const { machine, session, now } = folder();
    const first = redeemClaimResponse(
      machine,
      session.claimCode,
      now(),
      "adapter-key-0001",
    );
    expect(first).toMatchObject({
      ok: true,
      sessionId: machine.sessionId,
      projectId: "project-1",
      documentIds: ["document-1"],
    });

    expect(
      redeemClaimResponse(
        machine,
        session.claimCode,
        now(),
        "adapter-key-0002",
      ),
    ).toMatchObject({ ok: false, error: { code: "CLAIM_ALREADY_REDEEMED" } });
    const retry = redeemClaimResponse(
      machine,
      session.claimCode,
      now(),
      "adapter-key-0001",
    );
    expect(retry).toMatchObject({ ok: true, projectId: "project-1" });
    if (!first.ok || !retry.ok) return;
    expect(retry.agentToken).not.toBe(first.agentToken);
    expect(machine.authorize(first.agentToken, now())).toEqual({
      ok: false,
      code: "SESSION_TAKEN_OVER",
    });
    expect(machine.authorize(retry.agentToken, now()).ok).toBe(true);
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
  async list({ limit }: { limit: number }): Promise<Map<string, unknown>> {
    return new Map([...this.values].slice(0, limit));
  }
  async delete(keys: string[]): Promise<number> {
    return keys.filter((key) => this.values.delete(key)).length;
  }
  async deleteAll(): Promise<void> {
    this.values.clear();
  }
  async setAlarm(scheduledTime: number): Promise<void> {
    this.alarm = scheduledTime;
  }
}

function routedFixture(dropDeviceRevocation?: (sessionId: string) => boolean) {
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
          {
            AGENT_ALLOWED_ORIGIN: "https://editor.example",
            AGENT_SESSION: namespace,
          },
        );
        objects.set(name, object);
      }
      return {
        fetch: (input, init) => {
          const request = new Request(input, init);
          if (
            new URL(request.url).pathname === "/revoke-trusted-device" &&
            dropDeviceRevocation?.(name)
          )
            return Promise.resolve(new Response(null, { status: 503 }));
          return object!.fetch(request);
        },
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

it("trusts a proven installation for one account and origin, then revokes its active tasks", async () => {
  const origin = "https://editor.example";
  let unreachableSession: string | null = null;
  const fixture = routedFixture(
    (sessionId) => sessionId === unreachableSession,
  );
  const env = {
    ...fixture.env,
    AUTH: {
      getByName: () => ({
        fetch: async (_input: string | Request, init?: RequestInit) => {
          const cookie = new Headers(init?.headers).get("cookie");
          const id =
            cookie === "icm_session=a"
              ? "owner-a"
              : cookie === "icm_session=b"
                ? "owner-b"
                : undefined;
          return Response.json({ user: id ? { id } : null });
        },
      }),
    },
  };
  const key = generateKeyPairSync("ed25519");
  const call = async (path: string, init?: RequestInit, site = origin) => {
    const result = await routeAgentSessionRequest(
      new Request(site + path, init),
      env,
    );
    expect(result).toBeInstanceOf(Response);
    return result!;
  };
  const post = (path: string, payload: object, site = origin) =>
    call(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      site,
    );
  const launch = async (site = origin) => {
    const created = await post(
      "/api/agent/sessions",
      {
        browserLaunch: true,
        projectSessionId: crypto.randomUUID(),
        projectId: BROWSER_LAUNCH_PENDING_PROJECT,
        documentIds: [],
        scopes: AgentSessionScopeSchema.options,
      },
      site,
    );
    expect(created.status).toBe(200);
    const { session } = (await created.json()) as {
      session: { sessionId: string; launchGrant: string; claimCode: string };
    };
    const claim = await post(
      "/api/agent/claims",
      { claimCode: session.claimCode },
      site,
    );
    expect(claim.status).toBe(200);
    const { agentToken } = (await claim.json()) as { agentToken: string };
    return {
      ...session,
      headers: { authorization: `Bearer ${agentToken}` },
      site,
    };
  };
  const approve = (
    task: Awaited<ReturnType<typeof launch>>,
    approval: "once" | "trust" | "auto",
    options: {
      account?: string;
      signingKey?: typeof key;
      signatureSite?: string;
    } = {},
  ) => {
    const {
      account = "a",
      signingKey = key,
      signatureSite = task.site,
    } = options;
    const proof = sign(
      null,
      Buffer.from(
        browserLaunchProofText(signatureSite, task.sessionId, task.launchGrant),
      ),
      signingKey.privateKey,
    );
    return call(
      BROWSER_LAUNCH_PATH,
      {
        method: "POST",
        headers: {
          origin: task.site,
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "same-origin",
          cookie: `icm_session=${account}`,
        },
        body: new URLSearchParams({
          sessionId: task.sessionId,
          grant: task.launchGrant,
          deviceKey: signingKey.publicKey.export({ format: "jwk" }).x!,
          deviceProof: proof.toString("base64url"),
          deviceName: `Work laptop${String.fromCharCode(0x202e)} (win32)`,
          approval,
        }),
      },
      task.site,
    );
  };
  const first = await launch();
  expect((await approve(first, "auto")).status).toBe(403);
  expect(
    (
      await approve(first, "trust", {
        signatureSite: "https://elsewhere.example",
      })
    ).status,
  ).toBe(403);
  const consent = await approve(first, "trust");
  expect(consent.status).toBe(200);
  const firstApproval = (await consent.json()) as {
    scopes: string[];
    editorSecret: string;
    localReviewOnly: boolean;
  };
  const allowed = firstApproval.scopes;
  expect(firstApproval.localReviewOnly).toBe(true);
  expect(allowed).toEqual(
    expect.arrayContaining([
      "circuit.snapshot",
      "project.import",
      "circuit.edit.geometry",
    ]),
  );
  for (const denied of [
    "gallery.publish",
    "simulation.run",
    "components.publish",
  ])
    expect(allowed).not.toContain(denied);
  expect((await approve(first, "trust")).status).toBe(409);

  const otherSite = await launch("https://another-editor.example");
  expect((await approve(otherSite, "auto")).status).toBe(403);
  const second = await launch();
  expect((await approve(second, "auto", { account: "b" })).status).toBe(403);
  expect(
    (
      await approve(second, "auto", {
        signingKey: generateKeyPairSync("ed25519"),
      })
    ).status,
  ).toBe(403);
  expect((await approve(second, "auto")).status).toBe(200);
  const observed = await call(
    `/api/agent/sessions/${second.sessionId}/status`,
    { headers: second.headers },
  );
  expect(await observed.json()).toMatchObject({ scopes: allowed });
  for (const request of [
    { operation: "list-projects" },
    {
      operation: "workspace",
      request: { action: "open", cloudProjectId: "private" },
    },
    { operation: "workspace", request: { action: "save" } },
    { operation: "list-gallery", scope: "ai-seats" },
  ]) {
    const denied = await call(
      `/api/agent/sessions/${second.sessionId}/projects`,
      {
        method: "POST",
        headers: { ...second.headers, "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: "3.0",
          requestId: crypto.randomUUID(),
          ...request,
        }),
      },
    );
    expect(denied.status, JSON.stringify(request)).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: { code: "TRUSTED_TASK_LOCAL_ONLY" },
    });
  }
  const hosted = await call(
    `/api/agent/sessions/${second.sessionId}/simulation`,
    {
      method: "POST",
      headers: { ...second.headers, "content-type": "application/json" },
      body: JSON.stringify({
        apiVersion: "3.0",
        requestId: crypto.randomUUID(),
        operation: "start",
        preparedId: "prepared",
        digest: "a".repeat(64),
      }),
    },
  );
  expect(hosted.status).toBe(403);
  expect(await hosted.json()).toMatchObject({
    error: {
      code: "TRUSTED_TASK_LOCAL_ONLY",
      message: expect.stringContaining("approves once"),
    },
  });

  const firstSocket = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
  };
  fixture.sockets.set(first.sessionId, [firstSocket as unknown as WebSocket]);
  await fixture.objects.get(first.sessionId)!.webSocketMessage(
    firstSocket as unknown as WebSocket,
    JSON.stringify({
      protocolVersion: "1.0",
      sessionId: first.sessionId,
      kind: "heartbeat",
      nonce: "local-project",
      contextRevision: "local-context",
      projectId: "local-project",
      documentIds: ["local-cell"],
    }),
  );
  const pending = call(`/api/agent/sessions/${first.sessionId}/circuit`, {
    method: "POST",
    headers: { ...first.headers, "content-type": "application/json" },
    body: JSON.stringify({
      apiVersion: "3.0",
      requestId: "pending-local-snapshot",
      operation: "snapshot",
      documentId: "local-cell",
    }),
  });
  await vi.waitFor(() =>
    expect(firstSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"kind":"circuit-request"'),
    ),
  );
  const storage = fixture.storages.get(first.sessionId)!;
  const beforeRevocation = await storage.get(SESSION_STATE_KEY);
  const explicitEnd = await call(
    `/api/agent/sessions/${first.sessionId}/control`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-editor-secret": firstApproval.editorSecret,
      },
      body: JSON.stringify({ action: "revoke" }),
    },
  );
  expect(explicitEnd.status).toBe(200);
  expect(await (await pending).json()).toMatchObject({
    error: { code: "SESSION_REVOKED" },
  });
  expect(await storage.get(SESSION_STATE_KEY)).toBeUndefined();
  // Simulate eviction after the marker committed but before old state was cleaned.
  await storage.put(SESSION_STATE_KEY, beforeRevocation);

  const devices = await call(DEVICE_TRUST_PATH, {
    headers: { cookie: "icm_session=a" },
  });
  const {
    devices: [device],
  } = (await devices.json()) as {
    devices: {
      id: string;
      name?: string;
      trustedAt: number;
      lastUsedAt?: number;
    }[];
  };
  expect(device?.id).toMatch(/^[a-f0-9]{64}$/u);
  // The label loses its direction override; the second task renewed its use.
  expect(device?.name).toBe("Work laptop (win32)");
  expect(device!.lastUsedAt).toBeGreaterThanOrEqual(device!.trustedAt);
  const revoke = (cookie: string) =>
    call(`${DEVICE_TRUST_PATH}/${device!.id}`, {
      method: "DELETE",
      headers: { cookie, origin, "sec-fetch-site": "same-origin" },
    });
  expect((await revoke("icm_session=b")).status).toBe(204);
  const stillTrusted = await launch();
  expect((await approve(stillTrusted, "auto")).status).toBe(200);
  unreachableSession = second.sessionId;
  const socket = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
  fixture.sockets.set(second.sessionId, [socket]);
  expect((await revoke("icm_session=a")).status).toBe(204);
  expect(socket.close).not.toHaveBeenCalled();
  await fixture.objects.get(second.sessionId)!.webSocketMessage(socket, "{}");
  expect(socket.close).toHaveBeenCalledWith(4003, "Agent session revoked");
  for (const task of [first, second, stillTrusted]) {
    fixture.objects.delete(task.sessionId); // Restore the revocation tombstone on eviction.
    const status = await call(`/api/agent/sessions/${task.sessionId}/status`, {
      headers: task.headers,
    });
    expect(await status.json()).toMatchObject({
      error: { code: "SESSION_REVOKED" },
    });
  }
  const fresh = await launch();
  expect((await approve(fresh, "auto")).status).toBe(403);
  const once = await approve(fresh, "once");
  expect(once.status).toBe(200);
  expect(await once.json()).toMatchObject({
    scopes: expect.arrayContaining(["gallery.publish", "simulation.run"]),
  });
});

it("does not authorize an automatic task before a trusted-device enrollment commits", async () => {
  const directory = new AgentDeviceTrustDirectory(new MemoryStorage());
  const deviceId = "a".repeat(64);
  const grant = (action: string, sessionId: string, trustId?: string) =>
    directory.handle(
      new Request("https://agent-session.internal/device-trust/grant", {
        method: "POST",
        body: JSON.stringify({ action, sessionId, deviceId, trustId }),
      }),
    );
  const pending = await grant("trust", "first");
  const { trustId } = (await pending.json()) as { trustId: string };
  expect((await grant("auto", "concurrent")).status).toBe(403);
  expect((await grant("remove-session", "first", trustId)).status).toBe(200);
  expect((await grant("commit", "first", trustId)).status).toBe(409);
  expect((await grant("auto", "fresh")).status).toBe(403);
});

/** Browser launches from one installation for one signed-in account. */
function trustedLaunches() {
  const origin = "https://editor.example";
  const account = "member";
  const cookie = `icm_session=${account}`;
  const fixture = routedFixture();
  const env = {
    ...fixture.env,
    AUTH: {
      getByName: () => ({
        fetch: async (_input: string | Request, init?: RequestInit) =>
          Response.json({
            user:
              new Headers(init?.headers).get("cookie") === cookie
                ? { id: account }
                : null,
          }),
      }),
    },
  };
  const key = generateKeyPairSync("ed25519");
  const call = async (path: string, init?: RequestInit) => {
    const result = await routeAgentSessionRequest(
      new Request(origin + path, init),
      env,
    );
    expect(result).toBeInstanceOf(Response);
    return result!;
  };
  const post = (path: string, payload: object) =>
    call(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  const open = async (approval: "once" | "trust" | "auto") => {
    const created = await post("/api/agent/sessions", {
      browserLaunch: true,
      projectSessionId: crypto.randomUUID(),
      projectId: BROWSER_LAUNCH_PENDING_PROJECT,
      documentIds: [],
      scopes: AgentSessionScopeSchema.options,
    });
    const { session } = (await created.json()) as {
      session: { sessionId: string; launchGrant: string; claimCode: string };
    };
    const claim = await post("/api/agent/claims", {
      claimCode: session.claimCode,
    });
    const { agentToken } = (await claim.json()) as { agentToken: string };
    const proof = sign(
      null,
      Buffer.from(
        browserLaunchProofText(origin, session.sessionId, session.launchGrant),
      ),
      key.privateKey,
    );
    const approved = await call(BROWSER_LAUNCH_PATH, {
      method: "POST",
      headers: {
        origin,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "same-origin",
        cookie,
      },
      body: new URLSearchParams({
        sessionId: session.sessionId,
        grant: session.launchGrant,
        deviceKey: key.publicKey.export({ format: "jwk" }).x!,
        deviceProof: proof.toString("base64url"),
        approval,
      }),
    });
    const control = async (action: string) => {
      const { editorSecret } = (await approved.clone().json()) as {
        editorSecret: string;
      };
      return call(`/api/agent/sessions/${session.sessionId}/control`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-editor-secret": editorSecret,
        },
        body: JSON.stringify({ action }),
      });
    };
    const status = async () =>
      (await call(`/api/agent/sessions/${session.sessionId}/status`, {
        headers: { authorization: `Bearer ${agentToken}` },
      }).then((response) => response.json())) as {
        error?: { code: string; message: string };
      };
    return { approved, control, status };
  };
  const devices = async () =>
    (
      (await (
        await call(DEVICE_TRUST_PATH, { headers: { cookie } })
      ).json()) as {
        devices: { id: string }[];
      }
    ).devices;
  return { origin, account, env, open, devices };
}

it("names the account and installation on the launch prompt as inert text", async () => {
  const { env } = routedFixture();
  const origin = "https://editor.example";
  const created = await routeAgentSessionRequest(
    new Request(origin + "/api/agent/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        browserLaunch: true,
        projectSessionId: crypto.randomUUID(),
        projectId: BROWSER_LAUNCH_PENDING_PROJECT,
        documentIds: [],
        scopes: AgentSessionScopeSchema.options,
      }),
    }),
    env,
  );
  const { session } = (await created!.json()) as {
    session: { sessionId: string; launchGrant: string };
  };
  const key = generateKeyPairSync("ed25519");
  const proof = sign(
    null,
    Buffer.from(
      browserLaunchProofText(origin, session.sessionId, session.launchGrant),
    ),
    key.privateKey,
  );
  const name = "</script><b>Laptop</b>";
  const prompt = await routeAgentSessionRequest(
    new Request(origin + BROWSER_LAUNCH_PATH, {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:4100",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        sessionId: session.sessionId,
        grant: session.launchGrant,
        deviceKey: key.publicKey.export({ format: "jwk" }).x!,
        deviceProof: proof.toString("base64url"),
        deviceName: name,
      }),
    }),
    env,
  );
  expect(prompt!.status).toBe(200);
  const html = await prompt!.text();
  expect(html).toContain("Trust this device");
  // The page reads the signed-in account itself; the name stays script data.
  expect(html).toContain('fetch("/api/auth/me"');
  expect(html).not.toContain(name);
  expect(html).toContain(
    name.replace(
      /[<>]/gu,
      (character) =>
        "\\" + "u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
    ),
  );
});

it("lets a trusted tab stop trusting its device, which ends the device's tasks", async () => {
  const { open, devices } = trustedLaunches();
  const once = await open("once");
  expect((await once.control("untrust-device")).status).toBe(409);
  const first = await open("trust");
  expect(first.approved.status).toBe(200);
  const second = await open("auto");
  expect(second.approved.status).toBe(200);
  expect(await devices()).toHaveLength(1);

  expect(await (await first.control("untrust-device")).json()).toMatchObject({
    ok: true,
    status: "revoked",
  });
  for (const task of [first, second])
    expect(await task.status()).toMatchObject({
      error: {
        code: "SESSION_REVOKED",
        message: expect.stringContaining("no longer trusted"),
      },
    });
  expect(await devices()).toEqual([]);
  // The next task from this installation asks again.
  expect((await open("auto")).approved.status).toBe(403);
  expect((await once.status()).error).toBeUndefined();
});

it("tells the Agent whether the device of an ended trusted task is still trusted", async () => {
  const { open, devices } = trustedLaunches();
  const once = await open("once");
  await once.control("revoke");
  expect(await once.status()).toMatchObject({
    error: { code: "SESSION_REVOKED", message: "Session has been revoked" },
  });
  // Disconnect in the tab ends the task; the device stays trusted.
  const ended = await open("trust");
  await ended.control("revoke");
  const stillTrusted = {
    error: {
      code: "SESSION_REVOKED",
      message: expect.stringContaining("is still trusted"),
    },
  };
  expect(await ended.status()).toMatchObject(stillTrusted);
  expect(await devices()).toHaveLength(1);
  const untrusted = await open("auto");
  await untrusted.control("untrust-device");
  expect(await untrusted.status()).toMatchObject({
    error: { message: expect.stringContaining("no longer trusted") },
  });
  // A task keeps the answer it ended with.
  expect(await ended.status()).toMatchObject(stillTrusted);
});

it("forgets an account's trusted devices and ends their tasks when it is deleted", async () => {
  const { origin, account, env, open, devices } = trustedLaunches();
  const task = await open("trust");
  expect(task.approved.status).toBe(200);
  expect(await purgeTrustedDevices(env.AGENT_SESSION, origin, account)).toBe(
    true,
  );
  expect(await task.status()).toMatchObject({
    error: {
      code: "SESSION_REVOKED",
      message: expect.stringContaining("no longer trusted"),
    },
  });
  expect(await devices()).toEqual([]);
  expect((await open("auto")).approved.status).toBe(403);
  // Isolated Auth tests run without the binding: there is nothing to forget.
  expect(await purgeTrustedDevices(undefined, origin, account)).toBe(true);
});

type LiveEditor = ReturnType<typeof liveAgentEditor>;

it("lets a Claim session ask its editor for a review delivery", async () => {
  const { env, objects, sockets } = routedFixture();
  const post = (path: string, input: object, token?: string) =>
    routeAgentSessionRequest(
      new Request(`https://editor.example${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(input),
      }),
      env,
    );
  let pairings = 0;
  const paired = async (
    scopes: AgentSessionScope[],
    body: object = {
      apiVersion: "3.0",
      requestId: "claim-review",
      operation: "review",
    },
  ) => {
    const create = await post("/api/agent/sessions", {
      projectId: "project",
      projectSessionId: `workspace-${++pairings}`,
      documentIds: ["main"],
      scopes,
    });
    expect(create?.status).toBe(200);
    const { session } = (await create!.json()) as {
      session: { sessionId: string; claimCode: string };
    };
    const claimed = await post("/api/agent/claims", {
      claimCode: session.claimCode,
    });
    expect(claimed?.status).toBe(200);
    const { agentToken } = (await claimed!.json()) as { agentToken: string };
    const browser = editorEnd(editorFor("project", "main"), () =>
      objects.get(session.sessionId)!,
    );
    sockets.set(session.sessionId, [browser.socket]);
    const review = await post(
      `/api/agent/sessions/${session.sessionId}/files`,
      body,
      agentToken,
    );
    return { review: review!, families: browser.families };
  };
  // The editor, not the relay, decides whether this tab holds a delivery.
  const granted = await paired(["project.import", "project.download"]);
  expect(granted.families).toEqual(["file"]);
  expect(await granted.review.json()).toMatchObject({
    operation: "review",
    ok: false,
    error: { code: "REVIEW_WORKSPACE_REQUIRED" },
  });
  // A review action an adapter before 0.17.104 sends is refused unforwarded.
  const retired = await paired(["project.import", "project.download"], {
    apiVersion: "3.0",
    requestId: "claim-review-read",
    operation: "review",
    input: { action: "read" },
  });
  expect(retired.review.status).toBe(400);
  expect(retired.families).toEqual([]);
  expect(await retired.review.json()).toMatchObject({
    error: { code: "FILE_CONTENT_INVALID" },
  });
  // A review reads the netlist back, as a Project download does.
  for (const scopes of [
    ["project.download"],
    ["project.import"],
  ] satisfies AgentSessionScope[][]) {
    const ungranted = await paired(scopes);
    expect(ungranted.review.status).toBe(403);
    expect(ungranted.families).toEqual([]);
    expect(await ungranted.review.json()).toMatchObject({
      error: { code: "TOKEN_SCOPE_INSUFFICIENT" },
    });
  }
});

/** A live editor whose Project and Cell carry the session's identities. */
function editorFor(
  projectId: string,
  documentId: string,
  options: Omit<Parameters<typeof liveAgentEditor>[0] & {}, "project"> = {},
): LiveEditor {
  const project = emptyAgentProject();
  project.id = projectId;
  project.documents[0]!.id = documentId;
  project.topDocumentId = documentId;
  project.simulationFolders = [dividerFolder("divider", "Divider")];
  return liveAgentEditor({ ...options, project });
}

/**
 * The browser end of a session, as the session hook is: it takes each request
 * the relay sends over the socket, has the real editor answer it, and sends
 * the answer back in a response envelope with the hook's timing. Only the
 * envelope is this test's; every answer is the editor's own.
 */
function editorEnd(
  editor: LiveEditor,
  object: () => AgentSessionDO,
  seen: (envelope: { kind: string }) => void = () => {},
) {
  const families: string[] = [];
  const socket = {
    readyState: WebSocket.OPEN,
    send(text: string) {
      const envelope = JSON.parse(text) as { kind: string; payload: unknown };
      seen(envelope);
      if (!envelope.kind.endsWith("-request")) return;
      const family = envelope.kind.slice(0, -"-request".length);
      families.push(family);
      void editorAnswer(editor, family, envelope.payload).then((payload) =>
        object().webSocketMessage(
          socket,
          JSON.stringify({
            ...envelope,
            kind: `${family}-response`,
            timing: { workMs: 42, visibility: "hidden" },
            payload,
          }),
        ),
      );
    },
  } as unknown as WebSocket;
  return { socket, families };
}

async function editorAnswer(
  editor: LiveEditor,
  family: string,
  payload: unknown,
): Promise<unknown> {
  switch (family) {
    case "circuit":
      return editor.service.handle(payload);
    case "file":
      return editor.fileHost.handle(
        AgentFileResourceRequestSchema.parse(payload),
      );
    case "project":
      return editor.projectHost.handle(
        AgentProjectResourceRequestSchema.parse(payload),
      );
    case "simulation":
      return editor.simulationHost!.handle(
        AgentSimulationResourceRequestSchema.parse(payload),
      );
  }
  throw new Error(`The editor answers no ${family} request`);
}

describe("public Agent session routes", () => {
  it("relays typed simulation failures without revoking a session and replays a receipt once", async () => {
    const { env, objects, sockets } = routedFixture();
    const post = (path: string, body: unknown, token?: string) =>
      routeAgentSessionRequest(
        new Request(`https://editor.example${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        }),
        env,
      );
    const created = (await (await post("/api/agent/sessions", {
      projectSessionId: "p:sim",
      projectId: "p",
      documentIds: ["doc"],
      scopes: ["simulation.run"],
    }))!.json()) as { session: { sessionId: string; claimCode: string } };
    const claim = (await (await post("/api/agent/claims", {
      claimCode: created.session.claimCode,
    }))!.json()) as { agentToken: string };
    const id = created.session.sessionId;
    const service = new HostedSimulationService();
    const browser = editorEnd(
      editorFor("p", "doc", {
        scopes: ["simulation.run"],
        simulationService: service.fetch,
      }),
      () => objects.get(id)!,
    );
    sockets.set(id, [browser.socket]);
    const path = `/api/agent/sessions/${id}/simulation`,
      base = { apiVersion: "3.0" };
    // A folder the Project lacks: the editor's typed failure passes through.
    const error = await post(
      path,
      {
        ...base,
        requestId: "bad",
        operation: "prepare",
        source: {
          kind: "project-folder",
          folderId: "folder-1",
          expectedStructureRevision: 0,
        },
      },
      claim.agentToken,
    );
    expect(error!.status).toBe(200);
    expect(await error!.json()).toMatchObject({
      ok: false,
      error: { stage: "prepare" },
    });
    // The session survives it: the divider prepares, and its start runs once.
    const prepared = (await (await post(
      path,
      {
        ...base,
        requestId: "prepare",
        operation: "prepare",
        source: {
          kind: "project-folder",
          folderId: "divider",
          expectedStructureRevision: 0,
        },
      },
      claim.agentToken,
    ))!.json()) as { ok: boolean; prepared: { id: string; digest: string } };
    expect(prepared.ok).toBe(true);
    const start = {
      ...base,
      requestId: "once",
      operation: "start",
      preparedId: prepared.prepared.id,
      digest: prepared.prepared.digest,
    };
    const run = (await (await post(path, start, claim.agentToken))!.json()) as {
      ok: boolean;
      run: { id: string };
    };
    expect(run.ok).toBe(true);
    expect(
      await (await post(path, start, claim.agentToken))!.json(),
    ).toMatchObject({ ok: true, run: { id: run.run.id } });
    expect(browser.families).toEqual([
      "simulation",
      "simulation",
      "simulation",
    ]);
    // The start's receipt comes back once the run is accepted; its execution
    // reaches the simulator just after. The repeated start never reached the
    // editor (three requests above), so it cannot add a second execution.
    await expect.poll(() => service.executions).toBe(1);
    expect(
      (await post(path, { ...start, requestId: "other" }, "wrong-token"))!
        .status,
    ).toBe(401);
    expect(browser.families).toHaveLength(3);
  });
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
      "/api/agent/sessions/{sessionId}/artifact-status",
      "/api/agent/sessions/{sessionId}/artifacts/{fileId}",
      "/api/agent/sessions/{sessionId}/circuit",
      "/api/agent/sessions/{sessionId}/files",
      "/api/agent/sessions/{sessionId}/projects",
      "/api/agent/sessions/{sessionId}/simulation",
      "/api/agent/sessions/{sessionId}/status",
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
    expect(kit).toEqual(agentOperatingKit);
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
    const serverName = agentMcpServerName("https://editor.example");
    expect(serverName).toMatch(/^analog-canvas-[0-9a-f]{16}$/u);
    expect(manifest).toMatchObject({
      format: AGENT_MCP_BOOTSTRAP_FORMAT,
      name: serverName,
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
    expect(manifest.installation.command).toContain(
      '--install --origin "https://editor.example" --host config',
    );
    expect(manifest.hosts.codex.command).toContain(
      '--origin "https://editor.example" --host codex',
    );
    expect(manifest.launch.env.ANALOG_CANVAS_API_URL).toBe(
      "https://editor.example",
    );
    expect(manifest.hosts.cursor.config.mcpServers[serverName]).toEqual(
      manifest.launch,
    );
    expect(manifest.hosts.claudeCode.command).toContain(
      '--install --origin "https://editor.example" --host config',
    );
  });

  it("names each site's MCP server apart in every host entry", async () => {
    const { env } = routedFixture();
    const names = await Promise.all(
      ["https://analog-canvas.example", "http://localhost:18082"].map(
        async (origin) => {
          const response = await routeAgentSessionRequest(
            new Request(`${origin}/api/agent/mcp-manifest.json`),
            env,
          );
          const manifest =
            (await response!.json()) as AgentMcpBootstrapManifest;
          expect(Object.keys(manifest.hosts.cursor.config.mcpServers)).toEqual([
            manifest.name,
          ]);
          return manifest.name;
        },
      ),
    );
    expect(names).toEqual([
      agentMcpServerName("https://analog-canvas.example"),
      agentMcpServerName("http://localhost:18082"),
    ]);
    expect(names[0]).not.toBe(names[1]);
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

  it("preserves a claimed session when its editor is detached without a page exit", async () => {
    const { env } = routedFixture();
    const origin = "https://editor.example";
    const call = (path: string, init?: RequestInit) =>
      routeAgentSessionRequest(new Request(origin + path, init), env);
    const post = (body: unknown) => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const created = await call(
      "/api/agent/sessions",
      post({
        projectSessionId: "project:recover",
        projectId: "project",
        documentIds: ["document-main"],
        scopes: ["circuit.snapshot"],
      }),
    );
    const { session } = await created!.json();
    const claimed = await call(
      "/api/agent/claims",
      post({ claimCode: session.claimCode }),
    );
    const { agentToken } = await claimed!.json();
    const path = `/api/agent/sessions/${session.sessionId}`;
    const headers = { authorization: `Bearer ${agentToken}` };

    expect(
      (await call(`${path}/detached-editor`, { method: "DELETE", headers }))
        ?.status,
    ).toBe(409);
    const status = await call(`${path}/status`, { headers });
    expect(await status!.json()).toMatchObject({
      ok: true,
      authorization: "active",
      editor: "detached",
    });
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
            apiVersion: "3.0",
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

  it("tags new sessions with their site and refuses another site's Claim and connector", async () => {
    const { env, objects } = routedFixture();
    const route = (origin: string, path: string, body: unknown) =>
      routeAgentSessionRequest(
        new Request(`${origin}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
      );
    const created = (await (await route(
      "https://editor.example",
      "/api/agent/sessions",
      {
        projectSessionId: "project:site",
        projectId: "project",
        documentIds: ["document-main"],
        scopes: ["circuit.snapshot"],
      },
    ))!.json()) as { session: { sessionId: string; claimCode: string } };
    const { sessionId, claimCode } = created.session;
    expect(sessionId).toMatch(
      new RegExp(`^${agentSiteTag("https://editor.example")}_[0-9a-f-]{36}$`),
    );

    const elsewhere = await route(
      "http://localhost:18082",
      "/api/agent/claims",
      {
        claimCode,
      },
    );
    expect(elsewhere!.status).toBe(421);
    const refusal = (await elsewhere!.json()) as {
      error: { code: string; message: string };
    };
    expect(refusal.error.code).toBe("CLAIM_WRONG_SITE");
    expect(refusal.error.message).toContain("http://localhost:18082");
    expect(refusal.error.message).toContain("copied connection message");
    // Refused before any session object is addressed.
    expect([...objects.keys()]).toEqual([sessionId]);

    const claimed = await route("https://editor.example", "/api/agent/claims", {
      claimCode,
    });
    expect(claimed!.status).toBe(200);
    const { connectorToken } = (await claimed!.json()) as {
      connectorToken: string;
    };
    const resumedElsewhere = await route(
      "http://localhost:18082",
      "/api/agent/connectors/resume",
      { sessionId, connectorToken },
    );
    expect(resumedElsewhere!.status).toBe(421);
    expect(await resumedElsewhere!.json()).toMatchObject({
      ok: false,
      error: { code: "CLAIM_WRONG_SITE" },
    });
  });

  it("treats loopback names as one site and keeps legacy untagged sessions working anywhere", async () => {
    const { env } = routedFixture();
    const route = (origin: string, path: string, body: unknown) =>
      routeAgentSessionRequest(
        new Request(`${origin}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
      );
    const local = (await (await route(
      "http://127.0.0.1:5173",
      "/api/agent/sessions",
      {
        projectSessionId: "project:loopback",
        projectId: "project",
        documentIds: ["document-main"],
        scopes: ["circuit.snapshot"],
      },
    ))!.json()) as { session: { claimCode: string } };
    expect(
      (await route("http://localhost:5173", "/api/agent/claims", {
        claimCode: local.session.claimCode,
      }))!.status,
    ).toBe(200);

    // A session created before site tags has a bare UUID.
    const legacyId = crypto.randomUUID();
    const legacy = (await (
      await env.AGENT_SESSION.getByName(legacyId).fetch(
        "https://agent-session.internal/create",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: legacyId,
            projectSessionId: "project:legacy",
            projectId: "project",
            documentIds: ["document-main"],
            scopes: ["circuit.snapshot"],
          }),
        },
      )
    ).json()) as { session: { claimCode: string } };
    const claimed = await route("http://localhost:18082", "/api/agent/claims", {
      claimCode: `${legacyId}.${legacy.session.claimCode}`,
    });
    expect(claimed!.status).toBe(200);
    const { connectorToken } = (await claimed!.json()) as {
      connectorToken: string;
    };
    expect(
      (await route(
        "https://another-site.example",
        "/api/agent/connectors/resume",
        { sessionId: legacyId, connectorToken },
      ))!.status,
    ).toBe(200);
  });

  it("refuses a reused Claim, answers its redeemer's retry and reports the takeover", async () => {
    const { env } = routedFixture();
    const route = (path: string, body: unknown, key?: string) =>
      routeAgentSessionRequest(
        new Request(`https://editor.example${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(key ? { "x-agent-redemption": key } : {}),
          },
          body: JSON.stringify(body),
        }),
        env,
      );
    const created = (await (await route("/api/agent/sessions", {
      projectSessionId: "project:single-use",
      projectId: "project",
      documentIds: ["document-main"],
      scopes: ["circuit.snapshot"],
    }))!.json()) as { session: { sessionId: string; claimCode: string } };
    const { sessionId, claimCode } = created.session;
    type Credentials = { agentToken: string; connectorToken: string };
    const first = await route(
      "/api/agent/claims",
      { claimCode },
      "chat-one-key-0001",
    );
    expect(first!.status).toBe(200);
    const original = (await first!.json()) as Credentials;

    const second = await route(
      "/api/agent/claims",
      { claimCode },
      "chat-two-key-0002",
    );
    expect(second!.status).toBe(409);
    expect(await second!.json()).toMatchObject({
      ok: false,
      error: { code: "CLAIM_ALREADY_REDEEMED" },
    });
    const status = (token: string) =>
      routeAgentSessionRequest(
        new Request(
          `https://editor.example/api/agent/sessions/${sessionId}/status`,
          { headers: { authorization: `Bearer ${token}` } },
        ),
        env,
      );
    // The refused chat displaced nobody.
    expect((await status(original.agentToken))!.status).toBe(200);

    const retry = await route(
      "/api/agent/claims",
      { claimCode },
      "chat-one-key-0001",
    );
    expect(retry!.status).toBe(200);
    const replacement = (await retry!.json()) as Credentials;
    expect(replacement.agentToken).not.toBe(original.agentToken);

    const replacedBearer = await status(original.agentToken);
    expect(replacedBearer!.status).toBe(409);
    expect(await replacedBearer!.json()).toMatchObject({
      error: { code: "SESSION_TAKEN_OVER" },
    });
    const replacedConnector = await route("/api/agent/connectors/resume", {
      sessionId,
      connectorToken: original.connectorToken,
    });
    expect(replacedConnector!.status).toBe(409);
    expect(await replacedConnector!.json()).toMatchObject({
      error: { code: "SESSION_TAKEN_OVER" },
    });
    expect((await status(replacement.agentToken))!.status).toBe(200);
  });

  it("tells the editor which adapter release paired on each claim and resume (#1844)", async () => {
    const { env, sockets, storages } = routedFixture();
    const route = (path: string, body: unknown, version?: string) =>
      routeAgentSessionRequest(
        new Request(`https://editor.example${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(version ? { "x-agent-adapter-version": version } : {}),
          },
          body: JSON.stringify(body),
        }),
        env,
      );
    const created = (await (await route("/api/agent/sessions", {
      projectSessionId: "project:adapter",
      projectId: "project",
      documentIds: ["document-main"],
      scopes: ["circuit.snapshot"],
    }))!.json()) as { session: { sessionId: string; claimCode: string } };
    const id = created.session.sessionId;
    const events: unknown[] = [];
    sockets.set(id, [
      {
        readyState: WebSocket.OPEN,
        send: (text: string) => events.push(JSON.parse(text).payload),
      } as unknown as WebSocket,
    ]);
    const adapterEvents = () =>
      events.filter(
        (event) => (event as { type: string }).type === "agent.adapter",
      );
    const claim = (await (await route(
      "/api/agent/claims",
      { claimCode: created.session.claimCode },
      "0.17.83",
    ))!.json()) as { connectorToken: string };
    expect(adapterEvents()).toEqual([
      { type: "agent.adapter", sessionId: id, version: "0.17.83" },
    ]);
    expect(storages.get(id)!.values.get("agent-adapter-version")).toBe(
      "0.17.83",
    );
    // An adapter naming no release, or a malformed one, is shown as unknown.
    const resumed = await route(
      "/api/agent/connectors/resume",
      { sessionId: id, connectorToken: claim.connectorToken },
      "latest",
    );
    expect(resumed!.status).toBe(200);
    expect(adapterEvents()).toEqual([
      { type: "agent.adapter", sessionId: id, version: "0.17.83" },
      { type: "agent.adapter", sessionId: id },
    ]);
    expect(storages.get(id)!.values.get("agent-adapter-version")).toBeNull();
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

  it("retains only a bounded replacement reason across relay restart", async () => {
    const storage = new MemoryStorage();
    const object = new AgentSessionDO({ storage }, {});
    const created = (await (
      await object.fetch(
        new Request("https://agent-session.internal/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: "replaced",
            projectSessionId: "project:1",
            projectId: "project",
            documentIds: ["document-main"],
            scopes: ["circuit.snapshot"],
          }),
        }),
      )
    ).json()) as { session: { editorSecret: string } };
    const response = await object.fetch(
      new Request("https://agent-session.internal/control", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-editor-secret": created.session.editorSecret,
        },
        body: JSON.stringify({ action: "replace-project" }),
      }),
    );
    expect(response.status).toBe(200);
    await object.webSocketClose();
    expect([...storage.values.keys()]).toEqual(["project-replaced-until"]);
    const restarted = new AgentSessionDO({ storage }, {});
    for (const path of ["status", "resume-connector", "editor"]) {
      const result = await restarted.fetch(
        new Request(`https://agent-session.internal/${path}`),
      );
      expect(result.status).toBe(409);
      expect(await result.json()).toMatchObject({
        error: { code: "PROJECT_REPLACED" },
      });
    }
    const deadline = storage.alarm!;
    const now = vi.spyOn(Date, "now").mockReturnValue(deadline + 1);
    try {
      await restarted.alarm();
      expect(storage.values.size).toBe(0);
    } finally {
      now.mockRestore();
    }
  });

  it("renews on presence only with the editor attached, and on Keep connected", async () => {
    let sockets: WebSocket[] = [];
    const object = new AgentSessionDO(
      { storage: new MemoryStorage(), getWebSockets: () => sockets },
      {},
    );
    const created = (await (
      await object.fetch(
        new Request("https://agent-session.internal/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: "present",
            projectSessionId: "project:1",
            projectId: "project",
            documentIds: ["document-main"],
            scopes: ["circuit.snapshot"],
          }),
        }),
      )
    ).json()) as { session: { editorSecret: string } };
    const control = async (action: string) =>
      (await (
        await object.fetch(
          new Request("https://agent-session.internal/control", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-editor-secret": created.session.editorSecret,
            },
            body: JSON.stringify({ action }),
          }),
        )
      ).json()) as { renewed: boolean; expiresAt: string };
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start + 20 * 60_000);
    try {
      // A tab no longer attached is not a person present.
      expect(await control("presence")).toMatchObject({ renewed: false });
      const send = vi.fn();
      sockets = [{ readyState: WebSocket.OPEN, send } as unknown as WebSocket];
      expect(await control("presence")).toEqual({
        ok: true,
        renewed: true,
        status: "active",
        expiresAt: new Date(start + 50 * 60_000).toISOString(),
      });
      // The editor hears the new deadline, as after any renewal.
      expect(String(send.mock.calls.at(-1)?.[0])).toContain("session.renewed");
      // Keep connected is the person's own choice, attached or not.
      sockets = [];
      clock.mockReturnValue(start + 45 * 60_000);
      expect(await control("keep-alive")).toMatchObject({
        renewed: true,
        expiresAt: new Date(start + 75 * 60_000).toISOString(),
      });
    } finally {
      clock.mockRestore();
    }
  });

  it("acknowledges the editor close handshake so the browser can reconnect", async () => {
    const close = vi.fn();
    const socket = {
      readyState: WebSocket.CLOSING,
      close,
    } as unknown as WebSocket;
    const object = new AgentSessionDO(
      { storage: new MemoryStorage(), getWebSockets: () => [] },
      {},
    );
    await object.webSocketClose(socket);
    expect(close).toHaveBeenCalledOnce();
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

  it("fails a request owned by the replaced editor socket without waiting for its timeout", async () => {
    const { env, objects, sockets } = routedFixture();
    const createdResponse = await routeAgentSessionRequest(
      new Request("https://editor.example/api/agent/sessions", {
        method: "POST",
        headers: {
          origin: "https://editor.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectSessionId: "project:replacement",
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
    const claim = (await claimResponse!.json()) as { agentToken: string };
    let forwarded!: () => void;
    const wasForwarded = new Promise<void>((resolve) => {
      forwarded = resolve;
    });
    const oldSocket = {
      readyState: WebSocket.OPEN,
      send: () => forwarded(),
      close: vi.fn(),
    } as unknown as WebSocket;
    sockets.set(created.session.sessionId, [oldSocket]);
    const responsePromise = routeAgentSessionRequest(
      new Request(
        `https://editor.example/api/agent/sessions/${created.session.sessionId}/circuit`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${claim.agentToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiVersion: "3.0",
            requestId: "request-on-old-socket",
            operation: "snapshot",
            documentId: "document-main",
          }),
        },
      ),
      env,
    );
    await wasForwarded;
    const replacement = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as unknown as WebSocket;
    sockets.set(created.session.sessionId, [oldSocket, replacement]);

    await objects.get(created.session.sessionId)!.webSocketClose(oldSocket);

    const response = await responsePromise;
    expect(response?.status).toBe(503);
    expect(await response!.json()).toMatchObject({
      error: { code: "EDITOR_DISCONNECTED" },
    });
    for (const name of [
      "server",
      "restore",
      "pre-forward",
      "forward",
      "post-forward",
    ])
      expect(
        Number(response!.headers.get(`x-agent-${name}-ms`)),
      ).toBeGreaterThanOrEqual(0);
    expect(response!.headers.has("x-agent-forward-ms")).toBe(true);
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
      { send, readyState: WebSocket.OPEN } as unknown as WebSocket,
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
    const before = await storage.get<{ expiresAt: number }>(SESSION_STATE_KEY);
    const heartbeat = {
      protocolVersion: "1.0",
      sessionId: "session-heartbeat",
      kind: "heartbeat",
      nonce: "context-2",
      contextRevision: "gallery",
      projectId: "no-active-project",
      documentIds: [],
    };
    await object.webSocketMessage(
      { send, readyState: WebSocket.OPEN } as unknown as WebSocket,
      JSON.stringify(heartbeat),
    );
    expect(await storage.get(SESSION_STATE_KEY)).toMatchObject({
      contextRevision: "gallery",
      documentIds: [],
      expiresAt: before!.expiresAt,
    });
    // A closing transport cannot resurrect its old Project roster.
    await object.webSocketMessage(
      { send, readyState: WebSocket.CLOSED } as unknown as WebSocket,
      JSON.stringify({
        ...heartbeat,
        contextRevision: "old",
        documentIds: ["old-cell"],
      }),
    );
    expect(await storage.get(SESSION_STATE_KEY)).toMatchObject({
      contextRevision: "gallery",
      documentIds: [],
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
      const before = await storage.get(SESSION_STATE_KEY);
      const keepalive = reader.read();
      await vi.advanceTimersByTimeAsync(AGENT_SSE_KEEPALIVE_INTERVAL_MS);
      expect(decoder.decode((await keepalive).value)).toBe(": keepalive\n\n");
      expect(await storage.get(SESSION_STATE_KEY)).toEqual(before);
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
            apiVersion: "3.0",
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
    const browser = editorEnd(
      editorFor("project", "document-main", {
        scopes: ["circuit.snapshot", "circuit.edit.geometry"],
      }),
      () => objects.get(created.session.sessionId)!,
    );
    sockets.set(created.session.sessionId, [browser.socket]);

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
            apiVersion: "3.0",
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
    expect(browser.families).toHaveLength(0);

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
            apiVersion: "3.0",
            requestId: "snapshot-1",
            operation: "snapshot",
            documentId: "document-main",
          }),
        },
      ),
      env,
    );
    expect(snapshot?.status).toBe(200);
    expect(await snapshot!.json()).toMatchObject({
      ok: true,
      revision: 0,
      snapshot: { document: { id: "document-main" } },
    });
    expect(browser.families).toEqual(["circuit"]);
    const phase = (name: string) => {
      expect(snapshot!.headers.has(`x-agent-${name}-ms`)).toBe(true);
      return Number(snapshot!.headers.get(`x-agent-${name}-ms`));
    };
    expect(
      Math.abs(
        phase("server") -
          phase("pre-forward") -
          phase("forward") -
          phase("post-forward"),
      ),
    ).toBeLessThanOrEqual(2);
    expect(phase("restore")).toBeLessThanOrEqual(phase("pre-forward"));
    // Exact replay is a cache hit, not a second editor dispatch; its timings
    // describe this request, never the first request's editor measurements.
    const cached = await routeAgentSessionRequest(
      new Request(
        `https://editor.example/api/agent/sessions/${created.session.sessionId}/circuit`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${claim.agentToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            apiVersion: "3.0",
            requestId: "snapshot-1",
            operation: "snapshot",
            documentId: "document-main",
          }),
        },
      ),
      env,
    );
    expect(cached!.headers.get("x-agent-cache")).toBe("hit");
    expect(cached!.headers.get("x-agent-forward-ms")).toBe("0");
    expect(cached!.headers.has("x-agent-editor-ms")).toBe(false);
    expect(browser.families).toEqual(["circuit"]);
    // Where the time went, beside an unchanged body (#1227).
    expect(snapshot!.headers.get("x-agent-editor-ms")).toBe("42");
    expect(snapshot!.headers.get("x-agent-editor-visibility")).toBe("hidden");
    expect(
      Number(snapshot!.headers.get("x-agent-relay-ms")),
    ).toBeGreaterThanOrEqual(0);
    // Any process holding the token reads the session's recent requests.
    const activity = await routeAgentSessionRequest(
      new Request(
        `https://editor.example/api/agent/sessions/${created.session.sessionId}/activity`,
        { headers: { authorization: `Bearer ${claim.agentToken}` } },
      ),
      env,
    );
    expect(activity?.status).toBe(200);
    expect(await activity!.json()).toMatchObject({
      ok: true,
      operations: [
        {
          requestId: "snapshot-1",
          resource: "circuit",
          operation: "snapshot",
          ok: true,
          revision: 0,
          editorVisibility: "hidden",
        },
        { requestId: "snapshot-1", cache: "hit", forwardMs: 0 },
      ],
    });
    const anonymous = await routeAgentSessionRequest(
      new Request(
        `https://editor.example/api/agent/sessions/${created.session.sessionId}/activity`,
      ),
      env,
    );
    expect(anonymous?.status).toBe(401);
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
            apiVersion: "3.0",
            requestId: "edit-1",
            operation: "transact",
            documentId: "document-main",
            transactionId: "tx-1",
            expectedRevision: 0,
            edits: [{ kind: "noop" }],
          }),
        },
      ),
      env,
    );
    expect(geometryEdit?.status).toBe(200);
    expect(await geometryEdit!.json()).toMatchObject({ ok: true });
    expect(browser.families).toHaveLength(2);

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
            apiVersion: "3.0",
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
    expect(browser.families).toHaveLength(2);

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
            apiVersion: "3.0",
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
    expect(browser.families).toHaveLength(2);
  });
});

describe("Agent idle expiry", () => {
  const idleMs = 30 * 60_000;
  async function fixture() {
    const storage = new MemoryStorage();
    const created = AgentSessionMachine.create({
      sessionId: "idle-session",
      projectSessionId: "project:1",
      projectId: "project",
      documentIds: ["doc"],
      scopes: [
        "circuit.snapshot",
        "project.download",
        "project.import",
        "simulation.run",
      ],
      now: Date.now(),
      random: () => crypto.randomUUID(),
    });
    const claimed = created.machine.redeemClaim(
      created.session.claimCode,
      Date.now(),
    );
    if (!claimed.ok) throw new Error("fixture claim failed");
    await storage.put(SESSION_STATE_KEY, created.machine.serialize());
    const messages: Array<{
      kind: string;
      payload?: { type?: string; expiresAt?: string };
    }> = [];
    let object: AgentSessionDO;
    const browser = editorEnd(
      editorFor("project", "doc", {
        scopes: [
          "circuit.snapshot",
          "project.download",
          "project.import",
          "simulation.run",
        ],
        simulationService: new HostedSimulationService().fetch,
      }),
      () => object,
      (envelope) => messages.push(envelope),
    );
    const socket = browser.socket;
    const makeObject = () =>
      new AgentSessionDO({ storage, getWebSockets: () => [socket] }, {});
    object = makeObject();
    const post = (
      path: string,
      body: unknown,
      token = claimed.claim.agentToken,
    ) =>
      object.fetch(
        new Request(`https://internal/${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        }),
      );
    const heartbeat = () =>
      object.webSocketMessage(
        socket,
        JSON.stringify({
          protocolVersion: "1.0",
          sessionId: "idle-session",
          kind: "heartbeat",
          nonce: "ping",
          projectId: "project",
          documentIds: ["doc"],
        }),
      );
    const edit = () =>
      object.webSocketMessage(
        socket,
        JSON.stringify({
          protocolVersion: "1.0",
          sessionId: "idle-session",
          messageId: "human-edit",
          requestId: "human-edit",
          sentAt: new Date().toISOString(),
          kind: "event",
          payload: {
            type: "document.revision-changed",
            sessionId: "idle-session",
            documentId: "doc",
            revision: 1,
            actorKind: "human",
            changedObjectIds: ["R1"],
          },
        }),
      );
    return {
      storage,
      messages,
      post,
      heartbeat,
      edit,
      claim: claimed.claim,
      alarm: () => object.alarm(),
      restore: () => {
        object = makeObject();
      },
    };
  }

  it.each([
    ["circuit", { operation: "snapshot", documentId: "doc" }],
    ["files", { operation: "download", artifact: "project" }],
    [
      "simulation",
      {
        operation: "prepare",
        source: {
          kind: "project-folder",
          folderId: "folder",
          expectedStructureRevision: 0,
        },
      },
    ],
    ["projects", { operation: "read-project-code" }],
  ])(
    "renews admitted %s operations, persists and reschedules the deadline",
    async (path, request) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const start = Date.now();
        const f = await fixture();
        vi.setSystemTime(start + idleMs - 1);
        const result = await f.post(path, {
          apiVersion: "3.0",
          requestId: "work",
          ...request,
        });
        expect(result.status).toBe(200);
        const deadline = Date.now() + idleMs;
        expect(await f.storage.get(SESSION_STATE_KEY)).toMatchObject({
          expiresAt: deadline,
        });
        expect(f.storage.alarm).toBe(deadline - 60_000);
        expect(f.messages).toContainEqual(
          expect.objectContaining({
            payload: {
              type: "session.renewed",
              sessionId: "idle-session",
              expiresAt: new Date(deadline).toISOString(),
            },
          }),
        );
        f.restore();
        vi.setSystemTime(start + idleMs + 1);
        await f.heartbeat();
        await f.alarm(); // A stale alarm must not expire or warn about the old deadline.
        expect(f.storage.alarm).toBe(deadline - 60_000);
        expect(
          f.messages.some(
            (message) => message.payload?.type === "session.expiring",
          ),
        ).toBe(false);
        vi.setSystemTime(deadline - 60_000);
        await f.alarm();
        expect(f.storage.alarm).toBe(deadline);
        vi.setSystemTime(deadline);
        await f.alarm();
        expect(f.storage.values.size).toBe(0);
        expect(f.messages.at(-1)?.payload?.type).toBe("session.expired");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("counts manual edits but ignores heartbeats, probes, credential refresh and invalid requests", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const start = Date.now();
      const f = await fixture();
      vi.setSystemTime(start + 20 * 60_000);
      await f.heartbeat();
      await f.post("circuit", {
        apiVersion: "3.0",
        requestId: "probe",
        operation: "capabilities",
      });
      await f.post("resume-connector", {
        connectorToken: f.claim.connectorToken,
      });
      await f.post(
        "circuit",
        {
          apiVersion: "3.0",
          requestId: "unauthorized",
          operation: "snapshot",
          documentId: "doc",
        },
        "wrong-token",
      );
      expect(await f.storage.get(SESSION_STATE_KEY)).toMatchObject({
        expiresAt: start + idleMs,
      });
      await f.edit();
      const deadline = Date.now() + idleMs;
      expect(await f.storage.get(SESSION_STATE_KEY)).toMatchObject({
        expiresAt: deadline,
      });
      vi.setSystemTime(deadline);
      await f.heartbeat();
      await f.edit(); // A late trusted browser message cannot resurrect a session.
      expect(
        await (
          await f.post("resume-connector", {
            connectorToken: f.claim.connectorToken,
          })
        ).json(),
      ).toMatchObject({ error: { code: "SESSION_EXPIRED" } });
      expect(f.storage.values.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Agent request ledger", () => {
  /** A claimed session whose editor answers every Circuit request. */
  async function session(onForward: () => void = () => {}) {
    const storage = new MemoryStorage();
    const created = AgentSessionMachine.create({
      sessionId: "ledger-session",
      projectSessionId: "project:1",
      projectId: "project",
      documentIds: ["doc"],
      scopes: ["circuit.snapshot", "circuit.edit.geometry"],
      limits: { rateLimit: { windowMs: 60_000, maxRequests: 1_000 } },
      now: Date.now(),
      random: () => crypto.randomUUID(),
    });
    const claimed = created.machine.redeemClaim(
      created.session.claimCode,
      Date.now(),
    );
    if (!claimed.ok) throw new Error("fixture claim failed");
    await storage.put(SESSION_STATE_KEY, created.machine.serialize());
    let object: AgentSessionDO;
    const browser = editorEnd(
      editorFor("project", "doc", {
        scopes: ["circuit.snapshot", "circuit.edit.geometry"],
      }),
      () => object,
      (envelope) => {
        if (envelope.kind === "circuit-request") onForward();
      },
    );
    const socket = browser.socket;
    /** A fresh object on the same storage, as after eviction or a deploy. */
    const open = () => {
      object = new AgentSessionDO(
        { storage, getWebSockets: () => [socket] },
        {},
      );
    };
    open();
    const edit = (requestId: string, transactionId = requestId) =>
      object.fetch(
        new Request("https://internal/circuit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${claimed.claim.agentToken}`,
          },
          body: JSON.stringify({
            apiVersion: "3.0",
            requestId,
            operation: "transact",
            documentId: "doc",
            transactionId,
            expectedRevision: 0,
            edits: [{ kind: "noop" }],
          }),
        }),
      );
    return { storage, open, edit, forwarded: () => browser.families.length };
  }

  it.each([-60_000, 60_000])(
    "keeps elapsed relay timings stable when the wall clock jumps by %d ms",
    async (jump) => {
      let wall = Date.now();
      let elapsed = 100;
      const s = await session(() => {
        wall += jump;
        elapsed += 50;
      });
      const wallClock = vi.spyOn(Date, "now").mockImplementation(() => wall);
      const elapsedClock = vi
        .spyOn(performance, "now")
        .mockImplementation(() => elapsed);
      try {
        const response = await s.edit("clock-jump");
        expect(response.status).toBe(200);
        expect(response.headers.get("x-agent-relay-ms")).toBe("50");
        expect(response.headers.get("x-agent-forward-ms")).toBe("50");
        expect(response.headers.get("x-agent-server-ms")).toBe("50");
        expect(s.forwarded()).toBe(1);
      } finally {
        wallClock.mockRestore();
        elapsedClock.mockRestore();
      }
    },
  );

  it("stores each completed write once under its own key and keeps the session state small", async () => {
    const s = await session();
    const stateBytes = () =>
      JSON.stringify(s.storage.values.get(SESSION_STATE_KEY)).length;
    const put = vi.spyOn(s.storage, "put");
    expect((await s.edit("write-0")).status).toBe(200);
    const afterFirst = stateBytes();
    for (let index = 1; index < 200; index += 1)
      expect((await s.edit(`write-${index}`)).status).toBe(200);
    expect(s.forwarded()).toBe(200);

    const ledgerKeys = [...s.storage.values.keys()].filter((key) =>
      key.startsWith(REQUEST_LEDGER_KEY_PREFIX),
    );
    expect(ledgerKeys).toHaveLength(200);
    // Each written once.
    const ledgerPuts = put.mock.calls
      .map(([key]) => key)
      .filter((key) => key.startsWith(REQUEST_LEDGER_KEY_PREFIX));
    expect(ledgerPuts).toHaveLength(200);
    expect(new Set(ledgerPuts).size).toBe(200);
    expect(s.storage.values.get(requestLedgerKey("write-7"))).toEqual({
      payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
    });
    // Before, each completed write added its record to this one value.
    expect(s.storage.values.get(SESSION_STATE_KEY)).toMatchObject({
      requestLedger: [],
    });
    expect(stateBytes()).toBeLessThan(2 * afterFirst);

    s.open();
    const retry = await s.edit("write-7");
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({
      error: { code: "REQUEST_RESULT_UNAVAILABLE" },
    });
    expect(
      await (await s.edit("write-7", "another-transaction")).json(),
    ).toMatchObject({ error: { code: "REQUEST_ID_REUSED" } });
    expect(s.forwarded()).toBe(200);
  });

  it("moves completed writes out of a session state saved before, on restore", async () => {
    const s = await session();
    expect((await s.edit("before-deploy")).status).toBe(200);
    const key = requestLedgerKey("before-deploy");
    const record = s.storage.values.get(key) as object;
    const state = s.storage.values.get(
      SESSION_STATE_KEY,
    ) as PersistedAgentSessionState;
    // As the relay saved a live session before: the record inside the state.
    s.storage.values.delete(key);
    s.storage.values.set(SESSION_STATE_KEY, {
      ...state,
      requestLedger: [["before-deploy", { ...record, replayMode: "write" }]],
    });

    s.open();
    const retry = await s.edit("before-deploy");
    expect(await retry.json()).toMatchObject({
      error: { code: "REQUEST_RESULT_UNAVAILABLE" },
    });
    expect(s.storage.values.get(key)).toEqual(record);
    expect(s.storage.values.get(SESSION_STATE_KEY)).toMatchObject({
      requestLedger: [],
    });
    expect(s.forwarded()).toBe(1);
  });
});
