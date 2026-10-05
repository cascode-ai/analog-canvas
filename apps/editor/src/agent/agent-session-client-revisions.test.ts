import { describe, expect, it, vi } from "vitest";
import type { AgentSessionStatusResponse } from "@icm/agent-adapter";
import {
  createEmptyDocument,
  createEmptyProject,
  createSimulationFolder,
  type CircuitProject,
} from "@icm/model";
import { AgentSessionError } from "../../../../packages/agent-client/src/errors";
import {
  emptyAgentProject,
  liveAgentEditor,
  personEdits,
} from "./live-agent-editor.test-support";

const place = (symbol: string, reference: string, x: number) => ({
  kind: "place-component",
  symbol,
  reference,
  position: { x, y: 100 },
});

const translate = (instanceId: string) => ({
  kind: "transform",
  selection: { instanceIds: [instanceId] },
  transform: { kind: "translate", delta: { x: 20, y: 0 } },
});

/** The relay's observation of the session, as its status endpoint reports it. */
const observation = (
  project: CircuitProject,
  editor: "attached" | "detached" = "attached",
): AgentSessionStatusResponse => ({
  ok: true,
  sessionId: "session-1",
  projectId: project.id,
  documentIds: project.documents.map((item) => item.id),
  authorization: "active",
  editor,
  observedAt: 1000,
  expiresAt: Number.MAX_SAFE_INTEGER,
});

/** The live editor, paired, with R1 placed by the Agent's own call. */
async function editorWithR1() {
  const editor = liveAgentEditor();
  await editor.client.connect("session-1.code");
  const placed = await editor.client.applyActions([
    place("resistor", "R1", 100),
  ]);
  expect(placed.ok, placed.message).toBe(true);
  const id = editor.controller.document.instances.find(
    (item) => item.reference === "R1",
  )!.id;
  const position = () =>
    editor.controller.document.instances.find((item) => item.id === id)
      ?.placement?.position;
  return { ...editor, id, position };
}

describe("the Agent client's receipts and revisions against the live editor", () => {
  it("uses the commit receipt without a redundant post-commit snapshot", async () => {
    const { client, http, controller } = liveAgentEditor();
    await client.connect("session-1.code");
    expect(
      (
        await client.applyActions([
          place("resistor", "R1", 100),
          place("resistor", "R2", 300),
        ])
      ).ok,
    ).toBe(true);
    const revision = controller.document.revision;
    const calls = http.circuitCalls.length;
    const report = await client.applyActions([
      {
        kind: "set-reference",
        target: { kind: "instance", reference: "R1" },
        reference: "R5",
      },
      {
        kind: "move",
        target: { kind: "instance", reference: "R2" },
        position: { x: 320, y: 240 },
      },
    ]);
    expect(report).toMatchObject({
      ok: true,
      stage: "done",
      transactions: 1,
      revision: controller.document.revision,
    });
    expect(controller.document.revision).toBe(revision + 1);
    // One relayed request: the commit validates the list atomically, so no
    // client-side dry run precedes it.
    expect(
      http.circuitCalls.slice(calls).map(({ request }) => request),
    ).toEqual([
      expect.objectContaining({
        operation: "transact",
        dryRun: false,
        expectedRevision: revision,
      }),
    ]);
    const r5 = controller.document.instances.find(
      (item) => item.reference === "R5",
    )!;
    const r2 = controller.document.instances.find(
      (item) => item.reference === "R2",
    )!;
    expect(r2.placement?.position).toEqual({ x: 320, y: 240 });
    expect(report.changedObjectIds).toEqual(
      expect.arrayContaining([r5.id, r2.id]),
    );
    // Only the connection's read: the editor plans the list, and the
    // receipt stands without reading the Document again.
    expect(
      http.circuitCalls.filter(
        ({ request }) => request.operation === "snapshot",
      ),
    ).toHaveLength(1);
    expect(client.recentTransactions()).toHaveLength(2);
    expect(client.recentTransactions().at(-1)).toEqual(report);
    // The receipt carries the findings the editor now holds.
    const state = await client.documentState(undefined, {
      refresh: true,
      diagnostics: "items",
    });
    expect(report.diagnostics).toEqual(state.diagnostics);
    expect(report).toMatchObject({
      errors: state.counts.errors,
      warnings: state.counts.warnings,
    });
  });

  it("uses the explicitly selected document for refresh and commit", async () => {
    const project = emptyAgentProject();
    project.documents.push(createEmptyDocument("child", "Child"));
    const { client, http, controller } = liveAgentEditor({ project });
    await client.connect("session-1.code");
    const calls = http.circuitCalls.length;
    for (const action of [
      place("resistor", "R1", 100),
      {
        kind: "move",
        target: { kind: "instance", reference: "R1" },
        position: { x: 340, y: 240 },
      },
    ]) {
      const report = await client.applyActions([action], {
        documentId: "child",
      });
      expect(report.ok, report.message).toBe(true);
    }
    const cell = (id: string) =>
      controller.project.documents.find((item) => item.id === id)!;
    expect(
      cell("child").instances.map((item) => [
        item.reference,
        item.placement?.position,
      ]),
    ).toEqual([["R1", { x: 340, y: 240 }]]);
    expect(cell("main").instances).toEqual([]);
    // The child's revision is read, then each commit goes to the child.
    expect(
      http.circuitCalls
        .slice(calls)
        .map(({ request }) =>
          request.operation === "capabilities"
            ? [request.operation]
            : [request.operation, request.documentId],
        ),
    ).toEqual([
      ["snapshot", "child"],
      ["transact", "child"],
      ["transact", "child"],
    ]);
  });

  it("keeps the pairing but marks the editor offline when the relay reports EDITOR_OFFLINE", async () => {
    const { client, http, controller } = liveAgentEditor();
    const real = http.circuitHandler;
    let detached = true;
    // The editor answers capabilities, then its tab detaches before the
    // Document is read.
    http.circuitHandler = async (call) => {
      if (detached && call.request.operation !== "capabilities")
        throw new AgentSessionError(
          "EDITOR_OFFLINE",
          "editor detached",
          "editor-offline",
          503,
        );
      return real(call);
    };
    vi.spyOn(http, "status").mockImplementation(async () =>
      observation(controller.project, detached ? "detached" : "attached"),
    );
    const report = await client.connect("session-1.code");
    expect(report.mode).toBe("claimed");
    expect(report.context).toBeNull();
    expect(client.connection.snapshot.state).toBe("editor-offline");
    // The active pairing survives: once the editor is back, connect()
    // resumes it without another claim.
    detached = false;
    expect(await client.connect()).toMatchObject({
      mode: "resumed",
      context: { revision: controller.document.revision },
    });
    expect(http.claims).toHaveLength(1);
    expect(client.connection.snapshot.state).toBe("online");
  });

  it("commits a valid advanced transaction and refreshes the revision", async () => {
    const { client, http, controller, id, position } = await editorWithR1();
    await client.snapshot();
    const report = await client.advancedTransact([
      { kind: "move_instance", instanceId: id, position: { x: 200, y: 300 } },
    ]);
    expect(report).toMatchObject({
      ok: true,
      revision: controller.document.revision,
    });
    expect(position()).toEqual({ x: 200, y: 300 });
    // The cached Snapshot takes the new revision and is read again before use.
    expect(client.summary("main")?.revision).toBe(controller.document.revision);
    expect(client.cachedSnapshot()?.dirty).toBe(true);
    const calls = http.circuitCalls.length;
    const fresh = await client.snapshot();
    expect(http.circuitCalls.length).toBe(calls + 1);
    expect(
      fresh.snapshot.document.instances.find((item) => item.id === id)
        ?.placement?.position,
    ).toEqual({ x: 200, y: 300 });
  });

  it("counts the pins not wired yet among a receipt's errors (#1301)", async () => {
    const { client, controller } = liveAgentEditor();
    await client.connect("session-1.code");
    // A current-controlled source with neither pin wired nor a sensor chosen.
    const placed = await client.applyActions([place("cccs", "F1", 100)]);
    expect(placed).toMatchObject({
      ok: true,
      errors: 3,
      unwiredPins: 2,
      warnings: 2,
    });
    const f1 = controller.document.instances[0]!;
    expect(
      placed.diagnostics
        ?.filter((item) => item.code === "MISSING_PIN_NET")
        .flatMap((item) => item.objectIds),
    ).toEqual([f1.id, f1.id]);
    // Wiring a pin takes it off the count; the missing sensor still stands
    // out among the errors.
    const wired = await client.applyActions([
      {
        kind: "connect",
        from: { kind: "pin", instance: "F1", pin: "-" },
        to: { kind: "point", x: 100, y: 300 },
      },
    ]);
    expect(wired).toMatchObject({ ok: true, errors: 2, unwiredPins: 1 });
    expect(wired.diagnostics?.map((item) => item.code)).toContain(
      "MISSING_CONTROL_SENSOR",
    );
  });

  it("leaves the open Cell's findings out of a receipt that changed only the Project's structure", async () => {
    const { client } = await editorWithR1();
    const created = await client.applyActions([
      { kind: "create-cell", id: "document-new", name: "fresh" },
    ]);
    expect(created).toMatchObject({
      ok: true,
      editKinds: ["project:add_document"],
      changedObjectIds: ["document-new"],
    });
    expect(created).not.toHaveProperty("errors");
    expect(created).not.toHaveProperty("diagnostics");
    // The open Cell still holds them: R1's pins are not wired.
    expect(
      (await client.documentState(undefined, { refresh: true })).counts.errors,
    ).toBeGreaterThan(0);

    // A Project transaction that edits the Cell, as placing a Cell Pin
    // does, keeps the Cell's findings.
    const pinned = await client.applyActions([place("port", "VIN", 300)]);
    expect(pinned).toMatchObject({
      ok: true,
      editKinds: ["project:transact_document"],
      unwiredPins: 2,
    });
    const state = await client.documentState(undefined, { refresh: true });
    expect(pinned.errors).toBe(state.counts.errors);
  });

  it("reuses bootstrap and transaction revisions for consecutive direct edits without a full snapshot", async () => {
    const { client, http, controller, id, position } = await editorWithR1();
    // Each direct edit is checked against the revision the client sends.
    expect(await client.applyActions([translate(id)])).toMatchObject({
      ok: true,
      revision: controller.document.revision,
    });
    expect(await client.applyActions([translate(id)])).toMatchObject({
      ok: true,
      revision: controller.document.revision,
    });
    expect(position()).toEqual({ x: 140, y: 100 });
    expect(
      await client.advancedTransact([
        { kind: "move_instance", instanceId: id, position: { x: 200, y: 300 } },
      ]),
    ).toMatchObject({ ok: true, revision: controller.document.revision });
    expect(position()).toEqual({ x: 200, y: 300 });
    const requests = http.circuitCalls.map(({ request }) => request);
    expect(
      requests.filter((request) => request.operation === "snapshot"),
    ).toEqual([expect.objectContaining({ projection: "bootstrap" })]);
    expect(
      requests.flatMap((request) =>
        request.operation === "transact" ? [request.expectedRevision] : [],
      ),
    ).toEqual([0, 1, 2, 3]);
  });

  it("refreshes a revision after an uncertain commit instead of reusing the pre-write cache", async () => {
    const { client, http, controller, id, position } = await editorWithR1();
    const real = http.circuitHandler;
    let uncertain = true;
    const delivered = new Set<string>();
    // The editor commits the edit, but every answer to it is lost on the way
    // back; a repeated request ID is never run twice.
    http.circuitHandler = async (call) => {
      if (!uncertain || call.request.operation !== "transact")
        return real(call);
      if (!delivered.has(call.request.requestId)) {
        delivered.add(call.request.requestId);
        await real(call);
      }
      throw new AgentSessionError("NETWORK_FAILURE", "receipt lost", "network");
    };
    const before = http.circuitCalls.length;
    await expect(client.applyActions([translate(id)])).rejects.toMatchObject({
      code: "NETWORK_FAILURE",
    });
    // One exact retry; the editor moved R1 once.
    const attempts = http.circuitCalls
      .slice(before)
      .map(({ payload }) => payload);
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts).size).toBe(1);
    expect(position()).toEqual({ x: 120, y: 100 });
    const committed = controller.document.revision;

    uncertain = false;
    const calls = http.circuitCalls.length;
    expect(await client.applyActions([translate(id)])).toMatchObject({
      ok: true,
      revision: controller.document.revision,
    });
    expect(position()).toEqual({ x: 140, y: 100 });
    // The revision is read again, not reused from before the uncertain write.
    expect(
      http.circuitCalls.slice(calls).map(({ request }) => request),
    ).toEqual([
      expect.objectContaining({
        operation: "snapshot",
        projection: "bootstrap",
      }),
      expect.objectContaining({
        operation: "transact",
        expectedRevision: committed,
      }),
    ]);
  });

  it("does not reuse a revision across browser contexts", async () => {
    const { client, http, controller, id, position } = await editorWithR1();
    // The relay reports a new browser context, where a person moved R1.
    http.contextRevision = "new-browser-context";
    personEdits(controller, [
      { kind: "move_instance", instanceId: id, position: { x: 300, y: 300 } },
    ]);
    const revision = controller.document.revision;
    const calls = http.circuitCalls.length;
    const report = await client.advancedTransact([
      { kind: "move_instance", instanceId: id, position: { x: 500, y: 300 } },
    ]);
    expect(report).toMatchObject({
      ok: true,
      revision: controller.document.revision,
    });
    expect(position()).toEqual({ x: 500, y: 300 });
    expect(
      http.circuitCalls.slice(calls).map(({ request }) => request),
    ).toEqual([
      expect.objectContaining({
        operation: "snapshot",
        projection: "bootstrap",
      }),
      expect.objectContaining({
        operation: "transact",
        expectedRevision: revision,
      }),
    ]);
  });

  it("refreshes an implicit Snapshot after a Project switch without claiming again", async () => {
    const { client, http } = liveAgentEditor();
    await client.connect("session-1.code");
    // A person opens another Project: the relay now reaches the editor
    // holding it and reports the new browser context.
    const next = liveAgentEditor({
      project: createEmptyProject("project-2", "Next", "next-document"),
    });
    http.circuitHandler = next.http.circuitHandler;
    vi.spyOn(http, "status").mockImplementation(async () => {
      http.contextRevision = "project-2-context";
      return observation(next.controller.project);
    });
    const entry = await client.refreshSnapshot();
    expect(entry).toMatchObject({
      documentId: "next-document",
      revision: next.controller.document.revision,
    });
    expect(entry.snapshot.project).toMatchObject({
      id: "project-2",
      name: "Next",
    });
    expect(http.claims).toHaveLength(1);
    await expect(client.refreshSnapshot("main")).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
    });
  });

  it("reads selected pins once and invalidates stale cached topology", async () => {
    const { client, http, controller, id } = await editorWithR1();
    await client.snapshot();
    // A person moves R1 after the Agent's read.
    personEdits(controller, [
      { kind: "move_instance", instanceId: id, position: { x: 300, y: 300 } },
    ]);
    const calls = http.circuitCalls.length;
    const pins = await client.pinsSnapshot([id, "absent"]);
    expect(http.circuitCalls.length - calls).toBe(1);
    expect(pins).toMatchObject({
      projection: "pins",
      revision: controller.document.revision,
      instances: [{ id, placement: { position: { x: 300, y: 300 } } }],
      missingInstanceIds: ["absent"],
    });
    expect(pins.instances[0]?.pins.map((pin) => pin.name)).toEqual(["1", "2"]);
    expect(client.cachedSnapshot()?.dirty).toBe(true);
  });

  it("invalidates an older full Snapshot when focused geometry observes a newer revision", async () => {
    const { client, http, controller, id } = await editorWithR1();
    await client.snapshot();
    personEdits(controller, [
      { kind: "move_instance", instanceId: id, position: { x: 300, y: 300 } },
    ]);
    const geometry = await client.geometrySnapshot([id]);
    expect(geometry).toMatchObject({
      revision: controller.document.revision,
      objects: [
        { kind: "instance", id, placement: { position: { x: 300, y: 300 } } },
      ],
    });
    expect(client.cachedSnapshot()?.dirty).toBe(true);
    expect((await client.snapshot()).revision).toBe(
      controller.document.revision,
    );
    expect(
      http.circuitCalls.flatMap(({ request }) =>
        request.operation === "snapshot" ? [request.projection ?? "full"] : [],
      ),
    ).toEqual(["bootstrap", "full", "geometry", "full"]);
  });

  it("does not silently rebase a source helper after a concurrent Project edit", async () => {
    const project = emptyAgentProject();
    project.simulationFolders.push(
      createSimulationFolder({
        id: "folder-1",
        name: "Bias",
        profileId: "test",
        documentId: "main",
      }),
    );
    const { client, http, controller } = liveAgentEditor({ project });
    await client.connect("session-1.code");
    // A source helper reads the folders, then a person renames one.
    const authored = (await client.simulationFolderDirectory())
      .structureRevision;
    const folder = structuredClone(controller.project.simulationFolders[0]!);
    folder.name = "Bias point";
    expect(
      controller.dispatchProjectTransaction({
        transactionId: "person-rename",
        projectId: controller.project.id,
        expectedStructureRevision: authored,
        actor: { kind: "human", id: "human-local" },
        edits: [{ kind: "upsert_simulation_folder", folder }],
      }).ok,
    ).toBe(true);
    const remove = () =>
      client.advancedTransact(
        {
          structureEdits: [
            { kind: "remove_simulation_folder", folderId: "folder-1" },
          ],
        },
        { expectedStructureRevision: authored },
      );
    // The helper's revision goes as it is, and the editor refuses it.
    let calls = http.circuitCalls.length;
    expect(await remove()).toMatchObject({ ok: false, code: "STATE_CHANGED" });
    expect(
      http.circuitCalls.slice(calls).map(({ request }) => request),
    ).toEqual([
      expect.objectContaining({
        operation: "transact",
        expectedStructureRevision: authored,
      }),
      expect.objectContaining({ operation: "snapshot" }),
    ]);
    // Knowing the newer structure now, the client refuses before sending.
    calls = http.circuitCalls.length;
    expect(await remove()).toMatchObject({ ok: false, code: "STATE_CHANGED" });
    expect(
      http.circuitCalls
        .slice(calls)
        .some(({ request }) => request.operation === "transact"),
    ).toBe(false);
    expect(
      controller.project.simulationFolders.map((item) => item.name),
    ).toEqual(["Bias point"]);
    expect(client.connection.snapshot.state).toBe("online");
  });
});
