import { describe, expect, it, vi } from "vitest";
import mcpDistribution from "../config/agent-mcp-distribution.json";
import {
  REQUEST_LEDGER_KEY_PREFIX,
  SESSION_STATE_KEY,
  fileOperationScopes,
  projectOperationScopes,
  requestLedgerKey,
  simulationOperationScopes,
} from "./agent-session-runtime";

import {
  AGENT_SSE_KEEPALIVE_INTERVAL_MS,
  AGENT_MCP_BOOTSTRAP_FORMAT,
  AgentFileResourceRequestSchema,
  AgentProjectResourceRequestSchema,
  AgentSessionMachine,
  AgentSimulationResourceRequestSchema,
  type AgentMcpBootstrapManifest,
  type AgentSessionLimits,
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

it("uses existing Project write authorization for Project-owned simulation source only", () => {
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
  ).toEqual(["simulation.run"]);
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
  ).toEqual(["simulation.run", "project.import"]);
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
  const scopes = (operation: Record<string, unknown>) =>
    projectOperationScopes(
      AgentProjectResourceRequestSchema.parse({
        apiVersion: "3.0",
        requestId: "projects",
        ...operation,
      }),
    );
  expect(scopes({ operation: "list-gallery" })).toEqual(["circuit.snapshot"]);
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
  it("redeems a valid claim again by replacing the prior bearer", () => {
    const { machine, session, now } = folder();
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

type LiveEditor = ReturnType<typeof liveAgentEditor>;

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
    expect(manifest.installation.command).toContain(
      '--install --origin "https://editor.example" --host codex',
    );
    expect(manifest.hosts.codex.command).toContain("https://editor.example");
    expect(manifest.launch.env.ANALOG_CANVAS_API_URL).toBe(
      "https://editor.example",
    );
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
