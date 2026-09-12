import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createRoutePath,
  routeEnd,
  transformPoint,
  SchematicDocumentSchema,
  type SchematicDocument,
  type Point,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { resolveEndpointConnection, resolveRouteGeometry } from "@icm/derived";
import {
  proposeLooseRouteTranslation,
  proposeRouteEndpointMove,
  proposeWireSegmentMove,
} from "./routing-planner.js";
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
function commit(d: SchematicDocument, edits: readonly SchematicEdit[]) {
  expect(SchematicDocumentSchema.safeParse(d).success).toBe(true);
  const plan = createRoutingOperationPlan(d, {
    intent: "route-geometry",
    edits,
    diagnostics: [],
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
      port(d, "P1", "n", { x: 40, y: 50 });
      port(d, "P2", "m", { x: 40, y: 50 });
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
  it.each([0, 90, 180, 270] as const)(
    "does not fold wire over a Port lead at rotation %s",
    (rotation) => {
      for (const mirror of ["none", "x"] as const) {
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
            at({ x: 10, y: 0 }),
            at({ x: 10, y: 100 }),
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
