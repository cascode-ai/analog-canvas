import {
  createEmptyDocument,
  createEmptyProject,
  routeEnd,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import {
  buildProjectConnectivityIndex,
  deriveVisibleConnectivity,
  diagnoseVisualQuality,
  intersectSegments,
  resolveRouteGeometry,
  runErcChecks,
} from "@icm/derived";
import {
  builtInSymbols,
  InMemorySymbolResolver,
  createProjectSymbolResolver,
} from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { importSpiceSources } from "../../spice/src/importer.js";
import { DocumentHistory } from "./history.js";
import { planRouteNet, type RouteNetTarget } from "./route-net-planner.js";
import type { SchematicEdit } from "./edit-schema.js";
import { planWireBatch } from "./wire-batch-planner.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture() {
  const document = createEmptyDocument("doc", "Route Net");
  document.instances = [0, 1, 2, 3].map((index) => ({
    id: `R${index}`,
    reference: `R${index}`,
    symbolId: "resistor",
    placement: {
      position: { x: index * 100, y: 100 },
      rotation: 0,
      mirror: "none",
    },
  }));
  const pins = document.instances.map((instance) => ({
    instanceId: instance.id,
    pinName: "1",
  }));
  const target: RouteNetTarget = { kind: "pins", pins };
  return { document, pins, target };
}
function apply(document: SchematicDocument, edits: SchematicEdit[]) {
  const history = new DocumentHistory(document, { symbolResolver: resolver });
  const result = history.transact({
    transactionId: "route-net",
    documentId: document.id,
    expectedRevision: document.revision,
    actor: { kind: "agent", id: "test" },
    edits,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return history;
}
/** Pins and Junctions that sit on another Net's wire: they read as joined. */
function falseContacts(
  document: SchematicDocument,
  symbols: typeof resolver = resolver,
) {
  const project = createEmptyProject("route-net", "Route Net");
  project.documents = [document];
  project.topDocumentId = document.id;
  return [
    ...runErcChecks(
      project,
      buildProjectConnectivityIndex(project, symbols),
      symbols,
    )
      .filter((diagnostic) => diagnostic.code === "ERC_TOUCHING_NOT_CONNECTED")
      .map((diagnostic) => diagnostic.message),
    ...diagnoseVisualQuality(document, symbols)
      .filter(
        (diagnostic) => diagnostic.code === "VISUAL_TERMINAL_ON_FOREIGN_ROUTE",
      )
      .map((diagnostic) => diagnostic.message),
  ];
}
describe("route-net", () => {
  it("does not bypass an ambiguous foreign wire at a reused trunk-end pin", () => {
    const { document, target } = fixture();
    const foreign = planWireBatch(document, resolver, [
      {
        id: "foreign",
        from: { kind: "free", point: { x: 0, y: 50 } },
        to: { kind: "free", point: { x: 0, y: 110 } },
      },
    ]);
    if (typeof foreign === "string") throw new Error(foreign);
    const current = apply(document, foreign.edits).document;
    expect(current.nets.flatMap((net) => net.terminals)).toEqual([]);
    const before = structuredClone(current);
    expect(() =>
      planRouteNet(current, resolver, {
        target,
        trunk: { start: { x: 0, y: 80 }, end: { x: 300, y: 80 } },
      }),
    ).toThrow(/different Net|Ambiguous wire crossing/);
    expect(current).toEqual(before);
  });
  it.each([50, 100])(
    "allows plain crossings but refuses a foreign Net at a tap (x=%i)",
    (x) => {
      const { document, target } = fixture();
      const foreign = planWireBatch(document, resolver, [
        {
          id: "foreign",
          from: { kind: "free", point: { x, y: -30 } },
          to: { kind: "free", point: { x, y: 30 } },
        },
      ]);
      if (typeof foreign === "string") throw new Error(foreign);
      const current = apply(document, foreign.edits).document;
      const before = structuredClone(current);
      const input = {
        target,
        trunk: { start: { x: -40, y: 0 }, end: { x: 360, y: 0 } },
      };
      if (x === 100) {
        expect(() => planRouteNet(current, resolver, input)).toThrow(
          /different Net|Ambiguous wire crossing/,
        );
        expect(current).toEqual(before);
      } else {
        const next = apply(
          current,
          planRouteNet(current, resolver, input).edits,
        ).document;
        expect(next.nets).toHaveLength(2);
        expect(
          next.junctions.some(
            (junction) =>
              junction.position.x === 50 && junction.position.y === 0,
          ),
        ).toBe(false);
      }
    },
  );
  it("connects explicit pins once, skips existing routes on repeat and supports one undo", () => {
    const { document, pins, target } = fixture();
    const before = structuredClone(document);
    const plan = planRouteNet(document, resolver, { target });
    expect(document).toEqual(before);
    const history = apply(document, plan.edits);
    expect(history.document.nets).toHaveLength(1);
    expect(history.document.nets[0]!.terminals).toHaveLength(pins.length);
    expect(
      deriveVisibleConnectivity(history.document, resolver)[0]!.components,
    ).toHaveLength(1);
    expect(planRouteNet(history.document, resolver, { target }).edits).toEqual(
      [],
    );
    expect(
      history.transact({
        transactionId: "undo",
        documentId: document.id,
        expectedRevision: history.document.revision,
        actor: { kind: "human", id: "test" },
        edits: [{ kind: "undo" }],
      }).ok,
    ).toBe(true);
    expect(history.document.instances).toEqual(before.instances);
    expect(history.document.routes).toEqual([]);
    expect(history.document.nets).toEqual([]);
  });

  it.each(["net", "member"] as const)(
    "routes a current %s target and keeps the preexisting segment",
    (kind) => {
      const { document, pins } = fixture();
      const first = apply(
        document,
        planRouteNet(document, resolver, {
          target: { kind: "pins", pins: pins.slice(0, 2) },
        }).edits,
      ).document;
      const net = first.nets[0]!;
      net.terminals.push(...pins.slice(2));
      first.annotations.push({
        id: "label",
        kind: "net-label",
        netId: net.id,
        binding: { kind: "net-name", netId: net.id },
        anchor: {
          kind: "object",
          objectId: "R0",
          localOffset: { x: 0, y: 0 },
          fallbackPosition: { x: 0, y: 100 },
        },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
      first.connectivityEvidence.push({
        id: "claim",
        kind: "name-claim",
        netId: net.id,
        name: "BUS",
        owner: { kind: "net-label", annotationId: "label" },
        scope: "local",
      });
      const routes = structuredClone(first.routes);
      const target: RouteNetTarget =
        kind === "net" ? { kind, net: "BUS" } : { kind, ...pins[0]! };
      const next = apply(
        first,
        planRouteNet(first, resolver, { target }).edits,
      ).document;
      for (const route of routes) expect(next.routes).toContainEqual(route);
      expect(
        deriveVisibleConnectivity(next, resolver)[0]!.components,
      ).toHaveLength(1);
    },
  );

  it("uses one explicit trunk with evolving taps", () => {
    const { document, target } = fixture();
    const input = {
      target,
      trunk: { start: { x: -40, y: 0 }, end: { x: 360, y: 0 } },
    };
    const next = apply(
      document,
      planRouteNet(document, resolver, input).edits,
    ).document;
    expect(next.nets).toHaveLength(1);
    expect(next.nets[0]!.terminals).toHaveLength(4);
    expect(
      deriveVisibleConnectivity(next, resolver)[0]!.components,
    ).toHaveLength(1);
    expect(planRouteNet(next, resolver, input).edits).toEqual([]);
  });

  it("taps a trunk level with a pin off the Document grid (#1438)", () => {
    // A 4-input gate's B pin sits at y=-4, between grid lines.
    const document = createEmptyDocument("doc", "Off-grid pins");
    document.instances = [0, 60].map((y, index) => ({
      id: `U${index}`,
      reference: `U${index}`,
      symbolId: "and-gate-4",
      placement: { position: { x: 0, y }, rotation: 0, mirror: "none" },
    }));
    const pins = document.instances.map((instance) => ({
      instanceId: instance.id,
      pinName: "B",
    }));
    const next = apply(
      document,
      planRouteNet(document, resolver, {
        target: { kind: "pins", pins },
        trunk: { start: { x: -100, y: -100 }, end: { x: -100, y: 100 } },
      }).edits,
    ).document;
    expect(next.nets).toHaveLength(1);
    expect(next.nets[0]!.terminals).toHaveLength(2);
    expect(
      deriveVisibleConnectivity(next, resolver)[0]!.components,
    ).toHaveLength(1);
    // Straight branches: each tap level with its pin, not moved to y=0 or 60.
    expect(next.junctions.map((junction) => junction.position)).toEqual(
      expect.arrayContaining([
        { x: -100, y: -4 },
        { x: -100, y: 56 },
      ]),
    );
  });

  it("never refuses its own detour as a 45° step (#1437)", () => {
    const document = createEmptyDocument("doc", "Detour");
    document.instances = (
      [
        ["R1", 20, 90, 270],
        ["R2", 80, 40, 180],
        ["R3", 20, 60, 90],
        ["R4", 60, 90, 0],
      ] as const
    ).map(([id, x, y, rotation]) => ({
      id,
      reference: id,
      symbolId: "resistor",
      placement: { position: { x, y }, rotation, mirror: "none" },
    }));
    const pins = [
      { instanceId: "R1", pinName: "2" },
      { instanceId: "R2", pinName: "1" },
    ];
    const next = apply(
      document,
      planRouteNet(document, resolver, { target: { kind: "pins", pins } })
        .edits,
    ).document;
    expect(next.nets[0]!.terminals).toHaveLength(2);
  });

  it("goes around another Net's pin on the way, so no Net looks shorted to another", () => {
    const { document, pins } = fixture();
    // φ1 joins R0.1 and R2.1; R1.1, between them on one line, is φ2's.
    const phi1 = apply(
      document,
      planRouteNet(document, resolver, {
        target: { kind: "pins", pins: [pins[0]!, pins[2]!] },
      }).edits,
    ).document;
    expect(falseContacts(phi1)).toEqual([]);
    const phi2 = apply(
      phi1,
      planRouteNet(phi1, resolver, {
        target: { kind: "pins", pins: [pins[1]!, pins[3]!] },
      }).edits,
    ).document;
    expect(phi2.nets).toHaveLength(2);
    expect(phi2.nets.map((net) => net.terminals.length)).toEqual([2, 2]);
    // No pin and no Junction dot of one Net lands on the other's wire.
    expect(falseContacts(phi2)).toEqual([]);
  });

  it("joins a ladder node with a T, whichever way the pins' IDs sort", () => {
    // An R-2R node: two series resistors lying on y = 0 and the 2R leg
    // standing below, its pin pointing up. Named so the leg sorts first, it
    // used to be wired to each neighbour with an L that left it sideways,
    // two bumps instead of one straight line with the leg tapped on.
    for (const [left, leg, right] of [
      ["c-left", "a-leg", "b-right"],
      ["a-left", "b-leg", "c-right"],
    ]) {
      const document = createEmptyDocument("doc", "Ladder");
      const part = (id: string, x: number, y: number, rotation: 0 | 90) => ({
        id,
        reference: id,
        symbolId: "resistor",
        placement: { position: { x, y }, rotation, mirror: "none" as const },
      });
      // Pins: left.1 at (-30,0), leg.1 at (0,40), right.2 at (30,0).
      document.instances = [
        part(left!, -50, 0, 90),
        part(leg!, 0, 60, 0),
        part(right!, 50, 0, 90),
      ];
      const next = apply(
        document,
        planRouteNet(document, resolver, {
          target: {
            kind: "pins",
            pins: [
              { instanceId: left!, pinName: "1" },
              { instanceId: leg!, pinName: "1" },
              { instanceId: right!, pinName: "2" },
            ],
          },
        }).edits,
      ).document;
      const lines = next.routes.map(
        (route) => resolveRouteGeometry(next, resolver, route)!.centerline,
      );
      // Every wire is one straight segment meeting the others at (0, 0).
      expect(lines.every((line) => line.length === 2)).toBe(true);
      expect(
        lines.every((line) => line.some((p) => p.x === 0 && p.y === 0)),
      ).toBe(true);
    }
  });

  it("draws a node as one straight line with its branches tapped on", () => {
    // A pipeline stage's hold node: the switch S1.2 (60,0) and the adder's
    // A (280,0) line up; the hold capacitor's top CH.1 (80,20) and the
    // sub-ADC's IN (100,80) lie below the line. Joined pin to pin, the line
    // dipped to CH.1 and came back up beside it, two Junctions a step apart.
    const document = createEmptyDocument("doc", "Hold node");
    const part = (id: string, symbolId: string, x: number, y: number) => ({
      id,
      reference: id,
      symbolId,
      placement: {
        position: { x, y },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    });
    document.instances = [
      part("S1", "simple-switch", 40, 0),
      part("CH", "capacitor", 80, 40),
      part("X1", "adc", 150, 80),
      part("X3", "adder", 300, 0),
    ];
    const next = apply(
      document,
      planRouteNet(document, resolver, {
        target: {
          kind: "pins",
          pins: [
            { instanceId: "S1", pinName: "2" },
            { instanceId: "CH", pinName: "1" },
            { instanceId: "X1", pinName: "IN" },
            { instanceId: "X3", pinName: "A" },
          ],
        },
      }).edits,
    ).document;
    const lines = next.routes.map(
      (route) => resolveRouteGeometry(next, resolver, route)!.centerline,
    );
    expect(
      lines.every((line) => line.length === 2),
      JSON.stringify(lines),
    ).toBe(true);
    expect(
      next.junctions
        .map((junction) => `${junction.position.x},${junction.position.y}`)
        .sort(),
    ).toEqual(["100,0", "80,0"]);
  });

  it("runs an op-amp's feedback clear of its triangle's corners", () => {
    // An op-amp at (460,10): IN- (420,0), OUT (490,10), and its triangle's
    // corners at (430,-20), (430,40) and (481.96,10). The feedback used to
    // run along y = -20, straight through the top corner.
    const document = createEmptyDocument("doc", "Follower");
    document.instances = [
      {
        id: "X1",
        reference: "X1",
        symbolId: "opamp",
        placement: { position: { x: 460, y: 10 }, rotation: 0, mirror: "none" },
      },
    ];
    const next = apply(
      document,
      planRouteNet(document, resolver, {
        target: {
          kind: "pins",
          pins: [
            { instanceId: "X1", pinName: "OUT" },
            { instanceId: "X1", pinName: "IN-" },
          ],
        },
      }).edits,
    ).document;
    const line = resolveRouteGeometry(
      next,
      resolver,
      next.routes[0]!,
    )!.centerline;
    for (const corner of [
      { x: 430, y: -20 },
      { x: 430, y: 40 },
    ])
      for (const [index, to] of line.slice(1).entries()) {
        const from = line[index]!;
        const onIt =
          (from.x === to.x &&
            corner.x === from.x &&
            corner.y >= Math.min(from.y, to.y) &&
            corner.y <= Math.max(from.y, to.y)) ||
          (from.y === to.y &&
            corner.y === from.y &&
            corner.x >= Math.min(from.x, to.x) &&
            corner.x <= Math.max(from.x, to.x));
        expect(onIt, JSON.stringify(line)).toBe(false);
      }
  });

  it("leaves a pin around its own part rather than through it", () => {
    const document = createEmptyDocument("doc", "Bandgap");
    document.instances = [
      {
        id: "Q1",
        reference: "Q1",
        symbolId: "pnp",
        placement: {
          position: { x: 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    const next = apply(
      document,
      planRouteNet(document, resolver, {
        target: {
          kind: "pins",
          pins: [
            { instanceId: "Q1", pinName: "B" },
            { instanceId: "Q1", pinName: "C" },
          ],
        },
      }).edits,
    ).document;
    // The base (west, at x=170) and the collector (south, at y=220) bound
    // the transistor; the wire must stay out of what lies between.
    const points = resolveRouteGeometry(
      next,
      resolver,
      next.routes[0]!,
    )!.centerline;
    for (const [index, to] of points.slice(1).entries()) {
      const from = points[index]!;
      const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      expect(
        middle.x > 170 && middle.x < 200 && middle.y > 180 && middle.y < 220,
        JSON.stringify(points),
      ).toBe(false);
    }
    expect(
      diagnoseVisualQuality(next, resolver).filter(
        (diagnostic) => diagnostic.code === "VISUAL_WIRE_THROUGH_SYMBOL",
      ),
    ).toEqual([]);
  });

  it("refuses a Net whose pin already sits on another Net's wire, naming it", () => {
    const { document, pins } = fixture();
    const foreign = planWireBatch(document, resolver, [
      {
        id: "foreign",
        from: { kind: "free", point: { x: -20, y: 80 } },
        to: { kind: "free", point: { x: 20, y: 80 } },
      },
    ]);
    if (typeof foreign === "string") throw new Error(foreign);
    const current = apply(document, foreign.edits).document;
    const before = structuredClone(current);
    expect(() =>
      planRouteNet(current, resolver, {
        target: { kind: "pins", pins: [pins[0]!, pins[2]!] },
      }),
    ).toThrow(
      /^route-net: R0\.1 sits on Route foreign-route of a different Net \(.+\); move that wire off the pin first$/,
    );
    expect(current).toEqual(before);
  });

  it("routes every Net of an imported OTA's default placement without a false contact", async () => {
    const source = [
      "* five-transistor OTA",
      ".subckt ota5t vinp vinn vout vb VDD VSS",
      "M1 n1 vinp tail VSS nch W=1u L=1u",
      "M2 vout vinn tail VSS nch W=1u L=1u",
      "M3 n1 n1 VDD VDD pch W=2u L=1u",
      "M4 vout n1 VDD VDD pch W=2u L=1u",
      "M5 tail vb VSS VSS nch W=1u L=1u",
      ".ends ota5t",
      ".model nch nmos",
      ".model pch pmos",
      ".end",
      "",
    ].join("\n");
    const { project } = await importSpiceSources(
      [{ path: "ota.cir", bytes: new TextEncoder().encode(source) }],
      "ota.cir",
    );
    const projectResolver = createProjectSymbolResolver(
      project!,
      builtInSymbols,
    );
    let document = project!.documents.find(
      (item) => item.sourceBinding?.cellName === "ota5t",
    )!;
    expect(falseContacts(document, projectResolver)).toEqual([]);
    for (const net of document.importReference!.nets) {
      const plan = planRouteNet(document, projectResolver, {
        target: { kind: "import-net", sourceNetId: net.id },
      });
      const history = new DocumentHistory(document, {
        symbolResolver: projectResolver,
      });
      const result = history.transact({
        transactionId: `route-${net.id}`,
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      document = history.document;
      expect(falseContacts(document, projectResolver), net.name).toEqual([]);
    }
    expect(
      diagnoseVisualQuality(document, projectResolver).filter(
        (diagnostic) => diagnostic.code === "VISUAL_WIRE_THROUGH_SYMBOL",
      ),
    ).toEqual([]);
  });

  it("reports missing or unplaced pins instead of claiming partial completion", () => {
    const { document, pins } = fixture();
    expect(() =>
      planRouteNet(document, resolver, {
        target: { kind: "net", net: "unknown" },
      }),
    ).toThrow("found 0");
    expect(() =>
      planRouteNet(document, resolver, {
        target: {
          kind: "pins",
          pins: [pins[0]!, { instanceId: "missing", pinName: "1" }],
        },
      }),
    ).toThrow("Missing route-net pin");
    document.instances[1]!.placement = null;
    expect(() =>
      planRouteNet(document, resolver, { target: { kind: "pins", pins } }),
    ).toThrow("Place R1");
    expect(document.routes).toEqual([]);
  });

  it("resolves an imported reference identity without treating it as a live Net ID", async () => {
    const source =
      "* topology-only routing regression\nR1 A B 1k\nR2 A C 2k\nR3 A D 3k\n.end\n";
    const { project } = await importSpiceSources(
      [{ path: "test.cir", bytes: new TextEncoder().encode(source) }],
      "test.cir",
    );
    expect(project).toBeTruthy();
    const document = project!.documents.find(
      (item) => item.id === project!.topDocumentId,
    )!;
    document.instances.forEach((instance, index) => {
      instance.placement = {
        position: { x: index * 100, y: 100 },
        rotation: 0,
        mirror: "none",
      };
    });
    const sourceNet = document.importReference!.nets.find(
      (net) => net.name === "A",
    )!;
    const projectResolver = createProjectSymbolResolver(
      project!,
      builtInSymbols,
    );
    const plan = planRouteNet(document, projectResolver, {
      target: { kind: "import-net", sourceNetId: sourceNet.id },
    });
    expect(plan.edits.length).toBeGreaterThan(0);
    const history = new DocumentHistory(document, {
      symbolResolver: projectResolver,
    });
    expect(
      history.transact({
        transactionId: "import-route",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      }).ok,
    ).toBe(true);
    expect(
      planRouteNet(history.document, projectResolver, {
        target: { kind: "import-net", sourceNetId: sourceNet.id },
      }).edits,
    ).toEqual([]);
  });
});

describe("route-net trunk with avoid", () => {
  const trunk = { start: { x: -200, y: 0 }, end: { x: 200, y: 0 } };
  /** Parts by Reference: a resistor or capacitor, upright or (90) lying. */
  function parts(
    list: readonly (readonly [string, string, number, number, (0 | 90)?])[],
  ) {
    const document = createEmptyDocument("doc", "Trunk avoid");
    document.instances = list.map(([id, symbolId, x, y, rotation]) => ({
      id,
      reference: id,
      symbolId,
      placement: {
        position: { x, y },
        rotation: rotation ?? 0,
        mirror: "none",
      },
    }));
    return document;
  }
  const pin = (instanceId: string, pinName: string) => ({
    instanceId,
    pinName,
  });
  /** Each Net as its pins, sorted. */
  const nets = (document: SchematicDocument) =>
    document.nets
      .map((net) =>
        net.terminals
          .map((terminal) => `${terminal.instanceId}.${terminal.pinName}`)
          .sort()
          .join(" "),
      )
      .filter(Boolean)
      .sort();
  /** Where a drawn line meets the (horizontal) trunk: the points it
   * touches, and whether it runs along it. */
  function meetsTrunk(line: readonly Point[]) {
    const level = trunk.start.y;
    const touches = new Set<string>();
    let runs = false;
    for (const [index, q] of line.slice(1).entries()) {
      const p = line[index]!;
      if (p.y === level && q.y === level) {
        const from = Math.max(trunk.start.x, Math.min(p.x, q.x));
        const to = Math.min(trunk.end.x, Math.max(p.x, q.x));
        if (to > from) runs = true;
        else if (to === from) touches.add(`${from},${level}`);
      } else if (
        p.x === q.x &&
        p.x >= trunk.start.x &&
        p.x <= trunk.end.x &&
        Math.min(p.y, q.y) <= level &&
        level <= Math.max(p.y, q.y)
      )
        touches.add(`${p.x},${level}`);
    }
    return { touches: [...touches], runs };
  }
  /** Route the pins onto the trunk with avoid; check every branch meets
   * the trunk once, square, at its end and with a dot, and nothing else. */
  function routed(document: SchematicDocument, pins: ReturnType<typeof pin>[]) {
    const input = {
      target: { kind: "pins", pins } as RouteNetTarget,
      trunk,
      avoid: true,
    };
    const next = apply(
      document,
      planRouteNet(document, resolver, input).edits,
    ).document;
    const onTrunk = (point: Point) =>
      point.y === trunk.start.y &&
      point.x >= trunk.start.x &&
      point.x <= trunk.end.x;
    const branches = next.routes
      .map((route) => resolveRouteGeometry(next, resolver, route)!.centerline)
      .filter((line) => !line.every(onTrunk));
    expect(branches).toHaveLength(pins.length);
    const taps: Point[] = [];
    for (const line of branches) {
      const shown = JSON.stringify(line);
      const met = meetsTrunk(line);
      expect(met.runs, shown).toBe(false);
      expect(met.touches, shown).toHaveLength(1);
      const [x, y] = met.touches[0]!.split(",").map(Number);
      const tap = { x: x!, y: y! };
      // At the branch's end, reached square: its last stretch is vertical.
      const toTap =
        line.at(-1)!.x === tap.x && line.at(-1)!.y === tap.y
          ? line
          : [...line].reverse();
      expect(toTap.at(-1), shown).toEqual(tap);
      expect(toTap.at(-2)!.x, shown).toBe(tap.x);
      expect(
        next.junctions.some(
          (junction) =>
            junction.position.x === tap.x && junction.position.y === tap.y,
        ),
        shown,
      ).toBe(true);
      taps.push(tap);
    }
    // No dot on the trunk where nothing branches: a branch that ran along
    // the trunk to its tap left one there once the overlap merged.
    const key = (point: Point) => `${point.x},${point.y}`;
    expect(
      next.junctions
        .map((junction) => key(junction.position))
        .filter((at) => at !== key(trunk.start) && at !== key(trunk.end))
        .sort(),
    ).toEqual(taps.map(key).sort());
    expect(falseContacts(next)).toEqual([]);
    expect(
      diagnoseVisualQuality(next, resolver).filter(
        (diagnostic) => diagnostic.code === "VISUAL_WIRE_THROUGH_SYMBOL",
      ),
    ).toEqual([]);
    expect(planRouteNet(next, resolver, input).edits).toEqual([]);
    return { next, taps };
  }

  it("taps square past a part between a pin and the trunk", () => {
    // R1.2 (0,-100) looks down onto the trunk through C1 (0,-70..-30);
    // R2.1 (-150,100) has a straight branch.
    const document = parts([
      ["R1", "resistor", 0, -120],
      ["C1", "capacitor", 0, -50],
      ["R2", "resistor", -150, 120],
    ]);
    const { next, taps } = routed(document, [pin("R1", "2"), pin("R2", "1")]);
    expect(nets(next)).toEqual(["R1.2 R2.1"]);
    // Near the pin's projection, not far along the trunk.
    const tap = taps.find((point) => point.x !== -150)!;
    expect(Math.abs(tap.x)).toBeLessThanOrEqual(40);
  });

  it("goes round a wall without coming back along the trunk", () => {
    // Lying resistors from x=-120 to 120 at y=-50: no simple detour clears
    // them, and the search came down beside the wall and ran back along the
    // trunk to the tap under the pin.
    const document = parts([
      ["R1", "resistor", 0, -120],
      ...[-100, -50, 0, 50, 100].map(
        (x, index) => [`W${index}`, "resistor", x, -50, 90] as const,
      ),
      ["R2", "resistor", -150, 120],
    ]);
    const { next, taps } = routed(document, [pin("R1", "2"), pin("R2", "1")]);
    expect(nets(next)).toEqual(["R1.2 R2.1"]);
    // Just past the wall's end, not back under the pin.
    const tap = taps.find((point) => point.x !== -150)!;
    expect(Math.abs(tap.x)).toBe(130);
  });

  it("taps from both sides of the trunk, each branch round its own part", () => {
    const document = parts([
      ["R1", "resistor", 0, -120],
      ["C1", "capacitor", 0, -50],
      ["R2", "resistor", 60, 120],
      ["C2", "capacitor", 60, 50],
      ["R3", "resistor", -150, 120],
    ]);
    const { next } = routed(document, [
      pin("R1", "2"),
      pin("R2", "1"),
      pin("R3", "1"),
    ]);
    expect(nets(next)).toEqual(["R1.2 R2.1 R3.1"]);
  });

  it("refuses naming the pin when no branch reaches the trunk", () => {
    // A wall wider than the search reaches round the pin.
    const document = parts([
      ["R1", "resistor", 0, -120],
      ...Array.from(
        { length: 17 },
        (_, index) =>
          [`W${index}`, "resistor", (index - 8) * 50, -50, 90] as const,
      ),
      ["R2", "resistor", -150, 120],
    ]);
    const before = structuredClone(document);
    expect(() =>
      planRouteNet(document, resolver, {
        target: { kind: "pins", pins: [pin("R1", "2"), pin("R2", "1")] },
        trunk,
        avoid: true,
      }),
    ).toThrow(
      /^route-net: the branch from R1\.2: no clear path from R1\.2 to the trunk: /u,
    );
    expect(document).toEqual(before);
  });
});

describe("route-net keeps a Net's own wires apart", () => {
  /** Upright (0) or lying (90) resistors, by Reference. */
  function resistors(
    list: readonly (readonly [string, number, number, 0 | 90])[],
  ) {
    const document = createEmptyDocument("doc", "Own wires");
    document.instances = list.map(([id, x, y, rotation]) => ({
      id,
      reference: id,
      symbolId: "resistor",
      placement: { position: { x, y }, rotation, mirror: "none" },
    }));
    return document;
  }
  const key = (point: Point) => `${point.x},${point.y}`;
  /** Where two wires of one Net meet anywhere but at both their ends, a
   * crossing or a shared stretch that reads as a join nobody marked; where
   * three wire ends meet off a pin with no dot; and a dot where fewer meet
   * (a free trunk end aside). */
  function unmarked(document: SchematicDocument, free: readonly Point[]) {
    const lines = document.routes.map((route) => ({
      route,
      line: resolveRouteGeometry(document, resolver, route)!.centerline,
    }));
    const pairs = (line: readonly Point[]) =>
      line.slice(1).map((to, index) => [line[index]!, to] as const);
    const endOf = (line: readonly Point[], point: Point) =>
      key(line[0]!) === key(point) || key(line.at(-1)!) === key(point);
    const found: string[] = [];
    const ends = new Map<string, number>();
    for (const [index, a] of lines.entries()) {
      for (const end of [a.line[0]!, a.line.at(-1)!])
        ends.set(key(end), (ends.get(key(end)) ?? 0) + 1);
      for (const b of lines.slice(index + 1)) {
        if (a.route.netId !== b.route.netId) continue;
        for (const [p, q] of pairs(a.line))
          for (const [r, s] of pairs(b.line)) {
            const hit = intersectSegments(p, q, r, s);
            if (!hit) continue;
            if (
              hit.kind === "overlap" &&
              key(hit.point) !== key(intersectSegments(q, p, r, s)!.point)
            )
              found.push(`overlap at ${key(hit.point)}`);
            else if (!endOf(a.line, hit.point) || !endOf(b.line, hit.point))
              found.push(`crossing at ${key(hit.point)}`);
          }
      }
    }
    const pins = new Set(
      lines.flatMap(({ route, line }) => [
        ...(route.start.kind === "terminal" ? [key(line[0]!)] : []),
        ...(routeEnd(route).kind === "terminal" ? [key(line.at(-1)!)] : []),
      ]),
    );
    const dots = new Set(
      document.junctions.map((junction) => key(junction.position)),
    );
    for (const [at, count] of ends)
      if (count >= 3 && !dots.has(at) && !pins.has(at))
        found.push(`${count} wire ends without a dot at ${at}`);
    for (const at of dots)
      if ((ends.get(at) ?? 0) < 3 && !free.some((point) => key(point) === at))
        found.push(`a dot where ${ends.get(at) ?? 0} wire ends meet at ${at}`);
    return [...new Set(found)];
  }
  const target = (pins: readonly string[]): RouteNetTarget => ({
    kind: "pins",
    pins: pins.map((pin) => {
      const [instanceId, pinName] = pin.split(".");
      return { instanceId: instanceId!, pinName: pinName! };
    }),
  });
  /** Route the pins; their Net is one Net of just them, its wires meet
   * only at dots, and no pin sits on a wire it is not on. */
  function routed(
    document: SchematicDocument,
    pins: readonly string[],
    options: { trunk?: { start: Point; end: Point }; avoid?: boolean } = {},
  ) {
    const next = apply(
      document,
      planRouteNet(document, resolver, { target: target(pins), ...options })
        .edits,
    ).document;
    expect(
      next.nets
        .map((net) =>
          net.terminals
            .map((terminal) => `${terminal.instanceId}.${terminal.pinName}`)
            .sort()
            .join(" "),
        )
        .filter(Boolean),
    ).toEqual([[...pins].sort().join(" ")]);
    const free = options.trunk ? [options.trunk.start, options.trunk.end] : [];
    expect(unmarked(next, free)).toEqual([]);
    expect(falseContacts(next)).toEqual([]);
    expect(
      planRouteNet(next, resolver, { target: target(pins), ...options }).edits,
    ).toEqual([]);
    return next;
  }
  const dots = (document: SchematicDocument) =>
    document.junctions.map((junction) => key(junction.position)).sort();

  it.each([false, true])(
    "taps an earlier wire a later one would cross (avoid %s)",
    (avoid) => {
      // R4.1's wire down to R2.1 crossed R1.1's at (150, 80) without a dot.
      const next = routed(
        resistors([
          ["R0", 0, 120, 90],
          ["R1", 0, 80, 90],
          ["R2", 160, 160, 0],
          ["R3", 80, -200, 0],
          ["R4", 160, -120, 0],
        ]),
        ["R0.2", "R1.1", "R2.1", "R3.1", "R4.1"],
        { avoid },
      );
      expect(dots(next)).toEqual(["150,-140", "150,90", "20,90"]);
    },
  );

  it("ends a wire on the first wire of its Net it meets", () => {
    // R2.2 (0, 60) went round R4 up to R4.2 (0, -140), across R1.1's wire
    // at (-10, -100).
    const next = routed(
      resistors([
        ["R0", -120, -120, 90],
        ["R1", -80, -80, 0],
        ["R2", 0, 40, 0],
        ["R3", 40, -160, 90],
        ["R4", 0, -160, 0],
      ]),
      ["R0.2", "R1.1", "R2.2", "R3.2", "R4.2"],
    );
    expect(dots(next)).toEqual(["-10,-100"]);
  });

  it("taps a trunk branch a later branch going round would cross", () => {
    // On their way round R5.1 to the trunk, R4.1's branch crossed R1.2's
    // at (-100, 60).
    const trunk = { start: { x: -300, y: 0 }, end: { x: 300, y: 0 } };
    const next = routed(
      resistors([
        ["R1", -80, 80, 90],
        ["R4", -120, 80, 0],
        ["R5", -120, 40, 90],
      ]),
      ["R1.2", "R4.1", "R5.1"],
      { trunk, avoid: true },
    );
    expect(dots(next)).toContain("-100,60");
  });

  it("taps a trunk branch a later one would run along", () => {
    // R1.2 (250, -100) and R2.2 (300, -40) lie past the trunk's end: both
    // branches come down x = 200 to it. The second ends on the first, with
    // its dot planned, rather than drawn over it for the commit to merge.
    const trunk = { start: { x: -200, y: 0 }, end: { x: 200, y: 0 } };
    const document = resistors([
      ["R1", 250, -120, 0],
      ["R2", 300, -60, 0],
      ["R3", -100, 120, 0],
    ]);
    const pins = ["R1.2", "R2.2", "R3.1"];
    expect(
      planRouteNet(document, resolver, { target: target(pins), trunk })
        .edits.flatMap((edit) => (edit.kind === "add_junction" ? [edit] : []))
        .map((edit) => key(edit.position)),
    ).toContain("200,-40");
    expect(dots(routed(document, pins, { trunk }))).toContain("200,-40");
  });
});
