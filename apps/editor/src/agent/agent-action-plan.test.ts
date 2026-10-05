import { describe, expect, it } from "vitest";
import { createAgentCircuitService } from "@icm/agent-adapter";
import { createEmptyProject } from "@icm/model";
import { AgentSessionClient } from "../../../../packages/agent-client/src/session-client";
import { FakeAgentHttp } from "../../../../packages/agent-client/src/test-support/fake-relay";
import { EditorDocumentController } from "../document/document-controller";
import { BrowserAgentHost } from "./browser-agent-host";

/** One editor, reached by an Agent client that sends it action lists. */
async function editor() {
  const project = createEmptyProject("project-1", "Action plan");
  project.documents[0]!.id = "main";
  project.topDocumentId = "main";
  const controller = new EditorDocumentController(project);
  const service = createAgentCircuitService({
    agentId: "test",
    host: new BrowserAgentHost(controller),
    permissions: {
      snapshot: true,
      render: true,
      sourceSpans: false,
      semanticControl: false,
      edit: { geometry: true, connectivity: true, presentation: true },
    },
  });
  const http = new FakeAgentHttp();
  http.circuitHandler = async ({ request }) => service.handle(request);
  const client = new AgentSessionClient({ http });
  await client.connect("session-1.code");
  const instance = (reference: string) =>
    controller.document.instances.find((item) => item.reference === reference);
  return { controller, client, http, instance };
}

const place = (
  symbol: string,
  reference: string,
  x: number,
  parameters?: Record<string, string>,
) => ({
  kind: "place-component",
  symbol,
  reference,
  position: { x, y: 100 },
  ...(parameters ? { parameters } : {}),
});
const pin = (instance: string, name: string) => ({
  kind: "pin",
  instance,
  pin: name,
});

describe("the editor plans an Agent's action list", () => {
  it("places, wires, edits, labels, moves, deletes and steps history, the client never reading the Document", async () => {
    const { controller, client, http, instance } = await editor();
    const apply = async (actions: unknown[]) => {
      const report = await client.applyActions(actions);
      expect(report.ok, report.message).toBe(true);
      return report;
    };
    await apply([
      place("resistor", "R1", 100, { value: "1k" }),
      place("resistor", "R2", 300),
      place("nmos", "M1", 500),
    ]);
    expect(instance("R1")?.netlist?.parameters).toMatchObject({ value: "1k" });
    const routes = controller.document.routes.length;
    await apply([
      { kind: "connect", from: pin("R1", "2"), to: pin("R2", "1") },
    ]);
    await apply([
      { kind: "connect", from: pin("R2", "2"), to: pin("M1", "D") },
      { kind: "connect", from: pin("M1", "S"), to: pin("R1", "1") },
    ]);
    expect(controller.document.routes.length).toBeGreaterThan(routes);
    await apply([
      {
        kind: "set-reference",
        target: { kind: "instance", reference: "R1" },
        reference: "R9",
      },
      {
        kind: "set-property",
        target: { kind: "instance", reference: "R2" },
        set: { value: "2k" },
      },
      {
        kind: "rotate",
        target: { kind: "instance", reference: "R2" },
        rotation: 90,
      },
    ]);
    expect(instance("R1")).toBeUndefined();
    expect(instance("R9")).toBeDefined();
    expect(instance("R2")?.netlist?.parameters).toMatchObject({ value: "2k" });
    expect(instance("R2")?.placement?.rotation).toBe(90);
    expect(
      (
        await apply([
          { kind: "add-label", target: pin("R2", "1"), text: "MID" },
        ])
      ).editKinds,
    ).toContain("upsert_schematic_annotation");
    await apply([
      { kind: "annotate", text: "Bias", position: { x: 100, y: 400 } },
    ]);
    // Free text is a drafting object.
    expect(JSON.stringify(controller.document.drafting?.objects)).toContain(
      "Bias",
    );
    await apply([
      {
        kind: "move",
        target: { kind: "instance", reference: "M1" },
        position: { x: 700, y: 100 },
      },
    ]);
    expect(instance("M1")?.placement?.position.x).toBe(700);
    await apply([
      { kind: "delete", target: { kind: "instance", reference: "R9" } },
    ]);
    expect(instance("R9")).toBeUndefined();
    await apply([{ kind: "undo" }]);
    expect(instance("R9")).toBeDefined();
    await apply([{ kind: "redo" }]);
    expect(instance("R9")).toBeUndefined();
    // The editor reads the Document itself: past the first call's revision
    // bootstrap, the client never asks for it.
    expect(
      http.circuitCalls.filter(
        ({ request }) =>
          request.operation === "snapshot" &&
          request.projection !== "bootstrap",
      ),
    ).toEqual([]);
  });

  it("refuses a list in the editor, naming the action it concerns", async () => {
    const { controller, client } = await editor();
    expect(
      (
        await client.applyActions([
          place("resistor", "R1", 100),
          place("resistor", "R2", 300),
        ])
      ).ok,
    ).toBe(true);
    const before = structuredClone(controller.document);
    const refusals: [unknown[], Record<string, unknown>][] = [
      [
        [{ kind: "explode" }],
        {
          stage: "compile",
          code: "ACTION_COMPILE_FAILED",
          actionIndex: 0,
          actionKind: "schema",
        },
      ],
      [
        [
          {
            kind: "set-property",
            target: { kind: "instance", reference: "R404" },
            set: { value: "1k" },
          },
        ],
        {
          stage: "compile",
          code: "ACTION_COMPILE_FAILED",
          actionIndex: 0,
          actionKind: "set-property",
        },
      ],
      [
        [
          place("resistor", "R3", 500),
          {
            kind: "set-property",
            target: { kind: "instance", reference: "R1" },
            set: { value: "3k" },
          },
        ],
        {
          stage: "compile",
          code: "ACTION_BATCH_NOT_ATOMIC",
          transactions: 2,
          calls: [
            { actionIndices: [0], actionKinds: ["place-component"] },
            { actionIndices: [1], actionKinds: ["set-property"] },
          ],
        },
      ],
      [
        // R5 would overlap R4.
        [place("resistor", "R4", 700), place("resistor", "R5", 755)],
        { stage: "commit", actionIndex: 1, actionKind: "place-component" },
      ],
      [
        [{ kind: "focus", intent: { kind: "fit-document" } }],
        { stage: "commit", code: "PERMISSION_DENIED" },
      ],
    ];
    for (const [actions, expected] of refusals) {
      const report = await client.applyActions(actions);
      expect(report).toMatchObject({ ok: false, ...expected });
      if (typeof expected.actionIndex === "number")
        expect(report.message).toMatch(
          new RegExp(`^actions\\[${expected.actionIndex}\\]`),
        );
      expect(controller.document).toEqual(before);
    }
  });

  it("plans on the Document as a person left it, yet refuses a stale undo", async () => {
    const { controller, client } = await editor();
    expect(
      (
        await client.applyActions([
          place("resistor", "R1", 100),
          place("resistor", "R2", 300),
        ])
      ).ok,
    ).toBe(true);
    // A person marks a pin of R2 after the Agent's call.
    const personMarks = (id: string, pinName: string) => {
      const instance = controller.document.instances.find(
        (item) => item.reference === "R2",
      )!;
      expect(
        controller.transact([
          {
            kind: "add_no_connect",
            noConnect: {
              id,
              endpoint: { kind: "terminal", instanceId: instance.id, pinName },
            },
          },
        ]).ok,
      ).toBe(true);
    };
    personMarks("nc-1", "1");
    // A list that names parts is planned on the Document as it stands.
    const changed = await client.applyActions([
      {
        kind: "set-property",
        target: { kind: "instance", reference: "R1" },
        set: { value: "5k" },
      },
    ]);
    expect(changed.ok, changed.message).toBe(true);
    expect(controller.document.noConnects.map((item) => item.id)).toEqual([
      "nc-1",
    ]);
    personMarks("nc-2", "2");
    // An undo goes as it is, against the revision the Agent last saw.
    expect(await client.applyActions([{ kind: "undo" }])).toMatchObject({
      ok: false,
      code: "STATE_CHANGED",
      actionIndex: 0,
      actionKind: "undo",
    });
    expect(controller.document.noConnects).toHaveLength(2);
  });

  it("plans a list on the Document only with Snapshot permission", () => {
    const project = createEmptyProject("project-1", "No Snapshot");
    project.documents[0]!.id = "main";
    project.topDocumentId = "main";
    const controller = new EditorDocumentController(project);
    const session = (snapshot: boolean) =>
      createAgentCircuitService({
        agentId: "test",
        host: new BrowserAgentHost(controller),
        permissions: {
          snapshot,
          render: false,
          sourceSpans: false,
          semanticControl: false,
          edit: { geometry: true, connectivity: true, presentation: true },
        },
      });
    let request = 0;
    const transact = (
      service: ReturnType<typeof session>,
      actions: unknown[],
    ) =>
      service.handle({
        apiVersion: "3.0",
        requestId: `req-${++request}`,
        operation: "transact",
        documentId: "main",
        transactionId: `txn-${request}`,
        expectedRevision: controller.document.revision,
        dryRun: false,
        actions,
      });
    expect(
      transact(session(true), [place("resistor", "R1", 100)]),
    ).toMatchObject({ ok: true, applied: true });
    const blind = session(false);
    const before = structuredClone(controller.document);
    // Naming a part by Reference reads the Document.
    expect(
      transact(blind, [
        {
          kind: "set-property",
          target: { kind: "instance", reference: "R1" },
          set: { value: "2k" },
        },
      ]),
    ).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    expect(controller.document).toEqual(before);
    // An undo goes as it is, without the Document.
    expect(transact(blind, [{ kind: "undo" }])).toMatchObject({
      ok: true,
      applied: true,
    });
    expect(controller.document.instances).toEqual([]);
  });

  it("leaves the Document alone for a list that changes nothing", async () => {
    const { controller, client, instance } = await editor();
    expect((await client.applyActions([place("resistor", "R1", 100)])).ok).toBe(
      true,
    );
    const before = structuredClone(controller.document);
    const report = await client.applyActions([
      {
        kind: "move",
        target: { kind: "instance", reference: "R1" },
        position: instance("R1")!.placement!.position,
      },
    ]);
    expect(report).toMatchObject({
      ok: true,
      applied: false,
      revision: before.revision,
      changedObjectIds: [],
      editKinds: [],
    });
    expect(controller.document).toEqual(before);
  });
});
