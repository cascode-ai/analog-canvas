import {
  createEmptyDocument,
  createEmptyProject,
  type SchematicDocument,
} from "@icm/model";
import {
  buildProjectConnectivityIndex,
  deriveVisibleConnectivity,
  diagnoseVisualQuality,
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
    const foreign = planWireBatch(
      document,
      resolver,
      [
        {
          id: "foreign",
          from: { kind: "free", point: { x: 0, y: 50 } },
          to: { kind: "free", point: { x: 0, y: 110 } },
        },
      ],
      64,
    );
    if (typeof foreign === "string") throw new Error(foreign);
    const current = apply(document, foreign.edits).document;
    expect(current.nets.flatMap((net) => net.terminals)).toEqual([]);
    const before = structuredClone(current);
    expect(() =>
      planRouteNet(
        current,
        resolver,
        {
          target,
          trunk: { start: { x: 0, y: 80 }, end: { x: 300, y: 80 } },
        },
        64,
      ),
    ).toThrow(/different Net|Ambiguous wire crossing/);
    expect(current).toEqual(before);
  });
  it.each([50, 100])(
    "allows plain crossings but refuses a foreign Net at a tap (x=%i)",
    (x) => {
      const { document, target } = fixture();
      const foreign = planWireBatch(
        document,
        resolver,
        [
          {
            id: "foreign",
            from: { kind: "free", point: { x, y: -30 } },
            to: { kind: "free", point: { x, y: 30 } },
          },
        ],
        64,
      );
      if (typeof foreign === "string") throw new Error(foreign);
      const current = apply(document, foreign.edits).document;
      const before = structuredClone(current);
      const input = {
        target,
        trunk: { start: { x: -40, y: 0 }, end: { x: 360, y: 0 } },
      };
      if (x === 100) {
        expect(() => planRouteNet(current, resolver, input, 64)).toThrow(
          /different Net|Ambiguous wire crossing/,
        );
        expect(current).toEqual(before);
      } else {
        const next = apply(
          current,
          planRouteNet(current, resolver, input, 64).edits,
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
    const plan = planRouteNet(document, resolver, { target }, 64);
    expect(document).toEqual(before);
    const history = apply(document, plan.edits);
    expect(history.document.nets).toHaveLength(1);
    expect(history.document.nets[0]!.terminals).toHaveLength(pins.length);
    expect(
      deriveVisibleConnectivity(history.document, resolver)[0]!.components,
    ).toHaveLength(1);
    expect(
      planRouteNet(history.document, resolver, { target }, 64).edits,
    ).toEqual([]);
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
        planRouteNet(
          document,
          resolver,
          { target: { kind: "pins", pins: pins.slice(0, 2) } },
          64,
        ).edits,
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
        planRouteNet(first, resolver, { target }, 64).edits,
      ).document;
      for (const route of routes) expect(next.routes).toContainEqual(route);
      expect(
        deriveVisibleConnectivity(next, resolver)[0]!.components,
      ).toHaveLength(1);
    },
  );

  it("uses one explicit trunk with evolving taps and rejects insufficient capacity atomically", () => {
    const { document, target } = fixture();
    const input = {
      target,
      trunk: { start: { x: -40, y: 0 }, end: { x: 360, y: 0 } },
    };
    const before = structuredClone(document);
    expect(() => planRouteNet(document, resolver, input, 3)).toThrow(/limit/);
    expect(document).toEqual(before);
    const next = apply(
      document,
      planRouteNet(document, resolver, input, 64).edits,
    ).document;
    expect(next.nets).toHaveLength(1);
    expect(next.nets[0]!.terminals).toHaveLength(4);
    expect(
      deriveVisibleConnectivity(next, resolver)[0]!.components,
    ).toHaveLength(1);
    expect(planRouteNet(next, resolver, input, 64).edits).toEqual([]);
  });

  it("goes around another Net's pin on the way, so no Net looks shorted to another", () => {
    const { document, pins } = fixture();
    // φ1 joins R0.1 and R2.1; R1.1, between them on one line, is φ2's.
    const phi1 = apply(
      document,
      planRouteNet(
        document,
        resolver,
        { target: { kind: "pins", pins: [pins[0]!, pins[2]!] } },
        64,
      ).edits,
    ).document;
    expect(falseContacts(phi1)).toEqual([]);
    const phi2 = apply(
      phi1,
      planRouteNet(
        phi1,
        resolver,
        { target: { kind: "pins", pins: [pins[1]!, pins[3]!] } },
        64,
      ).edits,
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
        planRouteNet(
          document,
          resolver,
          {
            target: {
              kind: "pins",
              pins: [
                { instanceId: left!, pinName: "1" },
                { instanceId: leg!, pinName: "1" },
                { instanceId: right!, pinName: "2" },
              ],
            },
          },
          64,
        ).edits,
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
      planRouteNet(
        document,
        resolver,
        {
          target: {
            kind: "pins",
            pins: [
              { instanceId: "X1", pinName: "OUT" },
              { instanceId: "X1", pinName: "IN-" },
            ],
          },
        },
        64,
      ).edits,
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
      planRouteNet(
        document,
        resolver,
        {
          target: {
            kind: "pins",
            pins: [
              { instanceId: "Q1", pinName: "B" },
              { instanceId: "Q1", pinName: "C" },
            ],
          },
        },
        64,
      ).edits,
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
    const foreign = planWireBatch(
      document,
      resolver,
      [
        {
          id: "foreign",
          from: { kind: "free", point: { x: -20, y: 80 } },
          to: { kind: "free", point: { x: 20, y: 80 } },
        },
      ],
      64,
    );
    if (typeof foreign === "string") throw new Error(foreign);
    const current = apply(document, foreign.edits).document;
    const before = structuredClone(current);
    expect(() =>
      planRouteNet(
        current,
        resolver,
        { target: { kind: "pins", pins: [pins[0]!, pins[2]!] } },
        64,
      ),
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
      const plan = planRouteNet(
        document,
        projectResolver,
        { target: { kind: "import-net", sourceNetId: net.id } },
        64,
      );
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
      planRouteNet(
        document,
        resolver,
        { target: { kind: "net", net: "unknown" } },
        64,
      ),
    ).toThrow("found 0");
    expect(() =>
      planRouteNet(
        document,
        resolver,
        {
          target: {
            kind: "pins",
            pins: [pins[0]!, { instanceId: "missing", pinName: "1" }],
          },
        },
        64,
      ),
    ).toThrow("Missing route-net pin");
    document.instances[1]!.placement = null;
    expect(() =>
      planRouteNet(document, resolver, { target: { kind: "pins", pins } }, 64),
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
    const plan = planRouteNet(
      document,
      projectResolver,
      { target: { kind: "import-net", sourceNetId: sourceNet.id } },
      64,
    );
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
      planRouteNet(
        history.document,
        projectResolver,
        { target: { kind: "import-net", sourceNetId: sourceNet.id } },
        64,
      ).edits,
    ).toEqual([]);
  });
});
