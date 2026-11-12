import { describe, expect, it } from "vitest";
import { createAgentCircuitService } from "@icm/agent-adapter";
import { resolveRouteGeometry } from "@icm/derived";
import { createEmptyProject, routeEndpoints } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { hierarchicalSymbolId } from "@icm/symbols";
import { AgentSessionClient } from "../../../../packages/agent-client/src/session-client";
import { FakeAgentHttp } from "../../../../packages/agent-client/src/test-support/fake-relay";
import { EditorDocumentController } from "../document/document-controller";
import { BrowserAgentHost } from "./browser-agent-host";

const pinAt = (
  name: string,
  role: string,
  x: number,
  y: number,
  direction: "north" | "east" | "west",
  /** A named pin's lead, so its name stands inside the body at its end. */
  leadLength?: number,
) => ({
  name,
  role,
  at: { x, y },
  direction,
  presentation: {
    visibility: "visible",
    showName: leadLength !== undefined,
    ...(leadLength !== undefined ? { leadLength, textSizeScale: 0.6 } : {}),
  },
});
const lead = (x1: number, y1: number, x2: number, y2: number) => ({
  kind: "line",
  from: { x: x1, y: y1 },
  to: { x: x2, y: y2 },
});
/** − and + on the left, OUT at the apex, VDD, VB1 and VB2 on the top edge. */
const OPAMP_TRIANGLE = {
  schemaVersion: 1,
  id: "opamp-triangle",
  name: "Opamp",
  viewBox: { x: -60, y: -50, width: 120, height: 90 },
  pins: [
    pinAt("-", "inverting-input", -60, -20, "west"),
    pinAt("+", "non-inverting-input", -60, 20, "west"),
    pinAt("OUT", "output", 60, 0, "east"),
    pinAt("VDD", "inout", -30, -50, "north", 15),
    pinAt("VB1", "input", -10, -50, "north", 25),
    pinAt("VB2", "input", 10, -50, "north", 35),
  ],
  primitives: [
    {
      kind: "polygon",
      points: [
        { x: -40, y: -40 },
        { x: -40, y: 40 },
        { x: 40, y: 0 },
      ],
      fill: "none",
      style: { strokeRole: "emphasis" },
    },
    lead(-60, -20, -40, -20),
    lead(-60, 20, -40, 20),
    lead(40, 0, 60, 0),
    lead(-30, -50, -30, -35),
    lead(-10, -50, -10, -25),
    lead(10, -50, 10, -15),
    lead(-35, -20, -29, -20),
    lead(-35, 20, -29, 20),
    lead(-32, 17, -32, 23),
  ],
  variants: [],
};

/** One editor, reached by an Agent client that sends it action lists. */
async function editor() {
  const project = createEmptyProject("project-1", "LDO");
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
  const apply = async (actions: unknown[], documentId?: string) => {
    const report = await client.applyActions(
      actions,
      documentId ? { documentId } : {},
    );
    expect(report.ok, report.message).toBe(true);
    return report;
  };
  return { controller, client, apply };
}

/**
 * AnalogGenie 2224, an LDO: an "Opamp" Cell with Pins VDD, VB1, VB2, INP,
 * INN and OUT, placed in the top Cell with Vref on INP, the feedback divider
 * on INN and OUT on the PMOS pass gate.
 */
async function ldo() {
  const harness = await editor();
  const { apply, controller } = harness;
  const port = (
    reference: string,
    x: number,
    y: number,
    direction: string,
    right = false,
  ) => ({
    kind: "place-component",
    symbol: "port",
    reference,
    position: { x, y },
    direction,
    ...(right ? { mirror: "horizontal" } : {}),
  });
  await apply([{ kind: "create-cell", id: "opamp", name: "Opamp" }]);
  await apply(
    [
      port("INN", 0, 100, "input"),
      port("INP", 0, 200, "input"),
      port("VDD", 100, 0, "inout"),
      port("VB1", 200, 0, "input"),
      port("VB2", 300, 0, "input"),
      port("OUT", 400, 150, "output", true),
    ],
    "opamp",
  );
  await apply([
    {
      kind: "place-cell",
      childDocumentId: "opamp",
      reference: "X1",
      placement: { position: { x: 400, y: 400 } },
    },
  ]);
  await apply([
    {
      kind: "place-component",
      symbol: "voltage-source",
      reference: "VREF",
      position: { x: 200, y: 560 },
      parameters: { dc: "1.2" },
    },
    {
      kind: "place-component",
      symbol: "pmos",
      reference: "M1",
      position: { x: 700, y: 300 },
    },
    {
      kind: "place-component",
      symbol: "resistor",
      reference: "R1",
      position: { x: 710, y: 480 },
      parameters: { value: "100k" },
    },
    {
      kind: "place-component",
      symbol: "resistor",
      reference: "R2",
      position: { x: 710, y: 600 },
      parameters: { value: "100k" },
    },
    {
      kind: "place-component",
      symbol: "ground",
      position: { x: 200, y: 680 },
    },
    {
      kind: "place-component",
      symbol: "ground",
      position: { x: 710, y: 700 },
    },
    port("VDD", 600, 160, "inout"),
    port("VB1", 300, 240, "input"),
    port("VB2", 300, 280, "input"),
  ]);
  const main = () =>
    controller.project.documents.find((item) => item.id === "main")!;
  const grounds = () =>
    main().instances.filter((item) => item.symbolId === "ground");
  const id = (name: string) =>
    name.startsWith("GND")
      ? grounds()[Number(name.slice(3)) - 1]!.id
      : main().instances.find(
          (item) =>
            item.reference === name ||
            main().netlist?.terminals.some(
              (terminal) =>
                terminal.name === name &&
                terminal.interfaceInstanceIds.includes(item.id),
            ),
        )!.id;
  const pin = (instance: string, name: string) => ({
    kind: "pin",
    instance: { kind: "instance", id: id(instance) },
    pin: name,
  });
  await apply([{ kind: "set-model", instanceId: id("M1"), model: "pch" }]);
  for (const [from, to] of [
    [pin("VREF", "+"), pin("X1", "INP")],
    [pin("VREF", "-"), pin("GND1", "0")],
    [pin("X1", "OUT"), pin("M1", "G")],
    [pin("VDD", "P"), pin("M1", "S")],
    [pin("X1", "VDD"), pin("VDD", "P")],
    [pin("M1", "D"), pin("R1", "1")],
    [pin("R1", "2"), pin("R2", "1")],
    [pin("X1", "INN"), pin("R2", "1")],
    [pin("R2", "2"), pin("GND2", "0")],
    [pin("X1", "VB1"), pin("VB1", "P")],
    [pin("X1", "VB2"), pin("VB2", "P")],
  ])
    await apply([{ kind: "connect", from, to }]);
  return { ...harness, main, id };
}

describe("an Agent gives a Cell its own artwork (AnalogGenie 2224)", () => {
  it(
    "draws the placed, wired Opamp as a triangle and back; Nets, netlists and wires on pins stay",
    { timeout: 60_000 },
    async () => {
      const { controller, client, apply, main, id } = await ldo();
      const members = () =>
        main()
          .nets.map((net) =>
            net.terminals
              .map((terminal) => `${terminal.instanceId}.${terminal.pinName}`)
              .sort()
              .join(" "),
          )
          .sort();
      const netlist = (format: "spice" | "spectre") => {
        const exported = createDesignNetlistExport(controller.project, {
          format,
        });
        expect(exported.status, JSON.stringify(exported)).toBe("ready");
        return exported.status === "ready" ? exported.file.text : "";
      };
      /** Each X1 wire ends at its pin as drawn, on straight grid runs. */
      const wiresOnPins = () => {
        const document = main();
        const resolver = controller.resolver;
        const instance = document.instances.find(
          (item) => item.id === id("X1"),
        )!;
        const symbol = resolver.resolve(instance.symbolId)!.definition;
        const ends: Record<string, number[]> = {};
        for (const route of document.routes)
          for (const [index, endpoint] of routeEndpoints(route).entries()) {
            if (
              endpoint.kind !== "terminal" ||
              endpoint.instanceId !== instance.id
            )
              continue;
            const drawn = symbol.pins.find(
              (item) => item.name === endpoint.pinName,
            )!;
            const geometry = resolveRouteGeometry(document, resolver, route)!;
            const end =
              index === 0
                ? geometry.centerline[0]!
                : geometry.centerline.at(-1)!;
            const { position } = instance.placement!;
            expect(end, endpoint.pinName).toEqual({
              x: position.x + drawn.at.x,
              y: position.y + drawn.at.y,
            });
            for (const segment of geometry.segments)
              expect(
                segment.from.x === segment.to.x ||
                  segment.from.y === segment.to.y,
              ).toBe(true);
            ends[endpoint.pinName] = [drawn.at.x, drawn.at.y];
          }
        return ends;
      };
      const nets = members();
      const spice = netlist("spice");
      const spectre = netlist("spectre");
      expect(spice).toMatch(/^X1 /mu);
      const box = wiresOnPins();
      expect(Object.keys(box).sort()).toEqual(
        ["INN", "INP", "OUT", "VB1", "VB2", "VDD"].sort(),
      );

      const report = await client.applyActions(
        [
          {
            kind: "set-cell-symbol-artwork",
            symbolMode: "custom",
            artworkText: JSON.stringify(OPAMP_TRIANGLE),
            pinMap: {
              INP: { pinName: "+" },
              INN: { pinName: "-" },
              OUT: { pinName: "OUT" },
              VDD: { pinName: "VDD" },
              VB1: { pinName: "VB1" },
              VB2: { pinName: "VB2" },
            },
          },
        ],
        { documentId: "opamp" },
      );
      expect(report.ok, report.message).toBe(true);
      expect(report.projectStructure?.changedDocumentIds).toContain("main");
      const triangle = controller.resolver.resolve(
        hierarchicalSymbolId("Opamp"),
      )!.definition;
      expect(triangle.primitives[0]).toMatchObject({ kind: "polygon" });
      expect(members()).toEqual(nets);
      expect(netlist("spice")).toBe(spice);
      expect(netlist("spectre")).toBe(spectre);
      expect(wiresOnPins()).toEqual({
        INN: [-60, -20],
        INP: [-60, 20],
        OUT: [60, 0],
        VDD: [-30, -50],
        VB1: [-10, -50],
        VB2: [10, -50],
      });

      // A Pin the artwork cannot draw is refused by name, changing nothing.
      const before = structuredClone(controller.project.documents);
      expect(
        await client.applyActions(
          [
            {
              kind: "set-cell-symbol-artwork",
              symbolMode: "custom",
              pinMap: { INP: { pinName: "+" } },
            },
          ],
          { documentId: "opamp" },
        ),
      ).toMatchObject({
        ok: false,
        actionKind: "set-cell-symbol-artwork",
        message: expect.stringContaining(
          "Opamp's custom symbol: Map Cell Pin INN to a graphical pin or an explicit supply",
        ),
      });
      expect(controller.project.documents).toEqual(before);

      await apply(
        [{ kind: "set-cell-symbol-artwork", symbolMode: "automatic" }],
        "opamp",
      );
      expect(members()).toEqual(nets);
      expect(netlist("spice")).toBe(spice);
      expect(wiresOnPins()).toEqual(box);
    },
  );
});
