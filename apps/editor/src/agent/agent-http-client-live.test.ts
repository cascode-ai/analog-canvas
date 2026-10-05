import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseAgentProjectResourceRequest,
  type AgentCircuitRequest,
  type AgentCircuitResponse,
  type AgentTransactRequest,
} from "@icm/agent-adapter";
import type { Annotation, RichTextDocument } from "@icm/model";
import { ConnectorStore } from "../../../../packages/agent-client/src/connector-store";
import { AgentHttpClient } from "../../../../packages/agent-client/src/http-client";
import { AgentSessionClient } from "../../../../packages/agent-client/src/session-client";
import { FakeAgentHttp } from "../../../../packages/agent-client/src/test-support/fake-relay";
import { WorkspaceBindingStore } from "../../../../packages/agent-client/src/workspace-binding-store";
import type { BrowserAgentProjectHostOptions } from "./browser-agent-project-host";
import {
  ALL_AGENT_SCOPES,
  emptyAgentProject,
  liveAgentEditor,
  personEdits,
} from "./live-agent-editor.test-support";
import { listWorkspaceProjects, workspaceResponses } from "./workspace-copy";

const BASE = "https://relay.test";
const TOKEN = "token-0123456789abcdef0123456789abcdef";

type LiveEditor = ReturnType<typeof liveAgentEditor>;
type TransactForm = Partial<
  Pick<AgentTransactRequest, "actions" | "command" | "edits">
>;

const snapshotRequest = {
  apiVersion: "3.0",
  requestId: "snapshot",
  operation: "snapshot",
  documentId: "main",
} satisfies AgentCircuitRequest;

/**
 * The client under test with the relay stubbed out: each Circuit request
 * reaches the live editor and its answer comes back as the JSON body.
 * `breakWith` damages later answers on purpose, for the rejection checks.
 */
function clientOfLiveEditor() {
  const { controller, service } = liveAgentEditor();
  const posted: { url: string; init: RequestInit | undefined }[] = [];
  const answers: AgentCircuitResponse[] = [];
  let damage: ((answer: AgentCircuitResponse) => void) | undefined;
  const http = new AgentHttpClient({
    baseUrl: BASE,
    fetch: async (url, init) => {
      posted.push({ url: String(url), init });
      // A copy, as the wire carries it: damage never reaches the editor.
      const answer: AgentCircuitResponse = JSON.parse(
        JSON.stringify(service.handle(JSON.parse(String(init?.body)))),
      );
      damage?.(answer);
      answers.push(answer);
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  let sequence = 0;
  return {
    controller,
    http,
    posted,
    /** The body the editor's last answer travelled in. */
    lastAnswer: () => answers.at(-1),
    breakWith: (change: (answer: AgentCircuitResponse) => void) => {
      damage = change;
    },
    /** An Agent edit through the client, at the editor's current revisions. */
    agentEdits: async (form: TransactForm) => {
      sequence += 1;
      const response = await http.circuit("session-1", TOKEN, {
        apiVersion: "3.0",
        requestId: `transact-${sequence}`,
        transactionId: `transaction-${sequence}`,
        operation: "transact",
        documentId: controller.document.id,
        expectedRevision: controller.document.revision,
        expectedStructureRevision: controller.project.structureRevision,
        ...form,
      });
      if (!response.ok)
        throw new Error(`editor refused the edit: ${response.error.message}`);
      return response;
    },
  };
}

function snapshotOf(response: AgentCircuitResponse) {
  if (!response.ok || response.operation !== "snapshot")
    throw new Error("Expected a Snapshot");
  if (!("snapshot" in response)) throw new Error("Expected a full Snapshot");
  return response.snapshot;
}

/** "Vin" with its suffix drawn in one case: the same name in a new look. */
function casedPortName(style: "lowercase" | "uppercase"): RichTextDocument {
  return {
    runs: [
      { kind: "text", value: "V" },
      {
        kind: "span",
        style: "subscript",
        children: [
          { kind: "span", style, children: [{ kind: "text", value: "in" }] },
        ],
      },
    ],
  };
}

describe("the Agent HTTP client reading the live editor", () => {
  it("accepts Port case styles and locates errors within the matching Snapshot branch", async () => {
    const live = clientOfLiveEditor();
    await live.agentEdits({
      actions: [
        {
          kind: "place-component",
          symbol: "port",
          reference: "Vin",
          direction: "input",
          position: { x: 100, y: 200 },
        },
      ],
    });
    const isPortLabel = (annotation: Pick<Annotation, "binding">) =>
      annotation.binding?.kind === "cell-terminal-name";
    const portLabel = (response: AgentCircuitResponse) =>
      snapshotOf(response).document.annotations.find(isPortLabel)!;
    const labelId = live.controller.document.annotations.find(isPortLabel)!.id;
    // The Port's name keeps its characters; its suffix case changes twice.
    for (const style of ["lowercase", "uppercase"] as const) {
      await live.agentEdits({
        command: {
          kind: "set-text",
          target: { kind: "annotation", id: labelId },
          text: casedPortName(style),
        },
      });
      const response = await live.http.circuit(
        "session-1",
        TOKEN,
        snapshotRequest,
      );
      expect(response).toEqual(live.lastAnswer());
      expect(portLabel(response)).toMatchObject({
        resolvedText: "Vin",
        formatOverride: casedPortName(style),
      });
    }
    live.breakWith((answer) =>
      Object.assign(portLabel(answer), { rotation: "private-invalid-value" }),
    );
    await expect(
      live.http.circuit("session-1", TOKEN, snapshotRequest),
    ).rejects.toThrow(/snapshot.document.annotations.*rotation/);
    await expect(
      live.http.circuit("session-1", TOKEN, snapshotRequest),
    ).rejects.not.toThrow("private-invalid-value");
  });

  it("reads hidden schema-54 parameter bindings without relaxing unknown-field checks", async () => {
    const live = clientOfLiveEditor();
    await live.agentEdits({
      actions: [
        {
          kind: "place-component",
          symbol: "xfmr",
          position: { x: 300, y: 200 },
        },
      ],
    });
    const instanceIds = live.controller.document.instances.map(
      (item) => item.id,
    );
    // The transformer's coupling display is shown, then hidden again.
    for (const k of [true, false])
      await live.agentEdits({
        command: {
          kind: "set-instance-display",
          instanceIds,
          showParameters: { k },
        },
      });
    const coupling = (response: AgentCircuitResponse) =>
      snapshotOf(response).document.annotations.find(
        (annotation) =>
          annotation.binding?.kind === "instance-value" &&
          annotation.binding.parameter === "k",
      )!;
    const response = await live.http.circuit(
      "session-1",
      TOKEN,
      snapshotRequest,
    );
    expect(response).toEqual(live.lastAnswer());
    expect(coupling(response)).toMatchObject({
      kind: "instance-value",
      visible: false,
      binding: { instanceId: instanceIds[0], parameter: "k" },
    });
    live.breakWith((answer) =>
      Object.assign(coupling(answer).binding!, { unsupported: true }),
    );
    await expect(
      live.http.circuit("session-1", TOKEN, snapshotRequest),
    ).rejects.toThrow("schema validation");
  });

  it("accepts a schema-57 annotation-owned Cell terminal", async () => {
    const live = clientOfLiveEditor();
    // A local VDD rail: its label, not a Pin symbol, owns the Cell's VDD terminal.
    await live.agentEdits({
      command: {
        kind: "add-power-rail",
        start: { x: 100, y: 80 },
        end: { x: 300, y: 80 },
      },
    });
    const response = await live.http.circuit(
      "session-1",
      TOKEN,
      snapshotRequest,
    );
    expect(response).toEqual(live.lastAnswer());
    const { cellInterface, annotations } = snapshotOf(response).document;
    const [terminal] = cellInterface?.terminals ?? [];
    expect(terminal).toMatchObject({
      name: "VDD",
      interfaceInstanceIds: [],
      interfaceAnnotationId: expect.any(String),
    });
    expect(
      annotations.find((item) => item.id === terminal!.interfaceAnnotationId),
    ).toMatchObject({
      kind: "power-label",
      netId: terminal!.netId,
      binding: { kind: "cell-terminal-name", terminalId: terminal!.id },
    });
  });

  it("posts four-operation requests with the bearer token and parses responses", async () => {
    const live = clientOfLiveEditor();
    const requests: AgentCircuitRequest[] = [
      { apiVersion: "3.0", requestId: "req-1", operation: "capabilities" },
      { ...snapshotRequest, requestId: "req-2" },
      {
        apiVersion: "3.0",
        requestId: "req-3",
        operation: "transact",
        documentId: "main",
        transactionId: "transaction-1",
        expectedRevision: 0,
        actions: [
          {
            kind: "place-component",
            symbol: "resistor",
            reference: "R1",
            position: { x: 100, y: 100 },
          },
        ],
      },
      {
        apiVersion: "3.0",
        requestId: "req-4",
        operation: "render",
        documentId: "main",
        mode: "formal",
      },
    ];
    for (const request of requests) {
      const response = await live.http.circuit("session-1", "tok", request);
      expect(response).toMatchObject({
        ok: true,
        operation: request.operation,
        requestId: request.requestId,
      });
      expect(response).toEqual(live.lastAnswer());
    }
    for (const { url, init } of live.posted) {
      expect(url).toBe(`${BASE}/api/agent/sessions/session-1/circuit`);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer tok",
      );
    }
    expect(live.posted).toHaveLength(4);
    // The transact reached the editor itself.
    expect(
      live.controller.document.instances.map((item) => item.reference),
    ).toEqual(["R1"]);
  });

  it("explains incompatible circuit responses without replaying mutations", async () => {
    const { service } = liveAgentEditor();
    const request = {
      apiVersion: "3.0",
      requestId: "c",
      operation: "capabilities",
    } satisfies AgentCircuitRequest;
    let calls = 0;
    const client = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async () => {
        calls++;
        // The editor's real answer, carrying a field this client predates.
        return new Response(
          JSON.stringify({
            ...service.handle(request),
            futureField: "private-value",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    await expect(client.circuit("s", "token", request)).rejects.toThrow(
      /MCP manifest.*may already have committed/,
    );
    expect(calls).toBe(1);
  });

  it("records each hop the relay reports, and only the requests after a mark", async () => {
    const { service } = liveAgentEditor();
    const body = JSON.stringify(service.handle(snapshotRequest));
    let call = 0;
    const http = new AgentHttpClient({
      baseUrl: BASE,
      fetch: async () => {
        call += 1;
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/json",
            ...(call === 2
              ? {
                  "x-agent-relay-ms": "830",
                  "x-agent-editor-ms": "120",
                  "x-agent-editor-visibility": "hidden",
                  "x-agent-server-ms": "910",
                  "x-agent-restore-ms": "10",
                  "x-agent-pre-forward-ms": "80",
                  "x-agent-forward-ms": "800",
                  "x-agent-post-forward-ms": "30",
                  "x-agent-cache": "hit",
                }
              : {}),
          },
        });
      },
    });
    await http.circuit("s", "t", snapshotRequest);
    const mark = http.timingMark();
    await http.circuit("s", "t", snapshotRequest);
    const [timing, ...rest] = http.timingsSince(mark);
    expect(rest).toEqual([]);
    expect(timing).toMatchObject({
      request: "circuit",
      resource: "circuit",
      requestId: snapshotRequest.requestId,
      operation: "snapshot",
      attempt: 1,
      status: 200,
      outcome: "ok",
      serverMs: 910,
      restoreMs: 10,
      preForwardMs: 80,
      forwardMs: 800,
      postForwardMs: 30,
      cache: "hit",
      relayMs: 830,
      editorMs: 120,
      editorVisibility: "hidden",
    });
    expect(timing!.totalMs).toBeGreaterThanOrEqual(0);
    expect(timing!.startedAtMs).toBeGreaterThan(0);
    // A response without the relay's headers records the round trip alone.
    expect(http.requestTimings[0]).not.toHaveProperty("relayMs");
  });

  it("counts header wait separately from body transfer and validation, without logging payloads", async () => {
    const { service } = liveAgentEditor();
    let clock = 100;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const http = new AgentHttpClient({
        baseUrl: BASE,
        fetch: async () => {
          clock += 40;
          const response = Response.json(service.handle(snapshotRequest));
          const json = response.json.bind(response);
          response.json = async () => {
            clock += 70;
            return json();
          };
          return response;
        },
      });
      await http.circuit("s", TOKEN, snapshotRequest);
      expect(http.requestTimings[0]).toMatchObject({
        headerMs: 40,
        bodyMs: 70,
        totalMs: 110,
        requestId: snapshotRequest.requestId,
        outcome: "ok",
      });
      expect(JSON.stringify(http.requestTimings)).not.toContain(TOKEN);
      expect(http.requestTimings[0]).not.toHaveProperty("body");
      for (let i = 0; i < 70; i++)
        await http.circuit("s", TOKEN, {
          ...snapshotRequest,
          requestId: `read-${i}`,
        });
      expect(http.requestTimings).toHaveLength(64);
      expect(http.requestTimings[0]!.requestId).toBe("read-6");
    } finally {
      now.mockRestore();
    }
  });

});

/**
 * The editor's answer to which Projects are open: the editor shell serves
 * the workspace list from its tabs with these same two helpers.
 */
function openTabList(
  tabs: ReadonlyMap<string, LiveEditor>,
  activeId: string,
): NonNullable<BrowserAgentProjectHostOptions["workspace"]> {
  return async ({ requestId, request }) => {
    const { fail, success } = workspaceResponses(requestId);
    if (request.action !== "list")
      return fail("WORKSPACE_OPERATION_FAILED", "Only listing is served here");
    return success({
      action: "list",
      activeWorkspaceId: activeId,
      projects: listWorkspaceProjects(
        [...tabs].map(([id, tab]) => ({
          id,
          session: {
            controller: tab.controller,
            file: { cloudBinding: null },
            dirty: false,
          },
        })),
      ),
    });
  };
}

/**
 * The relay one fresh client process talks to. Pairing and the Session
 * status are the relay's own; Circuit and Project requests reach the open
 * tab the client targets, the active one when it names none.
 */
function tabRelay(tabs: ReadonlyMap<string, LiveEditor>, activeId: string) {
  const served: string[] = [];
  const tab = (workspaceId: string | undefined) => {
    const id = workspaceId ?? activeId;
    const target = tabs.get(id);
    if (!target) throw new Error(`No open tab ${id}`);
    return { id, ...target };
  };
  const pairing = () => {
    const { project } = tab(undefined).controller;
    return {
      sessionId: "session-1",
      agentToken: TOKEN,
      tokenExpiresAt: Number.MAX_SAFE_INTEGER,
      connectorToken: "connector-0123456789abcdef0123456789abcdef",
      connectorExpiresAt: Number.MAX_SAFE_INTEGER,
      scopes: [...ALL_AGENT_SCOPES],
      projectId: project.id,
      documentIds: project.documents.map((item) => item.id),
    };
  };
  const http: FakeAgentHttp = new FakeAgentHttp({
    claim: pairing,
    circuit: async ({ request }) => {
      const target = tab(http.workspaceId);
      served.push(target.id);
      return target.service.handle(request);
    },
    projects: async (request) => {
      const parsed = parseAgentProjectResourceRequest(request);
      if (!parsed.success) throw new Error("Project request off contract");
      return tab(http.workspaceId).projectHost.handle(parsed.data);
    },
  });
  vi.spyOn(http, "status").mockImplementation(async (sessionId) => {
    const { projectId, documentIds } = pairing();
    return {
      ok: true,
      sessionId,
      projectId,
      documentIds,
      authorization: "active",
      editor: "attached",
      observedAt: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
    };
  });
  return { http, served };
}

describe("task workspace binding against the live editor's open tabs", () => {
  it("restores across fresh clients, isolates tasks, and refuses a closed or replaced target without reading a foreground document", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analog-binding-"));
    try {
      const connectorStore = new ConnectorStore(
        join(directory, "connector.json"),
      );
      const binding = new WorkspaceBindingStore(join(directory, "task-b.json"));
      // Tab A in front; tab B behind it, where a person placed R1.
      const tabs = new Map<string, LiveEditor>();
      const workspace = openTabList(tabs, "tab-a");
      const projectB = emptyAgentProject("B");
      projectB.id = "project-b";
      tabs.set(
        "tab-a",
        liveAgentEditor({
          project: emptyAgentProject("A"),
          projectHost: { workspace },
        }),
      );
      tabs.set(
        "tab-b",
        liveAgentEditor({ project: projectB, projectHost: { workspace } }),
      );
      const front = tabs.get("tab-a")!.controller;
      const behind = tabs.get("tab-b")!.controller;
      personEdits(behind, [
        {
          kind: "add_instance",
          instance: {
            id: "instance-r1",
            symbolId: "resistor",
            reference: "R1",
            placement: {
              position: { x: 200, y: 200 },
              rotation: 0,
              mirror: "none",
            },
          },
        },
      ]);
      const create = (workspaceBindingStore = binding) => {
        const relay = tabRelay(tabs, "tab-a");
        return {
          ...relay,
          client: new AgentSessionClient({
            http: relay.http,
            connectorStore,
            workspaceBindingStore,
          }),
        };
      };
      const first = create();
      await first.client.connect("session-1.code");
      await first.client.bindWorkspace("tab-b");
      expect(await binding.load()).toMatchObject({
        workspaceId: "tab-b",
        projectId: "project-b",
      });
      expect(await readFile(binding.path, "utf8")).not.toMatch(
        /token|revision|documentIds/i,
      );

      const second = create();
      const snapshot = await second.client.snapshot();
      expect(snapshot.snapshot.project.id).toBe("project-b");
      expect(
        await second.client.advancedTransact({
          edits: [
            {
              kind: "set_instance_reference",
              instanceId: "instance-r1",
              reference: "R2",
            },
          ],
        }),
      ).toMatchObject({
        ok: true,
        workspaceId: "tab-b",
        projectId: "project-b",
      });
      // Tab B took the edit; the tab in front was never read or changed.
      expect(behind.document.instances.map((item) => item.reference)).toEqual([
        "R2",
      ]);
      expect(second.served).toEqual(["tab-b", "tab-b"]);
      expect(front.document.revision).toBe(0);
      expect(second.http.projectCalls).toHaveLength(1);
      const separate = create(
        new WorkspaceBindingStore(join(directory, "task-a.json")),
      );
      expect((await separate.client.snapshot()).snapshot.project.id).toBe(
        front.project.id,
      );
      expect(separate.client.workspaceId).toBeNull();
      expect(separate.http.projectCalls).toHaveLength(0);

      // A person opens another Project in tab B.
      const other = emptyAgentProject("Other");
      other.id = "project-other";
      behind.replaceProject(other);
      const replaced = create();
      await expect(replaced.client.snapshot()).rejects.toMatchObject({
        code: "WORKSPACE_NOT_FOUND",
      });
      await expect(replaced.client.snapshot()).rejects.toMatchObject({
        code: "WORKSPACE_NOT_FOUND",
      });
      expect(replaced.http.circuitCalls).toHaveLength(0);
      // Then closes tab B.
      tabs.delete("tab-b");
      const missing = create();
      await expect(missing.client.snapshot()).rejects.toMatchObject({
        code: "WORKSPACE_NOT_FOUND",
      });
      expect(missing.http.circuitCalls).toHaveLength(0);
      await missing.client.bindWorkspace(null);
      await missing.client.snapshot();
      expect(missing.client.workspaceId).toBeNull();
      expect(missing.served).toEqual(["tab-a"]);
      expect(await binding.load()).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps corrupt and stale target records fail-closed until explicitly cleared; new Claims reset targets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analog-binding-"));
    try {
      const connectorStore = new ConnectorStore(
        join(directory, "connector.json"),
      );
      const workspaceBindingStore = new WorkspaceBindingStore(
        join(directory, "target.json"),
      );
      const { http } = liveAgentEditor();
      await new AgentSessionClient({ http, connectorStore }).connect(
        "session-1.code",
      );
      await workspaceBindingStore.save({
        version: 1,
        apiBaseUrl: http.baseUrl,
        sessionId: "another-session",
        workspaceId: "tab-b",
        projectId: "project-b",
      });
      const restarted = new AgentSessionClient({
        http,
        connectorStore,
        workspaceBindingStore,
      });
      await expect(restarted.snapshot()).rejects.toMatchObject({
        code: "WORKSPACE_BINDING_STALE",
      });
      await writeFile(workspaceBindingStore.path, "broken");
      await expect(restarted.snapshot()).rejects.toThrow(
        "saved workspace binding",
      );
      await restarted.connect("session-1.new-claim");
      expect(await workspaceBindingStore.load()).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not advertise durable CLI binding without a task directory", async () => {
    const { client, http } = liveAgentEditor({
      client: { requireDurableWorkspaceBinding: true },
    });
    await expect(client.bindWorkspace("tab-b")).rejects.toMatchObject({
      code: "WORKSPACE_TASK_REQUIRED",
    });
    expect(http.projectCalls).toEqual([]);
  });
});
