import { describe, expect, it, vi } from "vitest";
import { base64EncodeBytes } from "@icm/agent-adapter";
import { sha256Hex } from "@icm/derived";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { AgentSessionError } from "../../../../packages/agent-client/src/errors";
import {
  ALL_AGENT_SCOPES,
  emptyAgentProject,
  liveAgentEditor,
  personEdits,
} from "./live-agent-editor.test-support";
import { listWorkspaceProjects, workspaceResponses } from "./workspace-copy";

const place = (symbol: string, reference: string, x: number) => ({
  kind: "place-component",
  symbol,
  reference,
  position: { x, y: 100 },
});

/** The relay refused the request before the editor saw it. */
const offline = () =>
  new AgentSessionError("EDITOR_OFFLINE", "offline", "editor-offline", 503);

/** The editor took the request, but its reply never came back. */
const lostReply = () =>
  new AgentSessionError(
    "EDITOR_DISCONNECTED",
    "response lost",
    "editor-offline",
    503,
  );

type LiveRelay = ReturnType<typeof liveAgentEditor>["http"];

/** The editor handles the next File request; its reply is lost. */
function loseNextFileReply(http: LiveRelay) {
  const handle = http.files.bind(http);
  vi.spyOn(http, "files").mockImplementationOnce(async (...call) => {
    await handle(...call);
    throw lostReply();
  });
}

/** The editor handles the next Project request; its reply is lost. */
function loseNextProjectReply(http: LiveRelay) {
  const handle = http.projects.bind(http);
  vi.spyOn(http, "projects").mockImplementationOnce(async (...call) => {
    await handle(...call);
    throw lostReply();
  });
}

/** A Project with one empty Cell, `cellId`. */
function projectWithCell(id: string, name: string, cellId: string) {
  const project = emptyAgentProject(name);
  project.id = id;
  project.documents[0]!.id = cellId;
  project.topDocumentId = cellId;
  return project;
}

describe("the Agent client's requests against the live editor", () => {
  it("submits explicit-ID wiring in one atomic request without downloading a Snapshot", async () => {
    const { client, http, controller } = liveAgentEditor();
    await client.connect("session-1.code");
    expect(
      (
        await client.applyActions([
          place("nmos", "M1", 100),
          place("resistor", "R1", 300),
        ])
      ).ok,
    ).toBe(true);
    const id = (reference: string) =>
      controller.document.instances.find(
        (item) => item.reference === reference,
      )!.id;
    const gate = {
      kind: "pin",
      instance: { kind: "instance", id: id("M1") },
      pin: "G",
    };
    const actions = [
      {
        kind: "connect",
        from: gate,
        to: {
          kind: "pin",
          instance: { kind: "instance", id: id("R1") },
          pin: "1",
        },
      },
      { kind: "connect", from: gate, to: { kind: "point", x: 220, y: 200 } },
    ];
    const revision = controller.document.revision;
    const before = http.circuitCalls.length;
    const report = await client.applyActions(actions);
    expect(report, report.message).toMatchObject({
      ok: true,
      revision: revision + 1,
    });
    // One request: the editor plans the list as it was sent.
    expect(http.circuitCalls.slice(before).map((call) => call.request)).toEqual(
      [expect.objectContaining({ operation: "transact", actions })],
    );
    expect(controller.document.revision).toBe(revision + 1);
    // M1's gate joins R1's pin 1, and its second wire ends at the point.
    const gateNet = controller.document.nets.find((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === id("M1") && terminal.pinName === "G",
      ),
    )!;
    expect(gateNet.terminals).toContainEqual({
      instanceId: id("R1"),
      pinName: "1",
    });
    expect(controller.document.junctions).toContainEqual(
      expect.objectContaining({
        netId: gateNet.id,
        position: { x: 220, y: 200 },
      }),
    );
  });

  it("binds one open working copy without changing the browser's active Project", async () => {
    const background = liveAgentEditor({
      project: projectWithCell("project-b", "Agent", "cell-b"),
    });
    let tabs: Parameters<typeof listWorkspaceProjects>[0] = [];
    const active = liveAgentEditor({
      project: projectWithCell("project-a", "Human", "main"),
      projectHost: {
        // The browser lists its open working copies, as the editor shell does.
        workspace: async (envelope) =>
          workspaceResponses(envelope.requestId).success({
            action: "list",
            activeWorkspaceId: "tab-a",
            projects: listWorkspaceProjects(tabs),
          }),
      },
    });
    tabs = [
      {
        id: "tab-a",
        session: {
          controller: active.controller,
          file: { cloudBinding: null },
          dirty: false,
        },
      },
      {
        id: "tab-b",
        session: {
          controller: background.controller,
          file: { cloudBinding: null },
          dirty: false,
        },
      },
    ];
    const { client, http } = active;
    // A request bound to a working copy is answered by that copy's editor.
    const activeEditor = http.circuitHandler;
    http.circuitHandler = (call) =>
      http.workspaceId === "tab-b"
        ? background.http.circuitHandler(call)
        : activeEditor(call);
    await client.connect("session-1.code");
    expect(await client.bindWorkspace("tab-b")).toEqual({
      workspaceId: "tab-b",
      projectId: "project-b",
      name: "Agent",
    });
    expect(http.workspaceId).toBe("tab-b");
    expect((await client.status()).documentIds).toEqual(["cell-b"]);
    expect((await client.snapshot()).documentId).toBe("cell-b");
    // The Agent's edit lands in the bound copy; the active one is untouched.
    expect((await client.applyActions([place("resistor", "R1", 100)])).ok).toBe(
      true,
    );
    expect(
      background.controller.document.instances.map((item) => item.reference),
    ).toEqual(["R1"]);
    expect(active.controller.document.instances).toEqual([]);
    // Binding only listed the working copies; it never activated one.
    expect(
      http.projectCalls.map((call) =>
        call.operation === "workspace" ? call.request.action : call.operation,
      ),
    ).toEqual(["list"]);
    await expect(client.bindWorkspace("missing")).rejects.toMatchObject({
      code: "WORKSPACE_NOT_FOUND",
    });
    expect(client.workspaceId).toBe("tab-b");
  });

  it.each([false, true])(
    "invalidates Project snapshots after file updates, uncertain=%s",
    async (uncertain) => {
      const project = emptyAgentProject();
      project.simulationFolders.push(
        createSimulationFolder({
          id: "folder",
          name: "Bias",
          profileId: "test",
        }),
      );
      const { client, http, controller } = liveAgentEditor({ project });
      await client.connect("session-1.code");
      await client.snapshot("main");
      expect(client.cachedSnapshot("main")).not.toBeNull();
      if (uncertain) loseNextFileReply(http);
      const owner = { kind: "project-folder" as const, folderId: "folder" };
      const update = client.fileResource({
        apiVersion: "3.0",
        requestId: "update-source",
        operation: "simulation-input",
        input: {
          action: "update",
          owner,
          expectedRevision: controller.project.structureRevision,
          writes: [{ path: "run.cir", text: "new" }],
          removes: [],
          patches: [],
          circuitEdits: [],
        },
      });
      if (uncertain)
        await expect(update).rejects.toMatchObject({
          code: "EDITOR_DISCONNECTED",
        });
      else
        expect(await update).toMatchObject({ ok: true, result: { ok: true } });
      // The editor saved the file either way.
      expect(
        controller.project.simulationFolders[0]!.input.files.find(
          (file) => file.path === "run.cir",
        )?.text,
      ).toBe("new");
      expect(client.cachedSnapshot("main")).toBeNull();
      const before = http.circuitCalls.length;
      expect(
        (await client.snapshot("main")).snapshot.project.structureRevision,
      ).toBe(controller.project.structureRevision);
      expect(http.circuitCalls.length).toBe(before + 1);
      // Listing the folder changes nothing, so the cache stays.
      expect(
        await client.fileResource({
          apiVersion: "3.0",
          requestId: "list",
          operation: "simulation-input",
          input: { action: "list", owner },
        }),
      ).toMatchObject({ ok: true, result: { ok: true } });
      expect(client.cachedSnapshot("main")).not.toBeNull();
    },
  );

  it.each([false, true])(
    "invalidates cached circuit state after staged Cell import, uncertain=%s",
    async (uncertain) => {
      const { client, http, controller } = liveAgentEditor();
      await client.connect("session-1.code");
      await client.snapshot("main");
      // A Project file holding one resistor, staged as an import candidate.
      const source = createEmptyProject("source", "Source");
      source.documents[0]!.instances.push({
        id: "r",
        reference: "R1",
        symbolId: "resistor",
        placement: null,
        netlist: { parameters: { value: "1k" } },
      });
      const text = serializeProject(source);
      const bytes = new TextEncoder().encode(text);
      const staged = await client.fileResource({
        apiVersion: "3.0",
        requestId: "stage-cell",
        operation: "stage",
        kind: "project",
        files: [
          {
            name: "source.icproj.json",
            mediaType: "application/json",
            encoding: "base64",
            data: base64EncodeBytes(bytes),
            byteLength: bytes.byteLength,
            sha256: sha256Hex(text),
          },
        ],
      });
      if (!staged.ok || staged.operation !== "stage")
        throw new Error(JSON.stringify(staged));
      if (uncertain) loseNextFileReply(http);
      const imported = client.fileResource({
        apiVersion: "3.0",
        requestId: "import",
        operation: "import-cell",
        candidateId: staged.candidate.candidateId,
        sourceDocumentId: source.topDocumentId,
        targetDocumentId: "main",
        mode: "replace-body",
        expectedStructureRevision: controller.project.structureRevision,
        expectedRevision: controller.document.revision,
      });
      if (uncertain)
        await expect(imported).rejects.toMatchObject({
          code: "EDITOR_DISCONNECTED",
        });
      else
        expect(await imported).toMatchObject({
          ok: true,
          targetDocumentId: "main",
        });
      // The editor imported the Cell either way.
      expect(
        controller.document.instances.map((item) => item.reference),
      ).toEqual(["R1"]);
      expect(client.cachedSnapshot("main")).toBeNull();
      expect(
        (await client.snapshot("main")).snapshot.document.instances.map(
          (item) => item.reference,
        ),
      ).toEqual(["R1"]);
    },
  );

  it.each([false, true])(
    "invalidates Project snapshots after code replacement, uncertain=%s",
    async (uncertain) => {
      const { client, http, controller } = liveAgentEditor();
      await client.connect("session-1.code");
      await client.snapshot("main");
      const read = await client.projectResource({
        apiVersion: "3.0",
        requestId: "read-code",
        operation: "read-project-code",
      });
      if (!read.ok || read.operation !== "read-project-code")
        throw new Error(JSON.stringify(read));
      // Reading the code changes nothing, so the cache stays.
      expect(client.cachedSnapshot("main")).not.toBeNull();
      const code = JSON.parse(read.projectCode);
      code.documents[0].name = "Bias";
      if (uncertain) loseNextProjectReply(http);
      const replace = client.projectResource({
        apiVersion: "3.0",
        requestId: "replace-code",
        operation: "replace-project-code",
        expectedStructureRevision: read.structureRevision,
        projectCode: JSON.stringify(code),
      });
      if (uncertain)
        await expect(replace).rejects.toMatchObject({
          code: "EDITOR_DISCONNECTED",
        });
      else expect(await replace).toMatchObject({ ok: true, applied: true });
      // The editor took the new code either way.
      expect(controller.document.name).toBe("Bias");
      expect(client.cachedSnapshot("main")).toBeNull();
      expect((await client.snapshot("main")).snapshot.document.name).toBe(
        "Bias",
      );
    },
  );

  it("does not carry an offline request into a newly paired Project", async () => {
    const other = liveAgentEditor({
      project: projectWithCell("project-2", "Other", "other"),
    });
    let pairAgain = async () => {};
    const { client, http, controller } = liveAgentEditor({
      client: { sleep: () => pairAgain() },
    });
    // The relay sends each session's requests to its own editor.
    const ownEditor = http.circuitHandler;
    http.circuitHandler = (call) =>
      call.sessionId === "session-2"
        ? other.http.circuitHandler(call)
        : ownEditor(call);
    await client.connect("session-1.code");
    const read = await client.projectResource({
      apiVersion: "3.0",
      requestId: "read-code",
      operation: "read-project-code",
    });
    if (!read.ok || read.operation !== "read-project-code")
      throw new Error(JSON.stringify(read));
    const code = JSON.parse(read.projectCode);
    code.documents[0].name = "Renamed";
    // While the request waits out an offline editor, a person pairs the
    // Agent with another Project.
    pairAgain = async () => {
      vi.spyOn(http, "claim").mockResolvedValueOnce({
        sessionId: "session-2",
        agentToken: "token-fedcba9876543210fedcba9876543210",
        tokenExpiresAt: Number.MAX_SAFE_INTEGER,
        connectorToken: "connector-fedcba9876543210fedcba9876543210",
        connectorExpiresAt: Number.MAX_SAFE_INTEGER,
        scopes: [...ALL_AGENT_SCOPES],
        projectId: "project-2",
        documentIds: ["other"],
      });
      await client.connect("session-2.code");
    };
    const projects = vi
      .spyOn(http, "projects")
      .mockRejectedValueOnce(offline());
    const mine = structuredClone(controller.project);
    const theirs = structuredClone(other.controller.project);
    await expect(
      client.projectResource({
        apiVersion: "3.0",
        requestId: "old-request",
        operation: "replace-project-code",
        expectedStructureRevision: read.structureRevision,
        projectCode: JSON.stringify(code),
      }),
    ).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(projects).toHaveBeenCalledTimes(1);
    // Neither Project took the old request.
    expect(controller.project).toEqual(mine);
    expect(other.controller.project).toEqual(theirs);
    expect((await client.status()).projectId).toBe("project-2");
  });

  it.each(["files", "projects"] as const)(
    "%s retries only pre-dispatch offline rejection with the original request identity",
    async (resource) => {
      const sleep = vi.fn(async (_ms: number) => {});
      const { client, http, controller } = liveAgentEditor({
        client: { sleep },
      });
      await client.connect("session-1.code");
      const method = vi.spyOn(http, resource);
      method.mockRejectedValueOnce(offline());
      const envelope = { apiVersion: "3.0" as const, requestId: "stable-id" };
      const call = () =>
        resource === "files"
          ? client.fileResource({
              ...envelope,
              operation: "simulation-input",
              input: { action: "list" },
            })
          : client.projectResource({
              ...envelope,
              operation: "read-project-code",
            });
      // The retry reaches the editor, which answers it.
      expect(await call()).toMatchObject(
        resource === "files"
          ? { ok: true, operation: "simulation-input", result: { ok: true } }
          : {
              ok: true,
              operation: "read-project-code",
              structureRevision: controller.project.structureRevision,
            },
      );
      expect(sleep).toHaveBeenCalledWith(500);
      expect(method).toHaveBeenCalledTimes(2);
      expect(method.mock.calls[0]![2]).toEqual(method.mock.calls[1]![2]);
      // An uncertain failure may follow a write: it is never sent again.
      method.mockClear();
      method.mockRejectedValueOnce(lostReply());
      await expect(call()).rejects.toMatchObject({
        code: "EDITOR_DISCONNECTED",
      });
      expect(method).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["dirty", "other-project"] as const)(
    "does not submit a %s operation snapshot",
    async (reason) => {
      const { client, http, controller } = liveAgentEditor();
      await client.connect("session-1.code");
      expect(
        (await client.applyActions([place("resistor", "R1", 100)])).ok,
      ).toBe(true);
      let snapshot = structuredClone(await client.snapshot());
      if (reason === "dirty") {
        // The Agent's next edit leaves its earlier read stale.
        expect(
          (await client.applyActions([place("resistor", "R2", 300)])).ok,
        ).toBe(true);
        snapshot = client.cachedSnapshot()!;
        expect(snapshot.dirty).toBe(true);
      } else snapshot.snapshot.project.id = "other-project";
      const r1 = controller.document.instances.find(
        (item) => item.reference === "R1",
      )!;
      const document = structuredClone(controller.document);
      const before = http.circuitCalls.length;
      const report = await client.advancedTransact(
        {
          edits: [
            {
              kind: "set_instance_reference",
              instanceId: r1.id,
              reference: "R3",
            },
          ],
        },
        { snapshot },
      );
      expect(report).toMatchObject({
        ok: false,
        code: "STATE_CHANGED",
        revision: document.revision,
      });
      // Only a fresh read went out; the Document is as it was.
      expect(
        http.circuitCalls.slice(before).map((call) => call.request.operation),
      ).toEqual(["snapshot"]);
      expect(controller.document).toEqual(document);
    },
  );

  it("fills a nested Document transaction's revision and names a refused field", async () => {
    const { client, http, controller } = liveAgentEditor();
    await client.connect("session-1.code");
    expect((await client.applyActions([place("resistor", "R1", 100)])).ok).toBe(
      true,
    );
    const r1 = controller.document.instances[0]!;
    const revision = controller.document.revision;
    const nested = (extra: object) => ({
      structureEdits: [
        {
          kind: "transact_document",
          documentId: "main",
          ...extra,
          edits: [
            {
              kind: "set_instance_reference",
              instanceId: r1.id,
              reference: "R2",
            },
          ],
        },
      ],
    });
    const before = http.circuitCalls.length;
    const report = await client.advancedTransact(nested({}));
    expect(report.ok, report.message).toBe(true);
    // The client filled in the Cell's revision; the editor committed it.
    expect(http.circuitCalls.slice(before).map((call) => call.request)).toEqual(
      [
        expect.objectContaining({
          operation: "transact",
          structureEdits: [
            expect.objectContaining({ expectedRevision: revision }),
          ],
        }),
      ],
    );
    expect(controller.document.instances[0]!.reference).toBe("R2");
    expect(controller.document.revision).toBe(revision + 1);
    const sent = http.circuitCalls.length;
    const project = structuredClone(controller.project);
    expect(
      await client.advancedTransact(nested({ expectedRevision: "latest" })),
    ).toMatchObject({
      ok: false,
      code: "EDIT_SCHEMA_INVALID",
      message: expect.stringMatching(
        /^structureEdits\[0\]\.expectedRevision: /u,
      ),
    });
    expect(http.circuitCalls.length).toBe(sent);
    expect(controller.project).toEqual(project);
  });

  it("reuses a composed operation's snapshot and keeps its revision when a person's edit conflicts", async () => {
    const { client, http, controller } = liveAgentEditor();
    await client.connect("session-1.code");
    expect((await client.applyActions([place("resistor", "R1", 100)])).ok).toBe(
      true,
    );
    const snapshot = await client.snapshot();
    const r1 = controller.document.instances[0]!;
    // A person moves R1 after the Agent read it.
    personEdits(controller, [
      {
        kind: "move_instance",
        instanceId: r1.id,
        position: { x: 500, y: 300 },
      },
    ]);
    const before = http.circuitCalls.length;
    const report = await client.advancedTransact(
      {
        edits: [
          {
            kind: "set_instance_reference",
            instanceId: r1.id,
            reference: "R2",
          },
        ],
      },
      { snapshot },
    );
    // No read before the write; the write carried the snapshot's revision.
    expect(http.circuitCalls.slice(before).map((call) => call.request)).toEqual(
      [
        expect.objectContaining({
          operation: "transact",
          expectedRevision: snapshot.revision,
        }),
        expect.objectContaining({ operation: "snapshot" }),
      ],
    );
    expect(report).toMatchObject({
      ok: false,
      stage: "commit",
      code: "STATE_CHANGED",
      revision: controller.document.revision,
    });
    expect(report.changedObjectIds).toContain(r1.id);
    expect(controller.document.instances[0]!.reference).toBe("R1");
  });

  it("probes status and clears a replaced project instead of reporting cached online", async () => {
    const { client, http, controller } = liveAgentEditor();
    await client.connect("session-1.code");
    // A person opens another Project in the paired tab; the relay says so.
    controller.replaceProject(emptyAgentProject("Next"));
    vi.spyOn(http, "status").mockRejectedValue(
      new AgentSessionError(
        "PROJECT_REPLACED",
        "replaced",
        "unrecoverable-credential",
        410,
      ),
    );
    expect(await client.status()).toMatchObject({
      state: "online",
      projectId: "project-1",
      documentIds: ["main"],
    });
    expect(await client.status({ refresh: true })).toMatchObject({
      state: "revoked",
      projectId: null,
      documentIds: [],
    });
  });
});
