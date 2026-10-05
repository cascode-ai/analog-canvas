import { describe, expect, it } from "vitest";
import { createAgentCircuitService } from "@icm/agent-adapter";
import { diagnoseVisualQuality, resolveMosBulkConnection } from "@icm/derived";
import { createEmptyProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
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
  // Ten calls through the live editor, the first loading it cold: beside a
  // busy run it outlasts 5 s.
  it(
    "places, wires, edits, labels, moves, deletes and steps history, the client never reading the Document",
    { timeout: 30_000 },
    async () => {
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
      expect(instance("R1")?.netlist?.parameters).toMatchObject({
        value: "1k",
      });
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
      expect(instance("R2")?.netlist?.parameters).toMatchObject({
        value: "2k",
      });
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
    },
  );

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

  it(
    "draws a moved part's stretched wires clear of other parts and pins (#1344)",
    { timeout: 30_000 },
    async () => {
      // A 2-bit flash ADC: a ladder R4–R1, three comparators each taking a
      // tap on IN− and vin on IN+. X3 is typed two grid steps higher and X1
      // two lower. X1's IN− bend slid down along R1, so the wire seemed to
      // leave from R1's middle, and X3's IN+ came to lie on its own IN− wire.
      const { controller, client } = await editor();
      const apply = async (actions: unknown[]) => {
        const report = await client.applyActions(actions);
        expect(report.ok, report.message).toBe(true);
      };
      const at = (symbol: string, reference: string, x: number, y: number) => ({
        kind: "place-component",
        symbol,
        reference,
        position: { x, y },
      });
      await apply([
        ...["R4", "R3", "R2", "R1"].map((reference, index) =>
          at("resistor", reference, 0, -120 + 60 * index),
        ),
        ...["X3", "X2", "X1"].map((reference, index) =>
          at("comparator", reference, 120, -90 + 60 * index),
        ),
        {
          kind: "place-component",
          symbol: "port",
          reference: "vin",
          pinAnchor: { pinName: "P", position: { x: -60, y: 130 } },
          direction: "input",
        },
      ]);
      const id = (reference: string) =>
        controller.document.instances.find(
          (item) =>
            item.reference === reference ||
            controller.document.netlist?.terminals.some(
              (terminal) =>
                terminal.name === reference &&
                terminal.interfaceInstanceIds?.includes(item.id),
            ),
        )!.id;
      const net = (...pins: [string, string][]) =>
        apply([
          {
            kind: "route-net",
            target: {
              kind: "pins",
              pins: pins.map(([reference, pinName]) => ({
                instanceId: id(reference),
                pinName,
              })),
            },
          },
        ]);
      await net(["R4", "2"], ["R3", "1"], ["X3", "IN-"]);
      await net(["R3", "2"], ["R2", "1"], ["X2", "IN-"]);
      await net(["R2", "2"], ["R1", "1"], ["X1", "IN-"]);
      await net(["vin", "P"], ["X1", "IN+"], ["X2", "IN+"], ["X3", "IN+"]);
      const joined = () =>
        controller.document.nets
          .map((item) =>
            item.terminals
              .map(
                (terminal) =>
                  `${controller.document.instances.find((part) => part.id === terminal.instanceId)?.reference}.${terminal.pinName}`,
              )
              .sort()
              .join(" "),
          )
          .filter(Boolean)
          .sort();
      const before = joined();

      await apply([
        {
          kind: "move",
          target: { kind: "instance", reference: "X3" },
          position: { x: 120, y: -130 },
        },
        {
          kind: "move",
          target: { kind: "instance", reference: "X1" },
          position: { x: 120, y: 70 },
        },
      ]);

      expect(joined()).toEqual(before);
      const findings = diagnoseVisualQuality(
        controller.document,
        new InMemorySymbolResolver(builtInSymbols),
      ).map((finding) => finding.code);
      expect(findings).not.toContain("VISUAL_WIRE_THROUGH_SYMBOL");
      expect(findings).not.toContain("VISUAL_TERMINAL_ON_FOREIGN_ROUTE");
    },
  );
  it("ties a PMOS body with no Net to its own source in one connect (#1302)", async () => {
    const { controller, client, instance } = await editor();
    const apply = async (actions: unknown[]) => {
      const report = await client.applyActions(actions);
      expect(report.ok, report.message).toBe(true);
    };
    await apply([place("pmos", "MP", 100), place("resistor", "R1", 400)]);
    await apply([
      { kind: "connect", from: pin("MP", "S"), to: pin("R1", "1") },
    ]);
    const mp = instance("MP")!;
    expect(mp.symbolVariantId).toBe("textbook-3terminal");
    const findings = () =>
      createDesignNetlistExport(controller.project, {
        format: "spice",
      }).diagnostics.filter((item) => item.code === "MOS_BODY_DEFAULT_SUPPLY");
    // Nothing drawn says where the body goes, so the netlist gives it VDD
    // and says so.
    expect(resolveMosBulkConnection(controller.document, mp.id)?.status).toBe(
      "unresolved",
    );
    expect(findings().map((item) => item.objectIds)).toEqual([[mp.id]]);
    await apply([
      { kind: "connect", from: pin("MP", "B"), to: pin("MP", "S") },
    ]);
    const netOf = (pinName: string) =>
      controller.document.nets.find((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === mp.id && terminal.pinName === pinName,
        ),
      )?.id;
    expect(netOf("B")).toBeDefined();
    expect(netOf("B")).toBe(netOf("S"));
    expect(resolveMosBulkConnection(controller.document, mp.id)?.status).toBe(
      "explicit",
    );
    // Drawn as the GUI's Draw bulk connection draws it.
    expect(
      controller.document.routes.filter(
        (route) => route.presentation === "bulk-dashed",
      ),
    ).toHaveLength(1);
    expect(findings()).toEqual([]);
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
