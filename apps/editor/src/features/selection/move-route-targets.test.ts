import { describe, expect, it } from "vitest";
import { createEmptyDocument, createRoutePath, type Point } from "@icm/model";
import { resolveRouteGeometry } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { prepareMoveRouteTargets } from "./move-route-targets";

function records(lines: [Point, Point][]) {
  const document = createEmptyDocument("targets", "Targets");
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  return lines.map(([from, to], index) => {
    const id = `r${index}`;
    document.junctions.push(
      { id: `${id}-a`, netId: id, position: from },
      { id: `${id}-b`, netId: id, position: to },
    );
    document.nets.push({ id, terminals: [] });
    const route = createRoutePath({
      id,
      netId: id,
      start: { kind: "junction", junctionId: `${id}-a` },
      end: { kind: "junction", junctionId: `${id}-b` },
      bends: [],
      modes: ["manual"],
    });
    document.routes.push(route);
    return {
      route,
      geometry: resolveRouteGeometry(document, resolver, route)!,
    };
  });
}
const moving = {
  id: "pin",
  point: { x: 0, y: 0 },
  kind: "pin" as const,
  electrical: {
    kind: "endpoint" as const,
    endpoint: { kind: "terminal" as const, instanceId: "R", pinName: "1" },
    netId: "n",
  },
};

describe("move conductor target enumeration", () => {
  it("retains endpoint projections rounded just outside the mathematical segment box", () => {
    const project = prepareMoveRouteTargets(
      records([
        [
          { x: 100, y: 0 },
          { x: 0.3, y: 0 },
        ],
      ]),
    );
    // Existing closestPointOnSegment returns this IEEE-rounded endpoint at t=1.
    const x = 0.29999999999999716;
    expect(project(moving, { x, y: 0 }, 0).map((a) => a.point)).toEqual([
      { x, y: 0 },
    ]);
  });
  it("retains exact tolerance boundaries, diagonal projections and input tie order", () => {
    const project = prepareMoveRouteTargets(
      records([
        [
          { x: -80, y: 10 },
          { x: 80, y: 10 },
        ],
        [
          { x: -20, y: -20 },
          { x: 20, y: 20 },
        ],
        [
          { x: -80, y: 10.001 },
          { x: 80, y: 10.001 },
        ],
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      ]),
    );
    const result = project(moving, { x: 0, y: 0 }, 10);
    expect(result.map((a) => a.id)).toEqual([
      "move-route:pin:r0:0",
      "move-route:pin:r1:0",
      "move-route:pin:r3:0",
    ]);
    expect(result.map((a) => a.point)).toEqual([
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(result.every((a) => a.acceptsMovingAnchorId === "pin")).toBe(true);
  });
  it("keeps long segments in a bounded fallback and queries the moved pin, not the pointer", () => {
    const project = prepareMoveRouteTargets(
      records([
        [
          { x: -1e9, y: 800 },
          { x: 1e9, y: 800 },
        ],
        [
          { x: -10, y: 900 },
          { x: 10, y: 900 },
        ],
      ]),
    );
    expect(project(moving, { x: 0, y: 800 }, 0).map((a) => a.point)).toEqual([
      { x: 0, y: 800 },
    ]);
    expect(
      project(
        { id: "body", point: moving.point, kind: "instance-center" },
        { x: 0, y: 800 },
        10,
      ),
    ).toEqual([]);
    expect(
      project(moving, { x: 0, y: 800 }, Infinity).map((a) => a.id),
    ).toEqual(["move-route:pin:r0:0", "move-route:pin:r1:0"]);
  });
});
