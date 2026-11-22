import { describe, expect, it } from "vitest";
import { projectCellInterface, type CircuitProject } from "@icm/model";
import {
  createLabelClearanceContext,
  derivePowerRailComponent,
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
} from "@icm/derived";
import { createDesignNetlistExport } from "@icm/netlist";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { netlistChange } from "./draft-steps";
import { folder } from "./agent-parity.test-support";

it("uses local supply rails by default, preserves explicit global and rejects diagonals atomically", async () => {
  const { client, controller } = await folder();
  for (const [name, scope, y] of [
    ["VDD", undefined, 100],
    ["AVDD", "global", 200],
  ] as const) {
    const report = await client.applyActions([
      {
        kind: "add-power-rail",
        name,
        ...(scope ? { scope } : {}),
        start: { x: 100, y },
        end: { x: 300, y },
      },
    ]);
    expect(report.ok, report.message).toBe(true);
    const net = [
      ...resolveDocumentLogicalNets(controller.document).byBaseNetId.values(),
    ].find((n) => n.name === name);
    expect(net?.scope).toBe(scope ?? "local");
  }
  const before = structuredClone(controller.project);
  const report = await client.applyActions([
    { kind: "add-power-rail", start: { x: 0, y: 0 }, end: { x: 100, y: 20 } },
  ]);
  expect(report.ok).toBe(false);
  expect(report.message).toContain("horizontal or vertical");
  expect(controller.project).toEqual(before);
  // Ground is drawn with ground symbols, not as a second Net named GND.
  const ground = await client.applyActions([
    {
      kind: "add-power-rail",
      name: "GND",
      start: { x: 100, y: 400 },
      end: { x: 300, y: 400 },
    },
  ]);
  expect(ground.ok).toBe(false);
  expect(ground.message).toContain("ground symbols");
  expect(controller.project).toEqual(before);
});

it("joins pins a rail runs over only when asked, and names them otherwise (#2429)", async () => {
  const { client, controller } = await folder();
  expect(
    (
      await client.applyActions([
        {
          kind: "place-component",
          symbol: "resistor",
          reference: "R1",
          position: { x: 380, y: 320 },
        },
      ])
    ).ok,
  ).toBe(true);
  const r1 = controller.document.instances[0]!.id;
  const railNet = () =>
    controller.document.routes.find(
      (route) => route.presentation === "power-rail",
    )?.netId;
  const pinNet = () =>
    controller.document.nets.find((net) =>
      net.terminals.some(
        (terminal) => terminal.instanceId === r1 && terminal.pinName === "1",
      ),
    )?.id;
  const rail = { start: { x: 300, y: 300 }, end: { x: 460, y: 300 } };
  const apart = await client.applyActions([
    { kind: "add-power-rail", ...rail },
  ]);
  expect(apart.ok, apart.message).toBe(true);
  expect(pinNet()).not.toBe(railNet());
  expect(apart.diagnosticDelta?.added).toContainEqual(
    expect.objectContaining({
      code: "RAIL_OVER_UNJOINED_PIN",
      objectIds: [r1],
    }),
  );
  expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
  const joined = await client.applyActions([
    { kind: "add-power-rail", ...rail, joinPins: true },
  ]);
  expect(joined.ok, joined.message).toBe(true);
  expect(pinNet()).toBe(railNet());
});

it("extends a Power Rail instead of doubling it, keeping its taps and its one label", async () => {
  const { client, controller, tool } = await folder();
  const at = (x: number) => ({ x, y: 240 });
  expect(
    (
      await client.applyActions([
        { kind: "add-power-rail", start: at(300), end: at(460) },
      ])
    ).ok,
  ).toBe(true);
  // R1 taps the rail from below, at x = 380.
  expect(
    (
      await client.applyActions([
        {
          kind: "place-component",
          symbol: "resistor",
          reference: "R1",
          position: { x: 380, y: 320 },
        },
      ])
    ).ok,
  ).toBe(true);
  const railId = () =>
    controller.document.routes.find(
      (route) => route.presentation === "power-rail",
    )!.id;
  const tapped = await client.applyActions([
    {
      kind: "connect",
      from: { kind: "pin", instance: "R1", pin: "1" },
      to: { kind: "wire-at", point: at(380) },
    },
  ]);
  expect(tapped.ok, tapped.message).toBe(true);
  const span = () => {
    const component = derivePowerRailComponent(controller.document, railId())!;
    const position = (id: string) =>
      controller.document.junctions.find((junction) => junction.id === id)!
        .position;
    return {
      ends: component.endpointJunctionIds
        .map((id) => position(id).x)
        .sort((left, right) => left - right),
      taps: component.junctionIds
        .filter((id) => !component.endpointJunctionIds.includes(id))
        .map(position),
    };
  };
  expect(span()).toEqual({ ends: [300, 460], taps: [at(380)] });
  const labels = () =>
    controller.document.annotations.filter(
      (annotation) => annotation.kind === "power-label",
    );
  expect(labels()).toHaveLength(1);

  // Before: a second rail over the first, with a second V_DD label.
  const wider = await client.applyActions([
    { kind: "add-power-rail", start: at(190), end: at(560) },
  ]);
  expect(wider.ok, wider.message).toBe(true);
  expect(span()).toEqual({ ends: [190, 560], taps: [at(380)] });
  expect(labels()).toHaveLength(1);

  const extended = await tool("circuit_transform", {
    actions: [
      {
        kind: "extend-power-rail",
        routeId: railId(),
        start: at(100),
        end: at(560),
      },
    ],
  });
  expect(extended.ok, extended.message).toBe(true);
  expect(span()).toEqual({ ends: [100, 560], taps: [at(380)] });

  const shrunk = await client.applyActions([
    {
      kind: "extend-power-rail",
      routeId: railId(),
      start: at(400),
      end: at(560),
    },
  ]);
  expect(shrunk.ok).toBe(false);
  expect(shrunk.message).toContain("would fall off the rail");
  expect(span()).toEqual({ ends: [100, 560], taps: [at(380)] });
});

describe("render-net-as", () => {
  const pin = (instance: string, name: string) => ({
    kind: "pin",
    instance,
    pin: name,
  });
  /** A marker's pin, by the ID it was placed with. */
  const markerPin = (id: string, name: string) => ({
    kind: "pin",
    instance: { kind: "instance", id },
    pin: name,
  });
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const spice = (project: CircuitProject) => {
    const exported = createDesignNetlistExport(project, { format: "spice" });
    expect(exported.status, JSON.stringify(exported)).toBe("ready");
    return exported.status === "ready" ? exported.file.text : "";
  };
  type Cell = CircuitProject["documents"][number];
  /** Each Net with its name, scope and pins by Reference, new markers left out. */
  const nets = (document: Cell, skip: ReadonlySet<string> = new Set()) => {
    const reference = (id: string) =>
      document.instances.find((item) => item.id === id)?.reference ?? id;
    return resolveDocumentLogicalNets(document)
      .groups.map((group) => ({
        name: `${group.name ?? "?"} ${group.scope ?? ""}`,
        pins: document.nets
          .filter((net) => group.baseNetIds.includes(net.id))
          .flatMap((net) => net.terminals)
          .filter((terminal) => !skip.has(terminal.instanceId))
          .map(
            (terminal) =>
              `${reference(terminal.instanceId)}.${terminal.pinName}`,
          )
          .sort()
          .join(" "),
      }))
      .filter((net) => net.pins)
      .map((net) => `${net.name}: ${net.pins}`)
      .sort();
  };
  const ports = (document: Cell) =>
    projectCellInterface(document.netlist).ports.map(
      (port) => `${port.name} ${port.direction}`,
    );
  const contact = (document: Cell, instanceId: string, pinName: string) =>
    resolveEndpointConnection(document, resolver, {
      kind: "terminal",
      instanceId,
      pinName,
    })!.contactPoint;

  /** RA and RB between a VDD Cell Pin and a VSS named ground, both wired. */
  async function supplies() {
    const parts = await folder();
    const { client } = parts;
    const placed = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "RA",
        position: { x: 0, y: 0 },
      },
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "RB",
        position: { x: 200, y: 0 },
      },
      {
        kind: "place-component",
        symbol: "vdd-port",
        id: "vdd",
        position: { x: 100, y: -200 },
      },
      {
        kind: "place-component",
        symbol: "named-ground",
        id: "vss",
        reference: "VSS",
        position: { x: 100, y: 200 },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const wired = await client.applyActions([
      {
        kind: "connect",
        from: pin("RA", "1"),
        to: markerPin("vdd", "P"),
      },
      { kind: "connect", from: pin("RB", "1"), to: pin("RA", "1") },
      {
        kind: "connect",
        from: pin("RA", "2"),
        to: markerPin("vss", "P"),
      },
      { kind: "connect", from: pin("RB", "2"), to: pin("RA", "2") },
    ]);
    expect(wired.ok, wired.message).toBe(true);
    return parts;
  }

  it("draws a Cell Pin's ground as a named ground on each pin, deletes its wires and keeps the Port and the netlist, in one undo", async () => {
    const { tool, controller, client } = await supplies();
    const before = structuredClone(controller.document);
    const netlist = spice(controller.project);
    const rendered = await tool("circuit_place", {
      actions: [{ kind: "render-net-as", net: "VSS", as: "ground" }],
    });
    expect(rendered.ok, JSON.stringify(rendered)).toBe(true);
    expect(JSON.stringify(rendered)).toContain(
      "Drew VSS as 2 named grounds on its pins and deleted its",
    );
    // The named ground wired to VSS before stands alone now and goes; VSS
    // keeps its Port through the new markers.
    expect(JSON.stringify(rendered)).toContain(
      "removed 1 old marker left touching nothing of it; it stays a Cell Pin",
    );
    const after = controller.document;
    expect(after.instances.some((item) => item.id === "vss")).toBe(false);
    const added = after.instances.filter(
      (item) => !before.instances.some((old) => old.id === item.id),
    );
    expect(added.map((item) => item.symbolId)).toEqual([
      "named-ground",
      "named-ground",
    ]);
    // Each stands on its pin, below it, the glyph away from the resistor.
    const reference = (name: string) =>
      after.instances.find((item) => item.reference === name)!.id;
    const standing = ["RA", "RB"].map((name) =>
      added.find(
        (marker) =>
          JSON.stringify(contact(after, marker.id, "P")) ===
          JSON.stringify(contact(after, reference(name), "2")),
      ),
    );
    expect(standing.every(Boolean)).toBe(true);
    for (const marker of standing) expect(marker!.placement!.rotation).toBe(0);
    // No wire of VSS is left; VDD's stay.
    const vss = resolveDocumentLogicalNets(after).groups.find(
      (group) => group.name === "VSS",
    )!;
    expect(
      after.routes.filter((route) => vss.baseNetIds.includes(route.netId)),
    ).toEqual([]);
    const vddWires = (document: Cell) => {
      const vdd = resolveDocumentLogicalNets(document).groups.find(
        (group) => group.name === "VDD",
      )!;
      return document.routes.filter((route) =>
        vdd.baseNetIds.includes(route.netId),
      );
    };
    expect(vddWires(before).length).toBeGreaterThan(0);
    expect(vddWires(after)).toEqual(vddWires(before));
    expect(nets(after, new Set(added.map((item) => item.id)))).toEqual(
      nets(before, new Set(["vss"])),
    );
    expect(ports(after)).toEqual(ports(before));
    expect(spice(controller.project)).toBe(netlist);
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(controller.document.instances).toEqual(before.instances);
    expect(controller.document.routes).toEqual(before.routes);
    expect(controller.document.netlist).toEqual(before.netlist);
  });

  it("keeps a Cell Pin first among the Cell's Pins when its old marker goes", async () => {
    const { controller, client } = await supplies();
    const before = structuredClone(controller.document);
    const netlist = spice(controller.project);
    const rendered = await client.applyActions([
      { kind: "render-net-as", net: "VDD", as: "supply" },
    ]);
    expect(rendered.ok, rendered.message).toBe(true);
    expect(JSON.stringify(rendered)).toContain("removed 1 old marker");
    expect(
      controller.document.instances.some((item) => item.id === "vdd"),
    ).toBe(false);
    expect(ports(controller.document)).toEqual(ports(before));
    expect(spice(controller.project)).toBe(netlist);
  });

  it("draws a global supply as supply markers above its pins, and node 0 as plain grounds", async () => {
    const { controller, client } = await supplies();
    const global = await client.applyActions([
      { kind: "set-vdd-mode", instanceId: "vdd", mode: "global" },
    ]);
    expect(global.ok, global.message).toBe(true);
    const placed = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "RC",
        position: { x: 400, y: 0 },
      },
      {
        kind: "place-component",
        symbol: "ground",
        id: "g0",
        position: { x: 400, y: 200 },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const tied = await client.applyActions([
      {
        kind: "connect",
        from: pin("RC", "2"),
        to: markerPin("g0", "0"),
      },
      { kind: "connect", from: pin("RC", "1"), to: pin("RB", "1") },
    ]);
    expect(tied.ok, tied.message).toBe(true);
    const before = structuredClone(controller.document);
    const netlist = spice(controller.project);
    const rendered = await client.applyActions([
      { kind: "render-net-as", net: "VDD", as: "supply" },
    ]);
    expect(rendered.ok, rendered.message).toBe(true);
    const grounded = await client.applyActions([
      { kind: "render-net-as", net: "0", as: "ground" },
    ]);
    expect(grounded.ok, grounded.message).toBe(true);
    const after = controller.document;
    const added = after.instances.filter(
      (item) => !before.instances.some((old) => old.id === item.id),
    );
    expect(added.map((item) => item.symbolId).sort()).toEqual([
      "ground",
      "vdd-port",
      "vdd-port",
      "vdd-port",
    ]);
    for (const marker of added.filter((item) => item.symbolId === "vdd-port"))
      expect(marker.placement!.rotation).toBe(0);
    // The supply marker and the ground wired to them before went.
    expect(JSON.stringify(rendered)).toContain("removed 1 old marker");
    expect(JSON.stringify(rendered)).toContain("it stays global");
    expect(JSON.stringify(grounded)).toContain("it stays node 0");
    for (const old of ["vdd", "g0"])
      expect(after.instances.some((item) => item.id === old)).toBe(false);
    expect(nets(after, new Set(added.map((item) => item.id)))).toEqual(
      nets(before, new Set(["vdd", "g0"])),
    );
    expect(ports(after)).toEqual(ports(before));
    expect(spice(controller.project)).toBe(netlist);
  });

  it("refuses a Net it cannot find, one with no name, and supply for node 0, changing nothing", async () => {
    const { controller, client } = await supplies();
    const placed = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "RC",
        position: { x: 400, y: 0 },
      },
      {
        kind: "place-component",
        symbol: "ground",
        id: "g0",
        pinAnchor: { pinName: "0", position: { x: 400, y: 20 } },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const stub = await client.applyActions([
      {
        kind: "connect",
        from: pin("RC", "1"),
        to: { kind: "point", x: 400, y: -60 },
      },
    ]);
    expect(stub.ok, stub.message).toBe(true);
    const rc = controller.document.instances.find(
      (item) => item.reference === "RC",
    )!.id;
    const unnamed = controller.document.nets.find((net) =>
      net.terminals.some(
        (terminal) => terminal.instanceId === rc && terminal.pinName === "1",
      ),
    )!.id;
    const revision = controller.document.revision;
    const refuse = async (net: string, as: string, message: string) => {
      const refused = await client.applyActions([
        { kind: "render-net-as", net, as },
      ]);
      expect(refused.ok).toBe(false);
      expect(refused.message).toContain(message);
      expect(refused.message).toContain("nothing was changed");
    };
    await refuse("NOPE", "ground", 'no Net matches "NOPE"');
    await refuse(unnamed, "supply", "has no name for its markers to keep");
    await refuse("0", "supply", "Net 0 is ground");
    expect(controller.document.revision).toBe(revision);
  });

  it("draws a local Net's markers naming it in this Cell only, so its scope and the netlist stay", async () => {
    const { controller, client } = await supplies();
    const drawn = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "RC",
        position: { x: 400, y: 0 },
      },
      {
        kind: "connect",
        from: pin("RC", "1"),
        to: { kind: "point", x: 400, y: -60 },
      },
      { kind: "connect", from: pin("RC", "2"), to: pin("RB", "2") },
    ]);
    expect(drawn.ok, drawn.message).toBe(true);
    const labelled = await client.applyActions([
      {
        kind: "add-label",
        target: pin("RC", "1"),
        text: "LOC",
        position: { x: 400, y: -50 },
      },
    ]);
    expect(labelled.ok, labelled.message).toBe(true);
    const before = structuredClone(controller.document);
    const netlist = spice(controller.project);
    const rendered = await client.applyActions([
      { kind: "render-net-as", net: "LOC", as: "supply" },
    ]);
    expect(rendered.ok, rendered.message).toBe(true);
    expect(JSON.stringify(rendered)).toContain(
      "Drew LOC as 1 supply marker on its pins",
    );
    expect(JSON.stringify(rendered)).toContain("it stays local to this Cell");
    const after = controller.document;
    const added = after.instances.filter(
      (item) => !before.instances.some((old) => old.id === item.id),
    );
    expect(added.map((item) => item.symbolId)).toEqual(["vdd-port"]);
    // The marker names LOC in this Cell only: no Pin, no global name.
    expect(
      after.connectivityEvidence.flatMap((evidence) =>
        evidence.kind === "name-claim" &&
        evidence.owner.kind === "power-marker" &&
        evidence.owner.objectId === added[0]!.id
          ? [`${evidence.name} ${evidence.scope}`]
          : [],
      ),
    ).toEqual(["LOC local"]);
    expect(nets(after, new Set(added.map((item) => item.id)))).toEqual(
      nets(before),
    );
    expect(ports(after)).toEqual(ports(before));
    expect(spice(controller.project)).toBe(netlist);
  });

  /** A Cell with input Pins A and IN, each a Port wired to a resistor. */
  async function inputs() {
    const parts = await folder();
    const placed = await parts.client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "RA",
        position: { x: 0, y: 0 },
      },
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "RB",
        position: { x: 200, y: 0 },
      },
      {
        kind: "place-component",
        symbol: "port",
        id: "pa",
        reference: "A",
        direction: "input",
        position: { x: -200, y: -200 },
      },
      {
        kind: "place-component",
        symbol: "port",
        id: "pin",
        reference: "IN",
        direction: "input",
        position: { x: -200, y: 200 },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const wired = await parts.client.applyActions([
      { kind: "connect", from: markerPin("pa", "P"), to: pin("RA", "1") },
      { kind: "connect", from: markerPin("pin", "P"), to: pin("RB", "1") },
      { kind: "connect", from: pin("RA", "2"), to: pin("RB", "2") },
    ]);
    expect(wired.ok, wired.message).toBe(true);
    return parts;
  }

  it("refuses a rendering that would change the netlist, saying which line", async () => {
    const { controller, client } = await inputs();
    const revision = controller.document.revision;
    // A supply marker makes IN a supply Pin, which the Cell's port list
    // puts first.
    const refused = await client.applyActions([
      { kind: "render-net-as", net: "IN", as: "supply" },
    ]);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("rendering IN would change the netlist");
    expect(refused.message).toContain("(a Cell's port list)");
    expect(refused.message).toContain("nothing was changed");
    expect(controller.document.revision).toBe(revision);
  });

  it("keeps an old marker that is its Cell Pin's only marker", async () => {
    const { controller, client } = await folder();
    // VDD is a Cell Pin drawn as one supply marker on a stub wire: no pin of
    // VDD needs a marker, and the stub goes.
    const placed = await client.applyActions([
      {
        kind: "place-component",
        symbol: "vdd-port",
        id: "vdd",
        position: { x: 0, y: 0 },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const stub = await client.applyActions([
      {
        kind: "connect",
        from: markerPin("vdd", "P"),
        to: { kind: "point", x: 100, y: 100 },
      },
    ]);
    expect(stub.ok, stub.message).toBe(true);
    const before = structuredClone(controller.document);
    expect(before.routes.length).toBeGreaterThan(0);
    const rendered = await client.applyActions([
      { kind: "render-net-as", net: "VDD", as: "supply" },
    ]);
    expect(rendered.ok, rendered.message).toBe(true);
    expect(JSON.stringify(rendered)).toContain(
      "kept 1 old marker that is its Cell Pin's only marker",
    );
    const after = controller.document;
    expect(after.instances.map((item) => item.id)).toEqual(["vdd"]);
    expect(after.routes).toEqual([]);
    expect(ports(after)).toEqual(ports(before));
  });

  /** Where the marker on RA.2 lands when VSS is rendered, read and undone. */
  async function markerSpot(
    client: Awaited<ReturnType<typeof folder>>["client"],
    controller: Awaited<ReturnType<typeof folder>>["controller"],
  ) {
    const ids = new Set(controller.document.instances.map((item) => item.id));
    const rendered = await client.applyActions([
      { kind: "render-net-as", net: "VSS", as: "ground" },
    ]);
    expect(rendered.ok, rendered.message).toBe(true);
    const document = controller.document;
    const ra = document.instances.find((item) => item.reference === "RA")!.id;
    const marker = document.instances.find(
      (item) =>
        !ids.has(item.id) &&
        JSON.stringify(contact(document, item.id, "P")) ===
          JSON.stringify(contact(document, ra, "2")),
    )!;
    const box = createLabelClearanceContext(document, resolver).symbols.find(
      (item) => item.id === marker.id,
    )!.bounds;
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    return box;
  }
  type Box = { x: number; y: number; width: number; height: number };
  const meets = (left: Box, right: Box) =>
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height;

  it("refuses a marker drawn over free text, changing nothing", async () => {
    const { controller, client } = await supplies();
    const box = await markerSpot(client, controller);
    const noted = await client.applyActions([
      {
        kind: "annotate",
        text: "NOTE",
        alignment: "middle",
        position: {
          x: Math.round(box.x + box.width / 2),
          y: Math.round(box.y + box.height / 2),
        },
      },
    ]);
    expect(noted.ok, noted.message).toBe(true);
    const revision = controller.document.revision;
    const refused = await client.applyActions([
      { kind: "render-net-as", net: "VSS", as: "ground" },
    ]);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("the marker on RA.2 would cover");
    expect(refused.message).toContain("nothing was changed");
    expect(controller.document.revision).toBe(revision);
  });

  it("moves a part's label a marker would cover clear of it", async () => {
    const { controller, client } = await supplies();
    const box = await markerSpot(client, controller);
    const placed = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "RD",
        position: { x: 1000, y: 1000 },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const rd = () =>
      controller.document.instances.find((item) => item.reference === "RD")!;
    const label = () => {
      const document = controller.document;
      const context = createLabelClearanceContext(document, resolver);
      const own = context.visible.find(
        (item) =>
          item.anchor.kind === "object" && item.anchor.objectId === rd().id,
      )!;
      return context.measure(own).inkBounds;
    };
    // RD moves to a grid spot where its name, in its own slot, reaches into
    // where the marker will stand, short of the wire down its middle, its
    // body clear of every part.
    const ink = label();
    const at = rd().placement!.position;
    const parts = createLabelClearanceContext(
      controller.document,
      resolver,
    ).symbols;
    const body = parts.find((item) => item.id === rd().id)!.bounds;
    const wire = box.x + box.width / 2;
    const spots = [];
    for (let x = -200; x <= 200; x += 10)
      for (let y = -100; y <= 200; y += 10) {
        const name = { ...ink, x: ink.x - at.x + x, y: ink.y - at.y + y };
        const drawn = { ...body, x: body.x - at.x + x, y: body.y - at.y + y };
        const clear = (bounds: Box) =>
          !parts.some(
            (part) => part.id !== rd().id && meets(bounds, part.bounds),
          );
        if (
          meets(name, box) &&
          // Clear of the wire down the marker's middle and the dot at its pin.
          (name.x + name.width < wire - 1 || name.x > wire + 1) &&
          name.y > box.y + 6 &&
          !meets(drawn, box) &&
          clear(drawn) &&
          clear(name)
        )
          spots.push({ x, y });
      }
    for (const position of spots) {
      const moved = await client.applyActions([
        {
          kind: "move",
          target: { kind: "instance", reference: "RD" },
          position,
        },
      ]);
      expect(moved.ok, moved.message).toBe(true);
      if (meets(label(), box)) break;
    }
    expect(meets(label(), box)).toBe(true);
    const rendered = await client.applyActions([
      { kind: "render-net-as", net: "VSS", as: "ground" },
    ]);
    expect(rendered.ok, rendered.message).toBe(true);
    expect(meets(label(), box)).toBe(false);
  });

  it("compares every Cell's Nets and Pins while the netlist cannot be exported", async () => {
    const open = {
      kind: "place-component",
      symbol: "resistor",
      reference: "RO",
      position: { x: 600, y: 0 },
    } as const;
    const exports = (project: CircuitProject) =>
      createDesignNetlistExport(project, { format: "spice" }).status;
    {
      const { controller, client } = await supplies();
      expect((await client.applyActions([open])).ok).toBe(true);
      expect(exports(controller.project)).not.toBe("ready");
      const before = structuredClone(controller.document);
      const rendered = await client.applyActions([
        { kind: "render-net-as", net: "VSS", as: "ground" },
      ]);
      expect(rendered.ok, rendered.message).toBe(true);
      const added = controller.document.instances.filter(
        (item) => !before.instances.some((old) => old.id === item.id),
      );
      expect(
        nets(controller.document, new Set(added.map((item) => item.id))),
      ).toEqual(nets(before, new Set(["vss"])));
    }
    const { controller, client } = await inputs();
    expect((await client.applyActions([open])).ok).toBe(true);
    expect(exports(controller.project)).not.toBe("ready");
    const revision = controller.document.revision;
    const refused = await client.applyActions([
      { kind: "render-net-as", net: "IN", as: "supply" },
    ]);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("Cell Pin IN");
    expect(refused.message).toContain("the netlist cannot be exported");
    expect(controller.document.revision).toBe(revision);
  });

  it("names the netlist line a change adds, loses or rewrites", () => {
    const base = ".subckt main A IN\nR1 A x 1k\n.ends";
    expect(netlistChange(base, `.global VDD\n${base}`)).toBe(
      'it would add ".global VDD" (a .global line)',
    );
    expect(netlistChange(base, base.replace("A IN", "IN A"))).toBe(
      '".subckt main A IN" would read ".subckt main IN A" (a Cell\'s port list)',
    );
    expect(netlistChange(base, base.replace("R1 A x 1k\n", ""))).toBe(
      'it would lose "R1 A x 1k"',
    );
  });
});
