import { describe, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  createRoutePath,
  freezeSnapshot,
  routeEnd,
  transformPoint,
  SchematicDocumentSchema,
  type SchematicDocument,
  type Point,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "@icm/derived";
import {
  proposeLooseRouteTranslation,
  proposeRouteEndpointMove,
} from "./route-endpoint-move.js";
import {
  proposeWireSegmentMove,
  prepareWireSegmentMove,
} from "./routing-planner.js";
import { proposeWireSegmentDrag } from "./index.js";
import {
  createRoutingOperationPlan,
  gateRoutingOperationPlan,
} from "./routing-operation-plan.js";
import type { SchematicEdit } from "./edit-schema.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function looseWires(): SchematicDocument {
  const d = createEmptyDocument("drag-regression", "Drag regression");
  d.presentation.grid = 10;
  d.nets.push({ id: "n", terminals: [] }, { id: "m", terminals: [] });
  for (const [id, netId, x, y] of [
    ["A", "n", 0, 0],
    ["B", "n", 100, 0],
    ["X", "m", 50, 50],
    ["Y", "m", 150, 50],
  ] as const)
    d.junctions.push({ id, netId, position: { x, y }, role: "route-anchor" });
  for (const [id, netId, a, b] of [
    ["r", "n", "A", "B"],
    ["s", "m", "X", "Y"],
  ] as const)
    d.routes.push(
      createRoutePath({
        id,
        netId,
        start: { kind: "junction", junctionId: a },
        end: { kind: "junction", junctionId: b },
        bends: [],
        modes: ["manual"],
      }),
    );
  return d;
}
function port(
  d: SchematicDocument,
  id: string,
  netId: string,
  position: Point,
) {
  d.instances.push({
    id,
    symbolId: "port",
    placement: { position, rotation: 0, mirror: "none" },
  });
  d.nets
    .find((net) => net.id === netId)!
    .terminals.push({ instanceId: id, pinName: "P" });
  d.netlist!.terminals.push({
    id: `cell-${id}`,
    name: id,
    netId,
    direction: "passive",
    interfaceInstanceIds: [id],
  });
}
function commit(
  d: SchematicDocument,
  edits: readonly SchematicEdit[],
  expectedElectricalEffect?: ReturnType<
    typeof proposeWireSegmentMove
  >["expectedElectricalEffect"],
) {
  expect(SchematicDocumentSchema.safeParse(d).success).toBe(true);
  const plan = createRoutingOperationPlan(d, {
    intent: "route-geometry",
    edits,
    diagnostics: [],
    ...(expectedElectricalEffect ? { expectedElectricalEffect } : {}),
  });
  const result = gateRoutingOperationPlan(d, plan, {
    symbolResolver: resolver,
  });
  expect(result.ok, result.ok ? "" : result.message).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.evaluated.finalDocument;
}
function conductorNets(d: SchematicDocument) {
  return new Set(d.routes.map((r) => r.netId));
}

describe("atomic endpoint landing", () => {
  it("keeps endpoint landing reads off per-pin full instance scans", () => {
    const document = looseWires();
    for (let index = 0; index < 100; index++)
      document.instances.push({
        id: `R${index}`,
        symbolId: "resistor",
        placement: {
          position: { x: 1000, y: 1000 + index * 100 },
          rotation: 0,
          mirror: "none",
        },
      });
    const find = Array.prototype.find;
    let scans = 0;
    const spy = vi.spyOn(Array.prototype, "find").mockImplementation(function (
      this: unknown[],
      predicate,
      thisArg,
    ) {
      if (this === document.instances) scans++;
      return find.call(this, predicate, thisArg);
    });
    try {
      const plan = proposeRouteEndpointMove(
        document,
        resolver,
        "r",
        "start",
        { x: 40, y: 30 },
        "local",
      );
      expect(plan.preview?.junctions).toEqual([
        { junctionId: "A", position: { x: 40, y: 30 } },
      ]);
      expect(plan.edits.some((edit) => edit.kind === "merge_nets")).toBe(false);
      expect(scans).toBeLessThan(20);
    } finally {
      spy.mockRestore();
    }
  });
  it("merges a pair of Nets only once when both loose ends land on endpoints", () => {
    const d = looseWires();
    const before = structuredClone(d);
    const p = proposeLooseRouteTranslation(
      d,
      "r",
      { x: 50, y: 50 },
      { resolver, suffix: "overlap" },
    );
    expect(p.edits.filter((e) => e.kind === "merge_nets")).toHaveLength(1);
    const final = commit(d, p.edits);
    expect(conductorNets(final).size).toBe(1);
    expect(final.routes).toHaveLength(1);
    expect(d).toEqual(before);
  });
  it("shares membership state between an endpoint landing and a span landing", () => {
    const d = looseWires();
    d.junctions.find((j) => j.id === "Y")!.position.x = 250;
    const p = proposeLooseRouteTranslation(
      d,
      "r",
      { x: 50, y: 50 },
      { resolver, suffix: "mixed" },
    );
    expect(p.edits.filter((e) => e.kind === "merge_nets")).toHaveLength(1);
    expect(conductorNets(commit(d, p.edits)).size).toBe(1);
  });
  it("joins three Nets when opposite ends land inside different conductors", () => {
    const d = looseWires();
    d.nets.push({ id: "third", terminals: [] });
    d.junctions.find((j) => j.id === "Y")!.position = { x: 50, y: 150 };
    d.junctions.push(
      {
        id: "T1",
        netId: "third",
        position: { x: 150, y: 50 },
        role: "route-anchor",
      },
      {
        id: "T2",
        netId: "third",
        position: { x: 150, y: 150 },
        role: "route-anchor",
      },
    );
    d.routes.push(
      createRoutePath({
        id: "third-wire",
        netId: "third",
        start: { kind: "junction", junctionId: "T1" },
        end: { kind: "junction", junctionId: "T2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const p = proposeLooseRouteTranslation(
      d,
      "r",
      { x: 50, y: 100 },
      { resolver, suffix: "two-spans" },
    );
    expect(conductorNets(commit(d, p.edits)).size).toBe(1);
  });
  it.each([false, true])(
    "classifies coincident terminals as endpoints regardless of instance order (%s)",
    (reverse) => {
      const d = looseWires();
      port(d, "P1", "n", { x: 50, y: 50 });
      port(d, "P2", "m", { x: 50, y: 50 });
      if (reverse) d.instances.reverse();
      d.routes[1]!.start = { kind: "terminal", instanceId: "P2", pinName: "P" };
      const p = proposeRouteEndpointMove(
        d,
        resolver,
        "r",
        "start",
        { x: 50, y: 50 },
        "coincident",
      );
      expect(p.edits.some((e) => e.kind === "attach_endpoint_to_route")).toBe(
        false,
      );
      const final = commit(d, p.edits);
      expect(conductorNets(final).size).toBe(1);
      expect(
        final.nets.find((n) => n.terminals.some((t) => t.instanceId === "P1"))
          ?.terminals,
      ).toContainEqual({ instanceId: "P2", pinName: "P" });
    },
  );
});

describe("terminal-aware shortening", () => {
  it("preserves an existing opposite-side approach when dragging a two-pin crossbar", () => {
    const d = createEmptyDocument("existing-detour", "Existing detour");
    d.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 270, y: 230 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 530, y: 230 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    d.nets.push({
      id: "n",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    d.routes.push(
      createRoutePath({
        id: "r",
        netId: "n",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
        end: { kind: "terminal", instanceId: "R2", pinName: "1" },
        bends: [{ x: 530, y: 250 }],
        modes: ["manual", "manual"],
      }),
    );
    const p = proposeWireSegmentMove(d, resolver, "r", 0, { x: 400, y: 330 });
    const final = commit(d, p.edits);
    const points = resolveRouteGeometry(
      final,
      resolver,
      final.routes[0]!,
    )!.centerline;
    expect(points).toEqual([
      { x: 270, y: 250 },
      { x: 270, y: 330 },
      { x: 530, y: 330 },
      { x: 530, y: 210 },
    ]);
  });
  it.each([0, 90, 180, 270] as const)(
    "does not fold wire over a Port lead at rotation %s",
    (rotation) => {
      for (const mirror of [
        "none",
        "horizontal",
        "vertical",
        "both",
      ] as const) {
        for (const reverse of [false, true]) {
          const d = looseWires();
          d.routes = [];
          d.nets = d.nets.slice(0, 1);
          d.junctions = d.junctions.filter((j) => j.id === "B");
          port(d, "P1", "n", { x: 300, y: 300 });
          d.instances[0]!.placement = {
            position: { x: 300, y: 300 },
            rotation,
            mirror,
          };
          const at = (p: Point) =>
            transformPoint(p, { x: 300, y: 300 }, { rotation, mirror });
          d.junctions[0]!.position = at({ x: 200, y: 100 });
          const ends = [
            { kind: "terminal" as const, instanceId: "P1", pinName: "P" },
            { kind: "junction" as const, junctionId: "B" },
          ];
          const bends = [at({ x: 100, y: 0 }), at({ x: 100, y: 100 })];
          if (reverse) {
            ends.reverse();
            bends.reverse();
          }
          d.routes.push(
            createRoutePath({
              id: "p",
              netId: "n",
              start: ends[0]!,
              end: ends[1]!,
              bends,
              modes: ["manual", "manual", "manual"],
            }),
          );
          const p = proposeWireSegmentMove(
            d,
            resolver,
            "p",
            1,
            at({ x: 0, y: 50 }),
          );
          const final = commit(d, p.edits);
          const wire = final.routes.find((r) => r.id === "p")!;
          let points = [
            ...resolveRouteGeometry(final, resolver, wire)!.centerline,
          ];
          if (reverse) points.reverse();
          expect(points).toEqual([
            at({ x: 0, y: 0 }),
            at({ x: 0, y: 100 }),
            at({ x: 200, y: 100 }),
          ]);
          expect(final.instances).toEqual(d.instances);
          expect(wire.start).toEqual(d.routes[0]!.start);
          expect(routeEnd(wire)).toEqual(routeEnd(d.routes[0]!));
          const pin = resolveEndpointConnection(final, resolver, {
            kind: "terminal",
            instanceId: "P1",
            pinName: "P",
          })!;
          expect(points[0]).toEqual(pin.contactPoint);
          const preview = p.preview!.routes[0]!;
          expect(
            reverse ? [...preview.waypoints].reverse() : preview.waypoints,
          ).toEqual(points.slice(1, -1));
        }
      }
    },
  );
});

describe("segment landing on an endpoint", () => {
  it("ignores caller-provided prepared hints at the public drag boundary", () => {
    const document = looseWires();
    const unownedHint = { document };
    document.junctions.push({
      id: "C",
      netId: "n",
      position: { x: 0, y: -100 },
    });
    document.routes.push(
      createRoutePath({
        id: "branch",
        netId: "n",
        start: { kind: "junction", junctionId: "A" },
        end: { kind: "junction", junctionId: "C" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const actual = Reflect.apply(proposeWireSegmentDrag, undefined, [
      document,
      resolver,
      "r",
      0,
      { x: 50, y: 30 },
      undefined,
      unownedHint,
    ]);
    expect(
      actual.routes.map((route: { routeId: string }) => route.routeId),
    ).toEqual(["branch", "r"]);
    expect(actual.junctions).toEqual([
      { junctionId: "A", position: { x: 0, y: 30 } },
      { junctionId: "B", position: { x: 100, y: 30 } },
    ]);
  });
  it("refreshes prepared reads for mutable Documents and replaced custom Symbol definitions", () => {
    const mutable = looseWires();
    const prepareMutable = prepareWireSegmentMove(mutable, resolver);
    prepareMutable("r", 0, { x: 50, y: 20 });
    mutable.junctions[0]!.position.x = -10;
    expect(
      prepareMutable("r", 0, { x: 50, y: 30 }).preview?.junctions[0],
    ).toEqual({ junctionId: "A", position: { x: -10, y: 30 } });
    const source = createEmptyDocument("symbols", "Symbols");
    source.instances = [0, 100].map((x, index) => ({
      id: `R${index}`,
      symbolId: index === 0 ? "custom-resistor" : "resistor",
      placement: { position: { x, y: -20 }, rotation: 0, mirror: "none" },
    }));
    source.nets.push({
      id: "n",
      terminals: [0, 1].map((index) => ({
        instanceId: `R${index}`,
        pinName: "2",
      })),
    });
    source.routes.push(
      createRoutePath({
        id: "r",
        netId: "n",
        start: { kind: "terminal", instanceId: "R0", pinName: "2" },
        end: { kind: "terminal", instanceId: "R1", pinName: "2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const custom = structuredClone(resolver.resolve("resistor")!.definition);
    custom.id = "custom-resistor";
    let catalog = new InMemorySymbolResolver([custom], resolver);
    const liveResolver = {
      resolve: (id: string, variant?: string) => catalog.resolve(id, variant),
    };
    const document = freezeSnapshot(source);
    const prepare = prepareWireSegmentMove(document, liveResolver);
    prepare("r", 0, { x: 50, y: 50 });
    custom.pins.find((pin) => pin.name === "2")!.at = { x: 80, y: 40 };
    catalog = new InMemorySymbolResolver([custom], resolver);
    // The changed pin makes this a 45-degree leg. This target now folds it
    // back and must be refused, rather than using the cached horizontal run.
    expect(() => prepare("r", 0, { x: 50, y: 50 }, { x: 50, y: 0 })).toThrow(
      "Segment move would fold the wire back",
    );
    expect(() =>
      proposeWireSegmentMove(
        document,
        liveResolver,
        "r",
        0,
        { x: 50, y: 50 },
        { x: 50, y: 0 },
      ),
    ).toThrow("Segment move would fold the wire back");
  });
  it("retains source geometry and incident routes between segment pointer positions", () => {
    const source = looseWires();
    for (let index = 0; index < 100; index++) {
      source.junctions.push(
        {
          id: `bg-a${index}`,
          netId: "n",
          position: { x: 1000, y: 1000 + index * 20 },
        },
        {
          id: `bg-b${index}`,
          netId: "n",
          position: { x: 1100, y: 1000 + index * 20 },
        },
      );
      source.routes.push(
        createRoutePath({
          id: `bg-r${index}`,
          netId: "n",
          start: { kind: "junction", junctionId: `bg-a${index}` },
          end: { kind: "junction", junctionId: `bg-b${index}` },
          bends: [],
          modes: ["manual"],
        }),
      );
    }
    const document = freezeSnapshot(source);
    const prepare = prepareWireSegmentMove(document, resolver);
    prepare("r", 0, { x: 50, y: 10 });
    const sort = Array.prototype.sort;
    const iterator = Array.prototype[Symbol.iterator];
    let fullRouteIterations = 0;
    Array.prototype[Symbol.iterator] = function (this: unknown[]) {
      if (this === document.routes) fullRouteIterations++;
      return iterator.call(this);
    };
    let fullSorts = 0;
    const spy = vi.spyOn(Array.prototype, "sort").mockImplementation(function (
      this: unknown[],
      compare,
    ) {
      if (
        this.length === document.routes.length &&
        this[0] === document.routes[0]
      )
        fullSorts++;
      return sort.call(this, compare);
    });
    try {
      for (const y of [20, 30, 40]) {
        expect(prepare("r", 0, { x: 50, y }).preview?.junctions).toEqual([
          { junctionId: "A", position: { x: 0, y } },
          { junctionId: "B", position: { x: 100, y } },
        ]);
      }
      // One full projection of the changed canvas per frame remains necessary;
      // the unchanged source must not be resolved twice again per frame.
      expect(fullSorts).toBeLessThanOrEqual(3);
      expect(fullRouteIterations).toBe(0);
    } finally {
      spy.mockRestore();
      Array.prototype[Symbol.iterator] = iterator;
    }
  });
  it("plans segment geometry without cloning the source document", () => {
    const d = looseWires();
    const before = structuredClone(d);
    const clone = structuredClone;
    let sourceClones = 0;
    const spy = vi
      .spyOn(globalThis, "structuredClone")
      .mockImplementation((value, options) => {
        if (value === d) sourceClones++;
        return clone(value, options);
      });
    try {
      const plan = proposeWireSegmentMove(d, resolver, "r", 0, {
        x: 50,
        y: 30,
      });
      expect(plan.preview?.junctions).toEqual([
        { junctionId: "A", position: { x: 0, y: 30 } },
        { junctionId: "B", position: { x: 100, y: 30 } },
      ]);
      expect(plan.expectedElectricalEffect).toBeUndefined();
      expect(d).toEqual(before);
      expect(sourceClones).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
  it("connects and dots a capacitor pin touched by the moved segment", () => {
    const d = createEmptyDocument("segment-pin", "Segment pin contact");
    d.presentation.grid = 10;
    d.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 0, y: -20 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: -20 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "C1",
        symbolId: "capacitor",
        placement: {
          position: { x: 50, y: 120 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    d.nets.push({
      id: "n",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "2" },
      ],
    });
    d.nets.push({
      id: "capacitor-top",
      terminals: [{ instanceId: "C1", pinName: "1" }],
    });
    d.routes.push(
      createRoutePath({
        id: "r",
        netId: "n",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
        end: { kind: "terminal", instanceId: "R2", pinName: "2" },
        bends: [],
        modes: ["manual"],
      }),
    );

    // Pull the straight wire down into a U. Its new horizontal segment lands
    // on C1.1 at (50,100), the same gesture as the reported capacitor case.
    const proposal = proposeWireSegmentMove(d, resolver, "r", 0, {
      x: 50,
      y: 100,
    });
    const final = commit(d, proposal.edits, proposal.expectedElectricalEffect);

    const capacitorNetId = final.nets.find((net) =>
      net.terminals.some(
        (terminal) => terminal.instanceId === "C1" && terminal.pinName === "1",
      ),
    )?.id;
    expect(capacitorNetId).toBe(final.routes[0]?.netId);
    expect(conductorNets(final).size).toBe(1);
    expect(final.routes).toHaveLength(2);
    const contact = deriveDocumentContactEvidence(
      final,
      resolver,
    ).contacts.find(
      (candidate) => candidate.point.x === 50 && candidate.point.y === 100,
    );
    expect(contact).toBeDefined();
    expect(contactRequiresJunctionDot(contact!)).toBe(true);
  });

  it("connects when a moved segment lands on another wire endpoint", () => {
    const d = looseWires();
    d.junctions.find((junction) => junction.id === "X")!.position = {
      x: 0,
      y: 50,
    };
    d.junctions.find((junction) => junction.id === "Y")!.position = {
      x: -100,
      y: 50,
    };
    const proposal = proposeWireSegmentMove(d, resolver, "r", 0, {
      x: 50,
      y: 50,
    });
    const final = commit(d, proposal.edits, proposal.expectedElectricalEffect);

    expect(conductorNets(final).size).toBe(1);
  });

  it("keeps a true wire-interior crossing unconnected", () => {
    const d = looseWires();
    d.junctions.find((junction) => junction.id === "X")!.position = {
      x: 50,
      y: 20,
    };
    d.junctions.find((junction) => junction.id === "Y")!.position = {
      x: 50,
      y: 80,
    };
    const proposal = proposeWireSegmentMove(d, resolver, "r", 0, {
      x: 50,
      y: 50,
    });
    const final = commit(d, proposal.edits, proposal.expectedElectricalEffect);

    expect(conductorNets(final).size).toBe(2);
  });
});
