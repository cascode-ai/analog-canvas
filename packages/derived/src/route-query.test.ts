import { describe, expect, it } from "vitest";

import { createEmptyDocument, createRoutePath } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";

import { deriveCrossings, resolveRouteTap } from "./route-query.js";
import type { ResolvedRouteGeometry } from "./resolved-route-geometry.js";

function geometry(
  points: Array<{ x: number; y: number }>,
): ResolvedRouteGeometry {
  return {
    routeId: "route-1",
    netId: "net-1",
    centerline: points,
    segments: points.slice(0, -1).map((from, segmentIndex) => ({
      address: {
        routeId: "route-1",
        legId: `route-1-leg-${segmentIndex}`,
        segmentIndex,
      },
      from,
      to: points[segmentIndex + 1]!,
      mode: "manual" as const,
    })),
    vertices: points.map((point, index) => ({
      index,
      point,
      kind:
        index === 0 || index === points.length - 1
          ? ("junction" as const)
          : ("bend" as const),
    })),
    endpointJoins: [],
    endpointConnections: {
      from: {
        endpoint: { kind: "junction", junctionId: "from" },
        contactPoint: points[0]!,
        gridLanding: points[0]!,
        escapePath: [],
        outward: null,
      },
      to: {
        endpoint: { kind: "junction", junctionId: "to" },
        contactPoint: points.at(-1)!,
        gridLanding: points.at(-1)!,
        escapePath: [],
        outward: null,
      },
    },
  };
}

describe("route queries", () => {
  it("finds crossings and overlaps while excluding a shared explicit endpoint", () => {
    const document = createEmptyDocument("crossings", "Crossings");
    const junctions = [
      ["J1", "net-a", 0, 0],
      ["J2", "net-a", 100, 0],
      ["J3", "net-b", 50, -50],
      ["J4", "net-b", 50, 50],
      ["J5", "net-c", 20, 0],
      ["J6", "net-c", 80, 0],
      ["J7", "net-a", 100, 50],
    ] as const;
    document.nets.push(
      ...["net-a", "net-b", "net-c"].map((id) => ({
        id,
        terminals: [],
      })),
    );
    document.junctions.push(
      ...junctions.map(([id, netId, x, y]) => ({
        id,
        netId,
        position: { x, y },
      })),
    );
    const route = (id: string, netId: string, start: string, end: string) =>
      createRoutePath({
        id,
        netId,
        start: { kind: "junction", junctionId: start },
        end: { kind: "junction", junctionId: end },
        bends: [],
        modes: ["manual"],
      });
    document.routes.push(
      route("route-a", "net-a", "J1", "J2"),
      route("route-b", "net-b", "J3", "J4"),
      route("route-c", "net-c", "J5", "J6"),
      route("route-d", "net-a", "J2", "J7"),
    );

    expect(deriveCrossings(document, new InMemorySymbolResolver([]))).toEqual([
      {
        routeAId: "route-a",
        routeBId: "route-b",
        netAId: "net-a",
        netBId: "net-b",
        point: { x: 50, y: 0 },
        kind: "crossing",
      },
      {
        routeAId: "route-a",
        routeBId: "route-c",
        netAId: "net-a",
        netBId: "net-c",
        point: { x: 20, y: 0 },
        kind: "overlap",
      },
      {
        routeAId: "route-b",
        routeBId: "route-c",
        netAId: "net-b",
        netBId: "net-c",
        point: { x: 50, y: 0 },
        kind: "crossing",
      },
    ]);
  });

  it("prefers an in-tolerance interior vertex over a closer segment projection", () => {
    expect(
      resolveRouteTap(
        geometry([
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ]),
        { x: 100, y: 3 },
        10,
      ),
    ).toMatchObject({
      address: { routeId: "route-1", segmentIndex: 0 },
      point: { x: 100, y: 0 },
      distanceSquared: 9,
    });
  });

  it("projects to every Route segment, clamps endpoints, and includes diagonals", () => {
    expect(
      resolveRouteTap(
        geometry([
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ]),
        { x: 50, y: 6 },
        10,
      ),
    ).toMatchObject({ point: { x: 50, y: 0 }, distanceSquared: 36 });
    expect(
      resolveRouteTap(
        geometry([
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ]),
        { x: 200, y: 0 },
        10,
      ),
    ).toBeNull();
    expect(
      resolveRouteTap(
        geometry([
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ]),
        { x: 50, y: 50 },
        10,
      ),
    ).toMatchObject({ point: { x: 50, y: 50 }, distanceSquared: 0 });
  });

  it("breaks equal-distance route hits by the lower segment index", () => {
    expect(
      resolveRouteTap(
        geometry([
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 100, y: 0 },
          { x: 150, y: 0 },
        ]),
        { x: 75, y: 0 },
        30,
      )?.address,
    ).toEqual({
      routeId: "route-1",
      legId: "route-1-leg-0",
      segmentIndex: 0,
    });
  });
});
