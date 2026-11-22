import { describe, expect, it } from "vitest";
import { routeEnd, type CircuitProject } from "@icm/model";
import {
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "@icm/derived";
import { createDesignNetlistExport } from "@icm/netlist";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import type { EditorDocumentController } from "../document/document-controller";
import { folder } from "./agent-parity.test-support";

describe("delete-wires and inspect region", () => {
  /** A trunk RL–RR with two taps (RT1, RT2), labelled MID; RA–RB apart. */
  async function drawn() {
    const parts = await folder();
    const { client } = parts;
    const placed = await client.applyActions(
      (
        [
          ["RL", 0, 0, 270],
          ["RR", 400, 0, 270],
          ["RT1", 100, 100, 0],
          ["RT2", 200, 100, 0],
          ["RA", 0, 400, 270],
          ["RB", 400, 400, 270],
        ] as const
      ).map(([reference, x, y, rotation]) => ({
        kind: "place-component",
        symbol: "resistor",
        reference,
        position: { x, y },
        rotation,
      })),
    );
    expect(placed.ok, placed.message).toBe(true);
    const pin = (instance: string, name: string) => ({
      kind: "pin",
      instance,
      pin: name,
    });
    const wired = await client.applyActions([
      { kind: "connect", from: pin("RL", "2"), to: pin("RR", "1") },
      {
        kind: "connect",
        from: pin("RT1", "1"),
        to: { kind: "wire-at", point: { x: 100, y: 0 } },
      },
      {
        kind: "connect",
        from: pin("RT2", "1"),
        to: { kind: "wire-at", point: { x: 200, y: 0 } },
      },
      { kind: "connect", from: pin("RA", "2"), to: pin("RB", "1") },
    ]);
    expect(wired.ok, wired.message).toBe(true);
    const labelled = await client.applyActions([
      {
        kind: "add-label",
        target: pin("RL", "2"),
        text: "MID",
        position: { x: 300, y: 0 },
      },
    ]);
    expect(labelled.ok, labelled.message).toBe(true);
    return parts;
  }
  const note = (receipt: {
    diagnostics?: readonly { code: string; message: string }[];
  }) =>
    receipt.diagnostics?.find((item) => item.code === "WIRES_DELETED")?.message;

  it("finds wires and Junctions in a box without the whole Snapshot", async () => {
    const { tool, controller } = await drawn();
    const region = await tool("inspect", {
      target: {
        kind: "region",
        bbox: { x: 90, y: -10, width: 20, height: 20 },
      },
    });
    const junction = controller.document.junctions.find(
      (item) => item.position.x === 100 && item.position.y === 0,
    )!;
    expect(region.junctions).toEqual([
      expect.objectContaining({ id: junction.id, position: { x: 100, y: 0 } }),
    ]);
    expect(region.routeCount).toBeGreaterThan(0);
    for (const route of region.routes) {
      expect(route.netName).toBe("MID");
      expect(route.polyline.length).toBeGreaterThanOrEqual(2);
    }
    const empty = await tool("inspect", {
      target: {
        kind: "region",
        bbox: { x: 1000, y: 1000, width: 10, height: 10 },
      },
    });
    expect(empty).toMatchObject({ routeCount: 0, routes: [], junctions: [] });
  });

  it("deletes a Net's wires, Junctions and label, one part's wires or a box's in one undo each, keeps every part, and refuses a selector that matches nothing", async () => {
    const { client, tool, controller } = await drawn();
    const before = structuredClone(controller.document);
    const ra = before.instances.find((item) => item.reference === "RA")!.id;
    const other = before.routes.filter((route) =>
      [route.start, routeEnd(route)].some(
        (end) => end.kind === "terminal" && end.instanceId === ra,
      ),
    );
    expect(other).toHaveLength(1);
    const labels = before.annotations.filter(
      (item) => item.kind === "net-label",
    );
    expect(labels).toHaveLength(1);
    const label = labels[0];
    const deleted = await client.applyActions([
      { kind: "delete-wires", net: "MID" },
    ]);
    expect(deleted.ok, deleted.message).toBe(true);
    expect(controller.document.revision).toBe(before.revision + 1);
    expect(controller.document.instances.map((item) => item.id)).toEqual(
      before.instances.map((item) => item.id),
    );
    expect(controller.document.routes.map((route) => route.id)).toEqual(
      other.map((route) => route.id),
    );
    expect(controller.document.junctions).toEqual([]);
    expect(
      controller.document.annotations.some((item) => item.id === label!.id),
    ).toBe(false);
    expect(note(deleted)).toBe(
      `Deleted ${before.routes.length - 1} wires, ${before.junctions.length} Junctions and 1 label on Net MID; every part stays.`,
    );
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(controller.document.routes).toEqual(before.routes);
    expect(controller.document.junctions).toEqual(before.junctions);
    expect(controller.document.annotations).toEqual(before.annotations);

    const id = (reference: string) =>
      controller.document.instances.find(
        (item) => item.reference === reference,
      )!.id;
    const wiredTo = (reference: string) =>
      controller.document.routes.filter((route) =>
        [route.start, routeEnd(route)].some(
          (end) => end.kind === "terminal" && end.instanceId === id(reference),
        ),
      );
    expect(wiredTo("RT1")).toHaveLength(1);
    const tap = await tool("apply_actions", {
      actions: [{ kind: "delete-wires", instance: "RT1" }],
    });
    expect(tap.ok, JSON.stringify(tap)).toBe(true);
    // The tap's Junction goes; the trunk it split is one wire again.
    expect(JSON.stringify(tap)).toContain(
      "Deleted 1 wire, 1 Junction and 0 labels on RT1's pins; every part stays.",
    );
    expect(wiredTo("RT1")).toEqual([]);
    expect(wiredTo("RT2")).toHaveLength(1);
    expect(controller.document.instances).toHaveLength(6);
    const revision = controller.document.revision;
    for (const [selector, message] of [
      [{ net: "NOPE" }, 'no Net matches "NOPE"'],
      [{ instance: "RT1" }, "no wire is on RT1's pins"],
      [
        { bbox: { x: 1000, y: 1000, width: 10, height: 10 } },
        "no wire is in the box at (1000, 1000), 10 by 10",
      ],
    ] as const) {
      const refused = await client.applyActions([
        { kind: "delete-wires", ...selector },
      ]);
      expect(refused.ok).toBe(false);
      expect(refused.message).toContain(message);
      expect(refused.message).toContain("nothing was deleted");
    }
    const both = await client.applyActions([
      { kind: "delete-wires", net: "MID", instance: "RA" },
    ]);
    expect(both.ok).toBe(false);
    expect(both.message).toContain("exactly one of net, bbox or instance");
    expect(controller.document.revision).toBe(revision);
    // The box crosses RA–RB's wire only.
    const box = await client.applyActions([
      {
        kind: "delete-wires",
        bbox: { x: 190, y: 390, width: 20, height: 20 },
      },
    ]);
    expect(box.ok, box.message).toBe(true);
    expect(wiredTo("RA")).toEqual([]);
    expect(wiredTo("RL")).toHaveLength(1);
    expect(note(box)).toMatch(
      /^Deleted 1 wire, 0 Junctions and 0 labels in the box/,
    );
  });
});

describe("connect to wire-at", () => {
  async function withResistor() {
    const context = await folder();
    const placed = await context.client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R1",
        position: { x: 100, y: 100 },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const r1 = context.controller.document.instances[0]!.id;
    const wire = {
      kind: "connect",
      from: { kind: "point", x: 0, y: 300 },
      to: { kind: "point", x: 400, y: 300 },
    };
    const tap = (point: { x: number; y: number }) => ({
      kind: "connect",
      from: { kind: "pin", instance: "R1", pin: "2" },
      to: { kind: "wire-at", point },
    });
    // R1's pin 2 shares a Net with a Junction at (200, 300) on the wire.
    const joined = () => {
      const document = context.controller.document;
      const pinNet = document.nets.find((net) =>
        net.terminals.some(
          (terminal) => terminal.instanceId === r1 && terminal.pinName === "2",
        ),
      )?.id;
      return (
        pinNet !== undefined &&
        document.junctions.some(
          (junction) =>
            junction.netId === pinNet &&
            junction.position.x === 200 &&
            junction.position.y === 300,
        )
      );
    };
    return { ...context, wire, tap, joined };
  }

  it("taps a wire a later connect of the same call draws, and still refuses a tap no wire of the call reaches, naming its connect", async () => {
    const { client, controller, wire, tap, joined } = await withResistor();
    const before = structuredClone(controller.document);
    const refused = await client.applyActions([wire, tap({ x: 200, y: 500 })]);
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(
      /^actions\[1\] \(connect\): Wire 2 \(R1\.2 → \(200, 500\)\): No wire at \(200, 500\)/u,
    );
    expect(controller.document).toEqual(before);
    const result = await client.applyActions([tap({ x: 200, y: 300 }), wire]);
    expect(result.ok, result.message).toBe(true);
    expect(controller.document.revision).toBe(before.revision + 1);
    expect(joined()).toBe(true);
  });
});

const routeSymbols = new InMemorySymbolResolver(builtInSymbols);
function drawnPaths(document: EditorDocumentController["document"]) {
  return document.routes.map((route) =>
    resolveRouteGeometry(document, routeSymbols, route)!.centerline.map(
      ({ x, y }) => [x, y],
    ),
  );
}
/** Each Net by its pins, as the netlist joins them. */
function netsByPins(document: EditorDocumentController["document"]) {
  const refs = new Map(document.instances.map((v) => [v.id, v.reference]));
  return document.nets
    .map((net) =>
      net.terminals
        .map((t) => `${refs.get(t.instanceId)}.${t.pinName}`)
        .sort()
        .join(" "),
    )
    .sort();
}
function wireNotes(result: {
  diagnosticDelta?: { added?: readonly unknown[] | undefined } | undefined;
}) {
  return (result.diagnosticDelta?.added ?? []).filter((diagnostic) =>
    String((diagnostic as { code: string }).code).startsWith("WIRE_"),
  );
}

describe("wires the editor routes say what they went round", () => {
  /** Two 3-terminal PMOS side by side, sources up on a VDD rail. */
  async function pmosPair() {
    const context = await folder();
    for (const actions of [
      [
        {
          kind: "place-component",
          symbol: "pmos",
          reference: "M1",
          position: { x: 100, y: 100 },
        },
        {
          kind: "place-component",
          symbol: "pmos",
          reference: "M2",
          position: { x: 200, y: 100 },
        },
      ],
      [
        {
          kind: "add-power-rail",
          start: { x: 0, y: 40 },
          end: { x: 300, y: 40 },
          name: "VDD",
        },
      ],
      ["M1", "M2"].map((instance) => ({
        kind: "connect",
        from: { kind: "pin", instance, pin: "S" },
        to: { kind: "net", net: "VDD" },
      })),
    ]) {
      const result = await context.client.applyActions(actions);
      expect(result.ok, result.message).toBe(true);
    }
    const gates = () =>
      netsByPins(context.controller.document).filter((net) =>
        net.includes("M1.G"),
      );
    return { ...context, gates };
  }
  const gateLine = {
    kind: "connect",
    from: { kind: "pin", instance: "M1", pin: "G" },
    to: { kind: "pin", instance: "M2", pin: "G" },
  };

  it("names the part a gate line went round, and goes the side that crosses no source wire", async () => {
    const { client, controller, gates } = await pmosPair();
    const result = await client.applyActions([gateLine]);
    expect(result.ok, result.message).toBe(true);
    // Above, the line would cross M1's source wire to VDD.
    expect(drawnPaths(controller.document).at(-1)).toEqual([
      [80, 100],
      [80, 130],
      [180, 130],
      [180, 100],
    ]);
    expect(wireNotes(result)).toEqual([
      expect.objectContaining({
        code: "WIRE_DETOURED",
        message:
          "Wire 1: the direct path passes through M1 between (80, 100) and (180, 100), so it goes round through (80, 130), (180, 130)",
      }),
    ]);
    expect(gates()).toEqual(["M1.G M2.G"]);
  });

  it("names each crossing of another Net's wire", async () => {
    const { client, controller } = await folder();
    for (const actions of [
      [0, 400].map((x, index) => ({
        kind: "place-component",
        symbol: "resistor",
        reference: `R${index + 1}`,
        position: { x, y: 0 },
        rotation: 270,
      })),
      [
        {
          kind: "connect",
          from: { kind: "point", x: 200, y: -100 },
          to: { kind: "point", x: 200, y: 100 },
        },
      ],
    ]) {
      const result = await client.applyActions(actions);
      expect(result.ok, result.message).toBe(true);
    }
    const crossed = controller.document.routes[0]!;
    const result = await client.applyActions([
      {
        kind: "connect",
        from: { kind: "pin", instance: "R1", pin: "2" },
        to: { kind: "pin", instance: "R2", pin: "1" },
      },
    ]);
    expect(result.ok, result.message).toBe(true);
    expect(wireNotes(result)).toEqual([
      expect.objectContaining({
        code: "WIRE_CROSSES",
        message: expect.stringMatching(
          new RegExp(
            `^Wire 1: it crosses Route ${crossed.id} of Net .+ at \\(200, 0\\), without a dot: a crossing joins nothing$`,
          ),
        ),
        objectIds: [crossed.id],
      }),
    ]);
    expect(netsByPins(controller.document)).toContain("R1.2 R2.1");
  });
});

describe("route-net avoid", () => {
  /** R1.2 at (20, 0) and R2.1 at (380, 0) in line, with `between` on it. */
  async function inLine(between: Record<string, unknown>[]) {
    const context = await folder();
    const placed = await context.client.applyActions([
      ...[0, 400].map((x, index) => ({
        kind: "place-component",
        symbol: "resistor",
        reference: `R${index + 1}`,
        position: { x, y: 0 },
        rotation: 270,
      })),
      ...between,
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const id = (reference: string) =>
      context.controller.document.instances.find(
        (instance) => instance.reference === reference,
      )!.id;
    const route = (options: Record<string, unknown> = {}) =>
      context.client.applyActions([
        {
          kind: "route-net",
          target: {
            kind: "pins",
            pins: [
              { instanceId: id("R1"), pinName: "2" },
              { instanceId: id("R2"), pinName: "1" },
            ],
          },
          ...options,
        },
      ]);
    // Which end a wire starts from follows generated IDs: read it from R1.
    const drawn = () =>
      drawnPaths(context.controller.document).map((path) =>
        path[0]![0]! > path.at(-1)![0]! ? path.reverse() : path,
      );
    const nets = () => netsByPins(context.controller.document);
    return { ...context, route, drawn, nets };
  }

  it("goes round a part on the straight line and its label", async () => {
    const { route, drawn, nets } = await inLine([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R3",
        position: { x: 200, y: 0 },
        rotation: 270,
      },
    ]);
    const result = await route({ avoid: true });
    expect(result.ok, result.message).toBe(true);
    // R3's name stands above it, where the plain detour runs.
    expect(drawn()).toEqual([
      [
        [20, 0],
        [20, 10],
        [380, 10],
        [380, 0],
      ],
    ]);
    expect(nets()).toContain("R1.2 R2.1");
  });

  it("keeps a free text clear only when asked", async () => {
    const { client, route, drawn } = await inLine([]);
    const text = await client.applyActions([
      { kind: "annotate", text: "NOTE TEXT", position: { x: 200, y: 0 } },
    ]);
    expect(text.ok, text.message).toBe(true);
    expect((await route()).ok).toBe(true);
    expect(drawn()).toEqual([
      [
        [20, 0],
        [380, 0],
      ],
    ]);
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(drawn()).toEqual([]);
    expect((await route({ avoid: true })).ok).toBe(true);
    expect(drawn()).toHaveLength(1);
    expect(drawn()[0]).not.toEqual([
      [20, 0],
      [380, 0],
    ]);
  });

  it("taps an earlier branch a later one going round would cross", async () => {
    // R4.1's branch round R5.1 to the trunk crossed R1.2's at (-100, 60),
    // with no dot.
    const { client, controller } = await folder();
    const placed = await client.applyActions(
      (
        [
          ["R1", -80, 80, 90],
          ["R4", -120, 80, 0],
          ["R5", -120, 40, 90],
        ] as const
      ).map(([reference, x, y, rotation]) => ({
        kind: "place-component",
        symbol: "resistor",
        reference,
        position: { x, y },
        rotation,
      })),
    );
    expect(placed.ok, placed.message).toBe(true);
    const id = (reference: string) =>
      controller.document.instances.find(
        (instance) => instance.reference === reference,
      )!.id;
    const routed = await client.applyActions([
      {
        kind: "route-net",
        target: {
          kind: "pins",
          pins: [
            { instanceId: id("R1"), pinName: "2" },
            { instanceId: id("R4"), pinName: "1" },
            { instanceId: id("R5"), pinName: "1" },
          ],
        },
        trunk: { start: { x: -300, y: 0 }, end: { x: 300, y: 0 } },
        avoid: true,
      },
    ]);
    expect(routed.ok, routed.message).toBe(true);
    expect(netsByPins(controller.document)).toEqual(["R1.2 R4.1 R5.1"]);
    // R4.1 (-120, 60) ends on R1.2's branch, at a dot.
    expect(drawnPaths(controller.document)).toContainEqual([
      [-120, 60],
      [-100, 60],
    ]);
    expect(
      controller.document.junctions.map(({ position }) => position),
    ).toContainEqual({ x: -100, y: 60 });
  });

  it("searches round a wall the simple shapes cannot clear, on the side preferred, and refuses naming the pins when nothing goes round", async () => {
    // Capacitors at x = 200 from y = -100 to 100: past the simple shapes'
    // reach, inside the search's.
    const { route, drawn, nets, controller } = await inLine(
      [-100, -50, 0, 50, 100].map((y, index) => ({
        kind: "place-component",
        symbol: "capacitor",
        reference: `C${index}`,
        position: { x: 200, y },
      })),
    );
    const before = structuredClone(controller.document);
    const refused = await route();
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(
      /no clear path from (R1\.2 to R2\.1|R2\.1 to R1\.2): the direct one passes through C2/,
    );
    expect(controller.document).toEqual(before);
    const result = await route({ avoid: true, prefer: "above" });
    expect(result.ok, result.message).toBe(true);
    const [path] = drawn();
    expect(Math.min(...path!.map(([, y]) => y!))).toBeLessThan(-100);
    expect(Math.max(...path!.map(([, y]) => y!))).toBe(0);
    expect(nets()).toContain("R1.2 R2.1");
    expect(nets().filter((net) => net.includes("C"))).toEqual([]);

    // Thirteen capacitors: past the search's reach too.
    const wide = await inLine(
      Array.from({ length: 13 }, (_, index) => ({
        kind: "place-component",
        symbol: "capacitor",
        reference: `C${index}`,
        position: { x: 200, y: (index - 6) * 50 },
      })),
    );
    const walled = structuredClone(wide.controller.document);
    const none = await wide.route({ avoid: true });
    expect(none.ok).toBe(false);
    expect(none.message).toMatch(
      /no clear path from (R1\.2 to R2\.1|R2\.1 to R1\.2): the direct one passes through C6/,
    );
    expect(none.message).toContain("none goes round within 16 grid squares");
    expect(wide.controller.document).toEqual(walled);
  });
});

describe("relocate", () => {
  const pin = (instance: string, name: string) => ({
    kind: "pin",
    instance,
    pin: name,
  });
  const spice = (project: CircuitProject) => {
    const exported = createDesignNetlistExport(project, { format: "spice" });
    expect(exported.status, JSON.stringify(exported)).toBe("ready");
    return exported.status === "ready" ? exported.file.text : "";
  };
  /** Each Net as its name and its pins by Reference, sorted. */
  const nets = (document: CircuitProject["documents"][number]) => {
    const reference = (id: string) =>
      document.instances.find((item) => item.id === id)?.reference ?? id;
    return resolveDocumentLogicalNets(document)
      .groups.map(
        (group) =>
          `${group.name ?? "?"}: ${document.nets
            .filter((net) => group.baseNetIds.includes(net.id))
            .flatMap((net) =>
              net.terminals.map(
                (terminal) =>
                  `${reference(terminal.instanceId)}.${terminal.pinName}`,
              ),
            )
            .sort()
            .join(" ")}`,
      )
      .sort();
  };
  const wiredPins = (document: CircuitProject["documents"][number]) =>
    new Set(
      document.routes.flatMap((route) =>
        [route.start, routeEnd(route)].flatMap((end) =>
          end.kind === "terminal" ? [`${end.instanceId}:${end.pinName}`] : [],
        ),
      ),
    );

  /** Two arms, RA under RLA and RB under RLB, on one tail RT to ground. */
  async function pair() {
    const parts = await folder();
    const { client } = parts;
    const placed = await client.applyActions([
      ...(
        [
          ["RLA", 0, 0],
          ["RLB", 200, 0],
          ["RA", 0, 200],
          ["RB", 200, 200],
          ["RT", 100, 400],
        ] as const
      ).map(([reference, x, y]) => ({
        kind: "place-component",
        symbol: "resistor",
        reference,
        position: { x, y },
      })),
      {
        kind: "place-component",
        symbol: "vdd-port",
        id: "vdda",
        pinAnchor: { pinName: "P", position: { x: 0, y: -20 } },
      },
      {
        kind: "place-component",
        symbol: "vdd-port",
        id: "vddb",
        pinAnchor: { pinName: "P", position: { x: 200, y: -20 } },
      },
      {
        kind: "place-component",
        symbol: "ground",
        id: "gnd",
        pinAnchor: { pinName: "0", position: { x: 100, y: 420 } },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const wired = await client.applyActions([
      { kind: "connect", from: pin("RLA", "2"), to: pin("RA", "1") },
      { kind: "connect", from: pin("RLB", "2"), to: pin("RB", "1") },
      { kind: "connect", from: pin("RA", "2"), to: pin("RB", "2") },
      {
        kind: "connect",
        from: pin("RT", "1"),
        to: { kind: "wire-at", point: { x: 100, y: 220 } },
      },
    ]);
    expect(wired.ok, wired.message).toBe(true);
    const labelled = await client.applyActions([
      {
        kind: "add-label",
        target: pin("RLA", "2"),
        text: "OUTA",
        position: { x: 0, y: 100 },
      },
      {
        kind: "add-label",
        target: pin("RLB", "2"),
        text: "OUTB",
        position: { x: 200, y: 100 },
      },
    ]);
    expect(labelled.ok, labelled.message).toBe(true);
    return parts;
  }

  it("swaps two parts, redraws their wires and keeps every Net and the netlist, in one undo", async () => {
    const { tool, controller, client } = await pair();
    const before = structuredClone(controller.document);
    const netlist = spice(controller.project);
    const relocated = await tool("circuit_wire", {
      actions: [
        {
          kind: "relocate",
          parts: [
            {
              instance: "RA",
              position: { x: 200, y: 200 },
              mirror: "horizontal",
            },
            {
              instance: "RB",
              position: { x: 0, y: 200 },
              mirror: "horizontal",
            },
          ],
        },
      ],
    });
    expect(relocated.ok, JSON.stringify(relocated)).toBe(true);
    expect(JSON.stringify(relocated)).toContain("Relocated RA, RB");
    const after = controller.document;
    const at = (reference: string) =>
      after.instances.find((item) => item.reference === reference)!.placement;
    expect(at("RA")).toEqual({
      position: { x: 200, y: 200 },
      rotation: 0,
      mirror: "horizontal",
    });
    expect(at("RB")).toEqual({
      position: { x: 0, y: 200 },
      rotation: 0,
      mirror: "horizontal",
    });
    expect(nets(after)).toEqual(nets(before));
    expect(spice(controller.project)).toBe(netlist);
    // Every pin that had a wire has one again; the labels stand on wires.
    const wired = wiredPins(after);
    for (const key of wiredPins(before)) expect(wired).toContain(key);
    for (const label of before.annotations.filter(
      (item) => item.kind === "net-label",
    ))
      expect(
        after.annotations.find((item) => item.id === label.id)?.anchor.kind,
      ).toBe("route");
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(controller.document.instances).toEqual(before.instances);
    expect(controller.document.routes).toEqual(before.routes);
    expect(controller.document.annotations).toEqual(before.annotations);
    expect(controller.document.nets).toEqual(before.nets);
  });

  it("takes a ground standing on a pin and a labelled stub along, turned or mirrored with the part", async () => {
    const { client, controller } = await pair();
    const placed = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "RX",
        position: { x: 600, y: 0 },
      },
      {
        kind: "place-component",
        symbol: "ground",
        id: "gx",
        pinAnchor: { pinName: "0", position: { x: 600, y: 20 } },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const stub = await client.applyActions([
      {
        kind: "connect",
        from: pin("RX", "1"),
        to: { kind: "point", x: 600, y: -60 },
      },
    ]);
    expect(stub.ok, stub.message).toBe(true);
    const labelled = await client.applyActions([
      {
        kind: "add-label",
        target: pin("RX", "1"),
        text: "SIG",
        position: { x: 600, y: -50 },
      },
    ]);
    expect(labelled.ok, labelled.message).toBe(true);
    const before = structuredClone(controller.document);
    const netlist = spice(controller.project);
    const rx = before.instances.find((item) => item.reference === "RX")!.id;
    const sig = before.annotations.find(
      (item) =>
        item.kind === "net-label" &&
        resolveDocumentLogicalNets(before).byBaseNetId.get(item.netId!)
          ?.name === "SIG",
    )!;
    const relocated = await client.applyActions([
      {
        kind: "relocate",
        parts: [{ instance: "RX", position: { x: 800, y: 100 }, rotation: 90 }],
      },
    ]);
    expect(relocated.ok, relocated.message).toBe(true);
    const after = controller.document;
    expect(nets(after)).toEqual(nets(before));
    expect(spice(controller.project)).toBe(netlist);
    // The ground went with pin 2 and still stands on it.
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const contact = (instanceId: string, pinName: string) =>
      resolveEndpointConnection(after, resolver, {
        kind: "terminal",
        instanceId,
        pinName,
      })!.contactPoint;
    expect(contact("gx", "0")).toEqual(contact(rx, "2"));
    // The stub still leaves pin 1, turned with it, with SIG on it.
    const wire = after.routes.find((route) =>
      [route.start, routeEnd(route)].some(
        (end) =>
          end.kind === "terminal" &&
          end.instanceId === rx &&
          end.pinName === "1",
      ),
    );
    expect(wire).toBeDefined();
    expect(
      after.annotations.find((item) => item.id === sig.id)?.anchor,
    ).toMatchObject({ kind: "route", routeId: wire!.id });

    // RY's stub leaves pin 1 up and off to the right: a lateral part a mirror
    // flips.
    const ry = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "RY",
        position: { x: 1000, y: 0 },
      },
    ]);
    expect(ry.ok, ry.message).toBe(true);
    const lateral = await client.applyActions([
      {
        kind: "connect",
        from: pin("RY", "1"),
        to: { kind: "point", x: 1040, y: -60 },
      },
    ]);
    expect(lateral.ok, lateral.message).toBe(true);
    const unmirrored = structuredClone(controller.document);
    const [junction] = unmirrored.junctions.filter((item) =>
      unmirrored.routes.some(
        (route) =>
          [route.start, routeEnd(route)].some(
            (end) => end.kind === "junction" && end.junctionId === item.id,
          ) &&
          [route.start, routeEnd(route)].some(
            (end) =>
              end.kind === "terminal" &&
              unmirrored.instances.find((part) => part.id === end.instanceId)
                ?.reference === "RY",
          ),
      ),
    );
    expect(junction?.position).toEqual({ x: 1040, y: -60 });
    const mirrored = await client.applyActions([
      {
        kind: "relocate",
        parts: [
          { instance: "RY", position: { x: 1200, y: 0 }, mirror: "horizontal" },
        ],
      },
    ]);
    expect(mirrored.ok, mirrored.message).toBe(true);
    expect(
      controller.document.junctions.find((item) => item.id === junction!.id)
        ?.position,
    ).toEqual({ x: 1160, y: -60 });
    expect(nets(controller.document)).toEqual(nets(unmirrored));
  });

  it("refuses a part it cannot name, one named twice, or a place off the grid, and changes nothing", async () => {
    const { client, controller } = await pair();
    const revision = controller.document.revision;
    for (const [parts, message] of [
      [
        [{ instance: "NOPE", position: { x: 0, y: 0 } }],
        'no instance matches Reference or ID "NOPE"',
      ],
      [
        [
          { instance: "RA", position: { x: 0, y: 600 } },
          { instance: "RA", position: { x: 0, y: 800 } },
        ],
        "each part may be named once",
      ],
      [[{ instance: "RA", position: { x: 3, y: 600 } }], "moving the parts"],
    ] as const) {
      const refused = await client.applyActions([{ kind: "relocate", parts }]);
      expect(refused.ok).toBe(false);
      expect(refused.message).toContain(message);
      expect(refused.message).toContain("nothing was moved");
    }
    expect(controller.document.revision).toBe(revision);
    const same = await client.applyActions([
      {
        kind: "relocate",
        parts: [{ instance: "RA", position: { x: 0, y: 200 } }],
      },
    ]);
    expect(same.ok, same.message).toBe(true);
    expect(controller.document.revision).toBe(revision);
  });

  it("says when a moved pin lands on another Net's wire, joining nothing, and refuses a stub that would come to rest on one", async () => {
    const { client, controller } = await pair();
    const placed = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "RX",
        position: { x: 600, y: 0 },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const before = structuredClone(controller.document);
    const outb = before.routes.find(
      (route) =>
        resolveDocumentLogicalNets(before).byBaseNetId.get(route.netId)
          ?.name === "OUTB",
    )!;
    // Turned across the OUTB wire at x = 200: pin 2 at (200, 100).
    const relocated = await client.applyActions([
      {
        kind: "relocate",
        parts: [{ instance: "RX", position: { x: 220, y: 100 }, rotation: 90 }],
      },
    ]);
    expect(relocated.ok, relocated.message).toBe(true);
    const rx = controller.document.instances.find(
      (item) => item.reference === "RX",
    )!.id;
    expect(relocated.diagnosticDelta?.added).toContainEqual(
      expect.objectContaining({
        code: "LANDED_ON_OTHER_NET",
        message: expect.stringContaining(
          `RX now touches another Net at pin 2 (Route ${outb.id} of Net OUTB)`,
        ),
        objectIds: [rx, outb.id],
      }),
    );
    expect(nets(controller.document)).toEqual(nets(before));
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);

    const stub = await client.applyActions([
      {
        kind: "connect",
        from: pin("RX", "1"),
        to: { kind: "point", x: 600, y: -60 },
      },
    ]);
    expect(stub.ok, stub.message).toBe(true);
    const revision = controller.document.revision;
    // Turned right, pin 1 at (160, 100): the stub's end at (200, 100), on
    // the OUTB wire.
    const refused = await client.applyActions([
      {
        kind: "relocate",
        parts: [{ instance: "RX", position: { x: 140, y: 100 }, rotation: 90 }],
      },
    ]);
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(
      /the wire hanging from RX\.1 .*Net OUTB.*nothing was moved/u,
    );
    expect(controller.document.revision).toBe(revision);
  });

  /** R1 wired to R2 below it; a wall of `count` capacitors at x = 200. */
  async function walled(count: number) {
    const parts = await folder();
    const placed = await parts.client.applyActions([
      ...(
        [
          ["R1", 0, 0],
          ["R2", 100, 300],
        ] as const
      ).map(([reference, x, y]) => ({
        kind: "place-component",
        symbol: "resistor",
        reference,
        position: { x, y },
        rotation: 270,
      })),
      ...Array.from({ length: count }, (_, index) => ({
        kind: "place-component",
        symbol: "capacitor",
        reference: `C${index}`,
        position: { x: 200, y: (index - Math.floor(count / 2)) * 50 },
      })),
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const wired = await parts.client.applyActions([
      { kind: "connect", from: pin("R1", "2"), to: pin("R2", "1") },
    ]);
    expect(wired.ok, wired.message).toBe(true);
    return parts;
  }

  it("goes round the parts when no simple path is clear, and refuses naming both pins and what is in the way when none is", async () => {
    const { client, controller } = await walled(5);
    const before = structuredClone(controller.document);
    const relocated = await client.applyActions([
      {
        kind: "relocate",
        parts: [{ instance: "R2", position: { x: 400, y: 0 } }],
      },
    ]);
    expect(relocated.ok, relocated.message).toBe(true);
    expect(nets(controller.document)).toEqual(nets(before));
    const [path] = drawnPaths(controller.document);
    expect(Math.max(...path!.map(([, y]) => Math.abs(y!)))).toBeGreaterThan(
      100,
    );

    const wide = await walled(13);
    const revision = wide.controller.document.revision;
    const refused = await wide.client.applyActions([
      {
        kind: "relocate",
        parts: [{ instance: "R2", position: { x: 400, y: 0 } }],
      },
    ]);
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(
      /the connection of (R1\.2, R2\.1|R2\.1, R1\.2) cannot be redrawn: no clear path from (R1\.2 to R2\.1|R2\.1 to R1\.2): the direct one passes through C6/u,
    );
    expect(refused.message).toContain("none goes round");
    expect(refused.message).toContain("nothing was moved");
    expect(wide.controller.document.revision).toBe(revision);
  });
});
