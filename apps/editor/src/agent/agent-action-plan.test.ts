import { describe, expect, it } from "vitest";
import { createAgentCircuitService } from "@icm/agent-adapter";
import {
  diagnoseVisualQuality,
  resolveEndpointConnection,
  resolveMosBulkConnection,
} from "@icm/derived";
import { proposePlacementContact } from "@icm/edit-engine";
import { createEmptyProject, routeEndpoints } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { renderDocumentSvg } from "@icm/render-svg";
import {
  InMemorySymbolResolver,
  builtInSymbols,
  createProjectHierarchicalSymbols,
  hierarchicalSymbolId,
} from "@icm/symbols";
import { AgentSessionClient } from "../../../../packages/agent-client/src/session-client";
import { FakeAgentHttp } from "../../../../packages/agent-client/src/test-support/fake-relay";
import { EditorDocumentController } from "../document/document-controller";
import { planPlacedCellPin } from "../features/component-insert/cell-pin-placement";
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
  it(
    "keeps repeated medium-document edits to one dispatch each",
    { timeout: 30_000 },
    async () => {
      const { controller, client, http, instance } = await editor();
      const started = performance.now();
      // Placement expands to several edits per device; stay within the
      // existing atomic edit budget instead of asking to raise it for a probe.
      for (let start = 0; start < 120; start += 20) {
        const placed = await client.applyActions(
          Array.from({ length: 20 }, (_, i) =>
            place("resistor", `R${start + i + 1}`, 100 + (start + i) * 200),
          ),
        );
        expect(placed.ok, placed.message).toBe(true);
      }
      const calls = http.circuitCalls.length;
      const revision = controller.document.revision;
      const samples: number[] = [];
      for (let i = 0; i < 16; i++) {
        const before = performance.now();
        const result = await client.applyActions([
          {
            kind: "set-property",
            target: { kind: "instance", reference: "R1" },
            set: { value: `${i + 100}k` },
          },
        ]);
        samples.push(performance.now() - before);
        expect(result.ok, result.message).toBe(true);
      }
      expect(
        http.circuitCalls.slice(calls).map(({ request }) => request.operation),
      ).toEqual(Array(16).fill("transact"));
      expect(controller.document.revision).toBe(revision + 16);
      expect(instance("R1")?.netlist?.parameters.value).toBe("115k");
      // Evidence, not a machine-specific performance gate or network estimate.
      console.info(
        JSON.stringify({
          probe: "120-device-16-edits",
          setupAndEditsMs: Math.round(performance.now() - started),
          editMs: samples.map(Math.round),
        }),
      );
    },
  );
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

  /**
   * sram6t drawn as a textbook draws it, bl and wl left, blb right, VDD
   * above and VSS below, placed once in the top Cell as X1 and wired to the
   * top Cell's own Pins VDD, VSS, bl, blb and wl0.
   */
  async function sramArray() {
    const harness = await editor();
    const { controller, client } = harness;
    const apply = async (actions: unknown[], documentId?: string) => {
      const report = await client.applyActions(
        actions,
        documentId ? { documentId } : {},
      );
      expect(report.ok, report.message).toBe(true);
      return report;
    };
    const port = (reference: string, x: number, y: number, right = false) => ({
      kind: "place-component",
      symbol: "port",
      reference,
      position: { x, y },
      direction: "inout",
      ...(right ? { mirror: "horizontal" } : {}),
    });
    await apply([{ kind: "create-cell", id: "sram6t", name: "sram6t" }]);
    await apply(
      [
        port("VDD", 200, 0),
        port("VSS", 200, 300),
        port("bl", 0, 100),
        port("blb", 400, 100, true),
        port("wl", 0, 200),
      ],
      "sram6t",
    );
    await apply([
      {
        kind: "place-cell",
        childDocumentId: "sram6t",
        reference: "X1",
        placement: { position: { x: 400, y: 400 } },
      },
    ]);
    await apply([
      port("VDD", 400, 200),
      port("VSS", 400, 600),
      port("bl", 200, 340),
      port("wl0", 200, 460),
      port("blb", 600, 400, true),
    ]);
    const main = () =>
      controller.project.documents.find((item) => item.id === "main")!;
    const id = (name: string) =>
      main().instances.find(
        (item) =>
          item.reference === name ||
          main().netlist?.terminals.some(
            (terminal) =>
              terminal.name === name &&
              terminal.interfaceInstanceIds.includes(item.id),
          ),
      )!.id;
    for (const [pin, name] of [
      ["VDD", "VDD"],
      ["VSS", "VSS"],
      ["bl", "bl"],
      ["blb", "blb"],
      ["wl", "wl0"],
    ])
      await apply([
        {
          kind: "connect",
          from: { kind: "pin", instance: "X1", pin },
          to: {
            kind: "pin",
            instance: { kind: "instance", id: id(name!) },
            pin: "P",
          },
        },
      ]);
    return { ...harness, main, id };
  }

  it(
    "swaps a placed Cell's bl and blb in one call; its caller keeps its Nets and netlist line (#1320)",
    { timeout: 30_000 },
    async () => {
      const { controller, client, main, id } = await sramArray();
      const members = () =>
        main()
          .nets.map((net) =>
            net.terminals
              .map((terminal) => `${terminal.instanceId}.${terminal.pinName}`)
              .sort()
              .join(" "),
          )
          .sort();
      const callLine = () => {
        const exported = createDesignNetlistExport(controller.project, {
          format: "spice",
        });
        expect(exported.status, JSON.stringify(exported)).toBe("ready");
        return exported.status === "ready"
          ? exported.file.text.split("\n").find((line) => /^X1 /u.test(line))
          : undefined;
      };
      const sides = () =>
        Object.fromEntries(
          createProjectHierarchicalSymbols(controller.project)
            .find((symbol) => symbol.id === hierarchicalSymbolId("sram6t"))!
            .pins.map((pin) => [pin.name, pin.direction]),
        );
      expect(sides()).toMatchObject({ bl: "west", blb: "east" });
      expect(callLine()).toBe("X1 VDD VSS bl blb wl0 sram6t");
      const nets = members();

      const report = await client.applyActions(
        [
          {
            kind: "set-cell-symbol-pins",
            pins: [
              { name: "bl", side: "east" },
              { name: "blb", side: "west" },
            ],
          },
        ],
        { documentId: "sram6t" },
      );
      expect(report.ok, report.message).toBe(true);
      expect(sides()).toEqual({
        VDD: "north",
        VSS: "south",
        bl: "east",
        blb: "west",
        wl: "west",
      });
      expect(members()).toEqual(nets);
      expect(callLine()).toBe("X1 VDD VSS bl blb wl0 sram6t");
      // The receipt names the caller whose wiring was redrawn, and its Cell.
      expect(report.projectStructure?.changedDocumentIds).toContain("main");
      expect(report.changedObjectIds).toContain(id("X1"));
      // Its stretched wires are drawn around the block, not through it.
      expect(
        diagnoseVisualQuality(main(), controller.resolver).map(
          (finding) => finding.code,
        ),
      ).not.toContain("VISUAL_WIRE_THROUGH_SYMBOL");
    },
  );

  it(
    "refuses a Pin the Cell has not, naming the action and the Cell's Pins (#1320)",
    { timeout: 30_000 },
    async () => {
      const { controller, client } = await sramArray();
      const before = structuredClone(controller.project.documents);
      const report = await client.applyActions(
        [
          {
            kind: "set-cell-symbol-pins",
            pins: [{ name: "bll", side: "west" }],
          },
        ],
        { documentId: "sram6t" },
      );
      expect(report).toMatchObject({
        ok: false,
        actionIndex: 0,
        actionKind: "set-cell-symbol-pins",
        message:
          'actions[0] (set-cell-symbol-pins): sram6t has no Pin "bll"; its Pins: VDD, VSS, bl, blb, wl. Nothing was changed.',
      });
      expect(controller.project.documents).toEqual(before);
    },
  );

  it("draws the wires an arrange stretches clear of the parts they would cross (#1344)", async () => {
    // R2 is lined up 80 lower with R4. The stretch drops its wire from R1
    // with a crossbar halfway down, straight through R3.
    const { controller, client } = await editor();
    const apply = async (actions: unknown[]) => {
      const report = await client.applyActions(actions);
      expect(report.ok, report.message).toBe(true);
    };
    await apply(
      [
        ["R1", 0, 0],
        ["R2", 100, 0],
        ["R3", 50, 60],
        ["R4", 200, 80],
      ].map(([reference, x, y]) => ({
        kind: "place-component",
        symbol: "resistor",
        reference,
        position: { x, y },
      })),
    );
    await apply([
      { kind: "connect", from: pin("R1", "2"), to: pin("R2", "2") },
    ]);
    const netOf = (reference: string, pinName: string) => {
      const instance = controller.document.instances.find(
        (item) => item.reference === reference,
      )!;
      return controller.document.nets.find((net) =>
        net.terminals.some(
          (terminal) =>
            terminal.instanceId === instance.id && terminal.pinName === pinName,
        ),
      )?.id;
    };
    expect(netOf("R2", "2")).toBe(netOf("R1", "2"));

    await apply([
      {
        kind: "arrange",
        instances: [
          { kind: "instance", reference: "R2" },
          { kind: "instance", reference: "R4" },
        ],
        axis: "y",
        coordinate: 80,
      },
    ]);

    expect(netOf("R2", "2")).toBe(netOf("R1", "2"));
    expect(netOf("R3", "1")).toBeUndefined();
    expect(
      diagnoseVisualQuality(
        controller.document,
        new InMemorySymbolResolver(builtInSymbols),
      ).map((finding) => finding.code),
    ).not.toContain("VISUAL_WIRE_THROUGH_SYMBOL");
  });

  it("keeps a controlled source on the Nets it senses through a rewire (#1411)", async () => {
    const { controller, client, instance } = await editor();
    const apply = async (actions: unknown[]) => {
      const report = await client.applyActions(actions);
      expect(report.ok, report.message).toBe(true);
    };
    const cellPin = (name: string) => {
      const terminal = controller.document.netlist!.terminals.find(
        (item) => item.name === name,
      )!;
      return {
        net: terminal.netId,
        pin: {
          kind: "pin",
          instance: { kind: "instance", id: terminal.interfaceInstanceIds[0] },
          pin: "P",
        },
      };
    };
    await apply([
      place("port", "B", 0),
      place("capacitor", "C1", 160, { value: "1p" }),
      place("port", "E", 320),
    ]);
    await apply([
      { kind: "connect", from: cellPin("B").pin, to: pin("C1", "1") },
      { kind: "connect", from: pin("C1", "2"), to: cellPin("E").pin },
    ]);
    await apply([
      {
        kind: "place-component",
        symbol: "vccs",
        reference: "G1",
        position: { x: 500, y: 100 },
        parameters: { gm: "1m" },
        control: {
          kind: "voltage",
          positiveNetId: cellPin("B").net,
          negativeNetId: cellPin("E").net,
        },
      },
    ]);
    const before = cellPin("E").net;
    // Redraw E's wire: take it away, then draw it again.
    const wire = controller.document.routes.find(
      (route) => route.netId === before,
    )!;
    await apply([
      { kind: "delete-selection", selection: { routeIds: [wire.id] } },
    ]);
    await apply([
      { kind: "connect", from: pin("C1", "2"), to: cellPin("E").pin },
    ]);

    expect(instance("G1")!.netlist!.control).toEqual({
      kind: "voltage",
      positiveNetId: cellPin("B").net,
      negativeNetId: cellPin("E").net,
    });
    expect(
      createDesignNetlistExport(controller.project).diagnostics.map(
        (diagnostic) => diagnostic.code,
      ),
    ).not.toContain("INVALID_CONTROL_NET");
    // The rewire did retire the Net's first identity.
    expect(cellPin("E").net).not.toBe(before);
  });

  it.each(["reset-body", "clear-drawing"] as const)(
    "redraws a supply rail after %s with the supply's own label, not a second one (#1410)",
    async (mode) => {
      const { controller, client } = await editor();
      const apply = async (actions: unknown[]) => {
        const report = await client.applyActions(actions);
        expect(report.ok, report.message).toBe(true);
      };
      await apply([
        {
          kind: "add-power-rail",
          name: "VDD",
          start: { x: 0, y: -100 },
          end: { x: 100, y: -100 },
        },
      ]);
      await apply([place("resistor", "R1", 50)]);
      const terminal = controller.document.netlist!.terminals.find(
        (item) => item.name === "VDD",
      )!;
      await apply([{ kind: "reset-cell", mode }]);
      await apply([
        {
          kind: "add-power-rail",
          name: "VDD",
          start: { x: -100, y: -200 },
          end: { x: 200, y: -200 },
        },
      ]);

      const document = controller.document;
      // The Cell keeps one VDD Pin, the one its callers know.
      expect(
        document.netlist!.terminals.filter((item) => item.name === "VDD"),
      ).toEqual([expect.objectContaining({ id: terminal.id })]);
      const labels = document.annotations.filter(
        (annotation) => annotation.kind === "power-label",
      );
      expect(labels).toHaveLength(1);
      // It now stands at the new rail, on one of its ends.
      const rail = document.routes.find(
        (route) => route.presentation === "power-rail",
      )!;
      const ends = routeEndpoints(rail).flatMap((end) =>
        end.kind === "junction" ? [end.junctionId] : [],
      );
      expect(labels[0]!.anchor).toMatchObject({ kind: "object" });
      expect(ends).toContain(
        labels[0]!.anchor.kind === "object" ? labels[0]!.anchor.objectId : "",
      );
      // No Junction is left anchoring nothing.
      const anchored = new Set(
        document.annotations.flatMap((annotation) =>
          annotation.anchor.kind === "object"
            ? [annotation.anchor.objectId]
            : [],
        ),
      );
      const routed = new Set(
        document.routes.flatMap((route) =>
          routeEndpoints(route).flatMap((end) =>
            end.kind === "junction" ? [end.junctionId] : [],
          ),
        ),
      );
      expect(
        document.junctions.filter(
          (junction) => !routed.has(junction.id) && !anchored.has(junction.id),
        ),
      ).toEqual([]);
    },
  );

  it.each(["reset-body", "clear-drawing"] as const)(
    "redraws a supply as a VDD Pin marker after %s, which takes the kept Pin's place (#1410)",
    async (mode) => {
      const { controller, client } = await editor();
      const apply = async (actions: unknown[]) => {
        const report = await client.applyActions(actions);
        expect(report.ok, report.message).toBe(true);
      };
      await apply([
        {
          kind: "add-power-rail",
          name: "VDD",
          start: { x: 0, y: -100 },
          end: { x: 100, y: -100 },
        },
      ]);
      await apply([place("pmos", "M1", 50)]);
      const kept = controller.document.netlist!.terminals.find(
        (item) => item.name === "VDD",
      )!;
      const placements = structuredClone(
        controller.document.presentation.cellSymbol?.pinPlacements,
      );
      await apply([{ kind: "reset-cell", mode }]);
      await apply([
        {
          kind: "place-component",
          symbol: "vdd-port",
          reference: "VDD",
          position: { x: 300, y: -200 },
        },
      ]);

      const document = controller.document;
      const marker = document.instances.find(
        (item) => item.symbolId === "vdd-port",
      )!;
      // One VDD Pin, the marker's, on the supply's own Net.
      const pins = document.netlist!.terminals.filter(
        (item) => item.name === "VDD",
      );
      expect(pins).toEqual([
        expect.objectContaining({
          netId: kept.netId,
          interfaceInstanceIds: [marker.id],
        }),
      ]);
      // The Cell's symbol keeps the Pin where its callers see it.
      expect(document.presentation.cellSymbol?.pinPlacements).toEqual(
        placements?.map((placement) => ({
          ...placement,
          terminalId: pins[0]!.id,
        })),
      );
      // The kept label went: the marker's own is the only one.
      expect(
        document.annotations.filter(
          (annotation) => annotation.kind === "power-label",
        ),
      ).toEqual([
        expect.objectContaining({
          anchor: expect.objectContaining({ objectId: marker.id }),
        }),
      ]);
      expect(document.junctions).toEqual([]);
      // A PMOS body default on the supply stays on it.
      if (mode === "clear-drawing")
        expect(document.mosBulkDefaults?.pmosNetId).toBe(kept.netId);
    },
  );

  it("takes the kept Pin over for a VDD marker the GUI drops on the supply's own Junction (#1410)", async () => {
    const { controller, client } = await editor();
    for (const actions of [
      [
        {
          kind: "add-power-rail",
          name: "VDD",
          start: { x: 0, y: -100 },
          end: { x: 100, y: -100 },
        },
      ],
      [{ kind: "reset-cell", mode: "reset-body" }],
    ]) {
      const report = await client.applyActions(actions);
      expect(report.ok, report.message).toBe(true);
    }
    const { project, document, resolver } = controller;
    const kept = document.netlist!.terminals.find(
      (item) => item.name === "VDD",
    )!;
    const label = document.annotations.find(
      (annotation) => annotation.id === kept.interfaceAnnotationId,
    )!;
    const junctionId =
      label.anchor.kind === "object" ? label.anchor.objectId : "";
    const junction = document.junctions.find((item) => item.id === junctionId)!;
    // The marker's pin lands on the Junction, as a drop there does.
    const pin = resolver.resolve("vdd-port")!.definition.pins[0]!;
    const instance = {
      id: "VDD9",
      symbolId: "vdd-port",
      placement: {
        position: {
          x: junction.position.x - pin.at.x,
          y: junction.position.y - pin.at.y,
        },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const endpoint = { kind: "junction" as const, junctionId };
    const contact = proposePlacementContact(
      document,
      resolver,
      instance,
      [
        {
          endpoint,
          connection: resolveEndpointConnection(document, resolver, endpoint)!,
          netId: kept.netId,
          preludeEdits: [],
        },
      ],
      { powerMarker: false },
    );
    expect(contact).toMatchObject({ matched: true, netId: kept.netId });
    const result = controller.dispatchProjectTransaction({
      transactionId: "drop-on-supply",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planPlacedCellPin(project, document.id, resolver, {
        instance,
        terminalId: "terminal-vdd9",
        name: "VDD",
        netId: kept.netId,
        direction: "inout",
        connectionEdits: contact.edits,
      }),
    });
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    expect(
      controller.document.netlist!.terminals.filter(
        (item) => item.name === "VDD",
      ),
    ).toEqual([
      expect.objectContaining({
        netId: kept.netId,
        interfaceInstanceIds: ["VDD9"],
      }),
    ]);
  });

  it("redraws two VDD markers in one call after a reset, keeping VDD first among the Pins (#1410)", async () => {
    const { controller, client } = await editor();
    const apply = async (actions: unknown[]) => {
      const report = await client.applyActions(actions);
      expect(report.ok, report.message).toBe(true);
    };
    await apply([
      {
        kind: "add-power-rail",
        name: "VDD",
        start: { x: 0, y: -100 },
        end: { x: 100, y: -100 },
      },
    ]);
    await apply([place("port", "IN", 200), place("port", "OUT", 400)]);
    const names = () =>
      controller.document.netlist!.terminals.map((item) => item.name);
    expect(names()).toEqual(["VDD", "IN", "OUT"]);
    await apply([{ kind: "reset-cell", mode: "reset-body" }]);
    // A marker per PMOS, as the Gallery's drawings have them.
    await apply(
      [300, 500].map((x) => ({
        kind: "place-component",
        symbol: "vdd-port",
        reference: "VDD",
        position: { x, y: -200 },
      })),
    );
    // The first takes the kept Pin's place in the order callers wire by;
    // the second joins it by name.
    expect(names()).toEqual(["VDD", "IN", "OUT", "VDD"]);
    const markers = controller.document.instances.filter(
      (item) => item.symbolId === "vdd-port",
    );
    expect(controller.document.netlist!.terminals[0]).toMatchObject({
      interfaceInstanceIds: [markers[0]!.id],
    });
    expect(
      controller.document.annotations.filter(
        (annotation) => annotation.kind === "power-label",
      ),
    ).toHaveLength(2);
  });

  it("places the palette's DMOS and depletion MOS, and a DMOS takes a SKY130 20 V model (#1425)", async () => {
    const { client, instance } = await editor();
    const placed = await client.applyActions([
      place("ndmos", "M1", 100),
      place("pdmos", "M2", 300),
      place("depletion-nmos", "M3", 500),
      place("depletion-pmos", "M4", 700),
    ]);
    expect(placed.ok, placed.message).toBe(true);
    expect(
      ["M1", "M2", "M3", "M4"].map((name) => instance(name)?.symbolId),
    ).toEqual(["ndmos", "pdmos", "depletion-nmos", "depletion-pmos"]);

    const modelled = await client.applyActions([
      {
        kind: "set-model",
        instanceId: instance("M1")!.id,
        model: "sky130_fd_pr__nfet_20v0",
      },
    ]);
    expect(modelled.ok, modelled.message).toBe(true);
    expect(instance("M1")!.netlist!.binding?.kind).toBe("external-subcircuit");
  });

  it("shows a device's multiplier as ×m beside it, bound to m (#1423)", async () => {
    const { controller, client, instance } = await editor();
    const placed = await client.applyActions([
      place("npn", "Q2", 100, { m: "8" }),
      place("nmos", "M1", 400, { m: "4" }),
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const shown = await client.applyActions([
      {
        kind: "set-instance-display",
        instanceIds: [instance("Q2")!.id, instance("M1")!.id],
        showParameters: { m: true },
      },
    ]);
    expect(shown.ok, shown.message).toBe(true);
    const multipliers = controller.document.annotations.filter(
      (annotation) =>
        annotation.binding?.kind === "instance-value" &&
        annotation.binding.parameter === "m",
    );
    expect(multipliers).toHaveLength(2);
    const svg = renderDocumentSvg(controller.document, controller.resolver);
    expect(svg).toContain("×8");
    expect(svg).toContain("×4");

    // A part with no multiplier refuses the display.
    await client.applyActions([place("resistor", "R1", 700, { value: "1k" })]);
    const refused = await client.applyActions([
      {
        kind: "set-instance-display",
        instanceIds: [instance("R1")!.id],
        showParameters: { m: true },
      },
    ]);
    expect(refused.ok).toBe(false);
  });

  it("moves a label to a part's other side with the end it reads from (#1414)", async () => {
    const { controller, client, instance } = await editor();
    await client.applyActions([
      { ...place("resistor", "R1", 100, { value: "1k" }), showValue: true },
    ]);
    const value = controller.document.annotations.find(
      (annotation) =>
        annotation.binding?.kind === "instance-value" &&
        annotation.binding.instanceId === instance("R1")!.id,
    )!;
    const moved = await client.applyActions([
      {
        kind: "move-annotation",
        annotationId: value.id,
        position: { x: 80, y: 100 },
        alignment: "end",
      },
    ]);
    expect(moved.ok, moved.message).toBe(true);
    expect(
      controller.document.annotations.find((item) => item.id === value.id),
    ).toMatchObject({ alignment: "end" });
  });

  it("says which labels arrange-labels leaves in place, and re-places moved ones on request (#1414)", async () => {
    const { controller, client, instance } = await editor();
    await client.applyActions([
      { ...place("resistor", "R1", 100, { value: "1k" }), showValue: true },
    ]);
    const id = instance("R1")!.id;
    const value = () =>
      controller.document.annotations.find(
        (annotation) =>
          annotation.binding?.kind === "instance-value" &&
          annotation.binding.instanceId === id,
      )!;
    const drawn = structuredClone(value().anchor);
    await client.applyActions([
      {
        kind: "move-annotation",
        annotationId: value().id,
        position: { x: 400, y: 300 },
      },
    ]);

    const kept = await client.applyActions([
      { kind: "arrange-labels", instanceIds: [id] },
    ]);
    expect(kept.ok, kept.message).toBe(true);
    expect(kept.diagnosticDelta?.added).toContainEqual(
      expect.objectContaining({
        code: "LABELS_LEFT_IN_PLACE",
        severity: "info",
        objectIds: [value().id],
        message: expect.stringContaining("moved by hand"),
      }),
    );

    const replaced = await client.applyActions([
      { kind: "arrange-labels", instanceIds: [id], includeManual: true },
    ]);
    expect(replaced.ok, replaced.message).toBe(true);
    expect(value().anchor).toEqual(drawn);
  });

  it("draws a rail of a supply whose VDD Pin marker stands, leaving the marker's label (#1410)", async () => {
    const { controller, client } = await editor();
    const marked = await client.applyActions([
      {
        kind: "place-component",
        symbol: "vdd-port",
        reference: "VDD",
        position: { x: 100, y: -100 },
      },
    ]);
    expect(marked.ok, marked.message).toBe(true);
    const labels = () =>
      controller.document.annotations
        .filter((annotation) => annotation.kind === "power-label")
        .map((annotation) => structuredClone(annotation));
    const before = labels();

    const railed = await client.applyActions([
      {
        kind: "add-power-rail",
        name: "VDD",
        start: { x: 200, y: -200 },
        end: { x: 300, y: -200 },
      },
    ]);
    expect(railed.ok, railed.message).toBe(true);
    // The marker keeps its own label; the rail draws one of its own.
    for (const label of before) expect(labels()).toContainEqual(label);
    expect(labels()).toHaveLength(before.length + 1);
  });

  it("shows a MOS's ×m once: in its W/L while that shows, else under its name (#1423)", async () => {
    const { controller, client, instance } = await editor();
    await client.applyActions([
      {
        ...place("nmos", "M1", 100, { w: "10u", l: "1u", m: "4" }),
        showValue: true,
      },
      place("npn", "Q1", 400, { m: "8" }),
    ]);
    const m1 = instance("M1")!.id;
    const q1 = instance("Q1")!.id;
    const shown = await client.applyActions([
      {
        kind: "set-instance-display",
        instanceIds: [m1, q1],
        showParameters: { m: true },
      },
    ]);
    expect(shown.ok, shown.message).toBe(true);
    const counts = () =>
      renderDocumentSvg(controller.document, controller.resolver).split("×4")
        .length - 1;
    // The W/L reads 10u/1u ×4 already: the count is not drawn again.
    expect(counts()).toBe(1);

    const hidden = await client.applyActions([
      { kind: "set-instance-display", instanceIds: [m1], showValue: false },
    ]);
    expect(hidden.ok, hidden.message).toBe(true);
    // With the W/L hidden, its own label says ×4, a text row under the
    // name as a BJT's ×8 is, not in the taller row the W/L took.
    expect(counts()).toBe(1);
    // A part's name, or its ×m label, by its offset down from the part.
    const row = (instanceId: string, parameter?: "m") => {
      const label = controller.document.annotations.find((annotation) =>
        parameter
          ? annotation.binding?.kind === "instance-value" &&
            annotation.binding.instanceId === instanceId &&
            annotation.binding.parameter === parameter
          : annotation.binding?.kind === "instance-reference" &&
            annotation.binding.instanceId === instanceId,
      );
      return label?.anchor.kind === "object"
        ? label.anchor.localOffset.y
        : Number.NaN;
    };
    expect(row(m1, "m") - row(m1)).toBe(row(q1, "m") - row(q1));
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
