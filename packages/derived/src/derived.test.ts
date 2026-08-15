import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createEmptyProject, parseProject, serializeProject } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  buildOrthogonalEscapeRoute,
  deriveCrossings,
  deriveFlightlines,
  deriveVisibleConnectivity,
  normalizeRouteGeometry,
  proposeLocalStretch,
  resolveEndpointOutwardDirection,
  resolveEndpointPoint,
} from "./index.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function documentFixture() {
  return parseProject(
    readFileSync(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-3-routing/project.icproj.json",
      ),
      "utf8",
    ),
  ).documents[0]!;
}

const terminal = (instanceId: string) => ({
  kind: "terminal" as const,
  instanceId,
  pinName: "P",
});

describe("derived connectivity and route geometry", () => {
  it("builds pin-aware orthogonal escape geometry", () => {
    expect(
      buildOrthogonalEscapeRoute(
        { point: { x: 100, y: 100 }, outward: { x: 1, y: 0 } },
        { point: { x: 40, y: 80 } },
      ),
    ).toEqual({
      points: [
        { x: 100, y: 100 },
        { x: 120, y: 100 },
        { x: 120, y: 80 },
        { x: 40, y: 80 },
      ],
      waypoints: [
        { x: 120, y: 100 },
        { x: 120, y: 80 },
      ],
      segmentModes: ["escape", "auto", "auto"],
    });

    const document = documentFixture();
    expect(
      resolveEndpointOutwardDirection(document, resolver, terminal("A")),
    ).toEqual({ x: 1, y: 0 });
    expect(
      resolveEndpointOutwardDirection(document, resolver, terminal("B")),
    ).toEqual({ x: -1, y: 0 });
  });

  it("snaps escape-router midpoints to the document connection grid", () => {
    const route = buildOrthogonalEscapeRoute(
      { point: { x: 300, y: 240 }, outward: { x: 0, y: -1 } },
      { point: { x: 530, y: 140 }, outward: { x: 0, y: -1 } },
      10,
      10,
    );

    expect(route.points).toEqual([
      { x: 300, y: 240 },
      { x: 300, y: 230 },
      { x: 420, y: 230 },
      { x: 420, y: 130 },
      { x: 530, y: 130 },
      { x: 530, y: 140 },
    ]);
    expect(
      route.points.every((point) => point.x % 10 === 0 && point.y % 10 === 0),
    ).toBe(true);
  });

  it("resolves transformed Symbol pins and computes stable flightline MSTs", () => {
    const document = documentFixture();
    expect(resolveEndpointPoint(document, resolver, terminal("A"))).toEqual({
      x: 150,
      y: 300,
    });
    expect(resolveEndpointPoint(document, resolver, terminal("B"))).toEqual({
      x: 450,
      y: 300,
    });
    expect(resolveEndpointPoint(document, resolver, terminal("C"))).toEqual({
      x: 300,
      y: 150,
    });
    expect(resolveEndpointPoint(document, resolver, terminal("D"))).toEqual({
      x: 300,
      y: 450,
    });

    const flightlines = deriveFlightlines(document, resolver);
    expect(
      flightlines.map((line) => [
        line.netId,
        line.from.kind === "terminal" ? line.from.instanceId : "other",
        line.to.kind === "terminal" ? line.to.instanceId : "other",
      ]),
    ).toEqual([
      ["net-h", "B", "E"],
      ["net-h", "A", "E"],
      ["net-v", "C", "D"],
    ]);
    expect(flightlines[0]!.distance).toBeCloseTo(Math.hypot(110, 150));
    expect(flightlines[1]!.distance).toBeCloseTo(Math.hypot(190, 150));
    expect(flightlines[2]!.distance).toBeCloseTo(300);
    expect(deriveFlightlines(document, resolver)).toEqual(flightlines);
  });

  it("treats geometric crossing as separate explicit graph components", () => {
    const document = documentFixture();
    document.routes = [
      {
        id: "route-h",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("B"),
        waypoints: [],
        segmentModes: ["manual"],
      },
      {
        id: "route-v",
        netId: "net-v",
        from: terminal("C"),
        to: terminal("D"),
        waypoints: [],
        segmentModes: ["manual"],
      },
    ];
    expect(deriveCrossings(document, resolver)).toEqual([
      {
        routeAId: "route-h",
        routeBId: "route-v",
        netAId: "net-h",
        netBId: "net-v",
        point: { x: 300, y: 300 },
        kind: "crossing",
      },
    ]);
    const connectivity = deriveVisibleConnectivity(document, resolver);
    expect(
      connectivity.find((net) => net.netId === "net-h")?.components,
    ).toHaveLength(2);
    expect(
      connectivity.find((net) => net.netId === "net-v")?.components,
    ).toHaveLength(1);
    const remaining = deriveFlightlines(document, resolver);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      from: { kind: "terminal", instanceId: "B" },
      to: { kind: "terminal", instanceId: "E" },
    });
  });

  it("normalizes duplicate/collinear points and proposes local endpoint stretch", () => {
    expect(
      normalizeRouteGeometry(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 10 },
        ],
        ["auto", "manual", "escape", "trunk"],
      ),
    ).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
      ],
      segmentModes: ["manual", "trunk"],
    });

    const document = documentFixture();
    document.routes = [
      {
        id: "route-h",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("B"),
        waypoints: [],
        segmentModes: ["manual"],
      },
    ];
    expect(
      proposeLocalStretch(document, resolver, "A", { x: 140, y: 360 }),
    ).toEqual([
      {
        routeId: "route-h",
        waypoints: [{ x: 450, y: 360 }],
        segmentModes: ["manual", "manual"],
      },
    ]);
  });

  it("rejects local stretch beside a protected segment", () => {
    const document = documentFixture();
    document.routes = [
      {
        id: "route-h",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("B"),
        waypoints: [],
        segmentModes: ["locked"],
      },
    ];
    expect(() =>
      proposeLocalStretch(document, resolver, "A", { x: 140, y: 360 }),
    ).toThrow(/protected adjacent segment/u);
  });

  it("changes only endpoint-adjacent geometry during a local stretch", () => {
    const document = documentFixture();
    document.routes = [
      {
        id: "route-h",
        netId: "net-h",
        from: terminal("A"),
        to: terminal("B"),
        waypoints: [
          { x: 180, y: 300 },
          { x: 180, y: 260 },
          { x: 420, y: 260 },
          { x: 420, y: 300 },
        ],
        segmentModes: ["manual", "manual", "manual", "manual", "manual"],
      },
    ];

    expect(
      proposeLocalStretch(document, resolver, "A", { x: 140, y: 360 }),
    ).toEqual([
      {
        routeId: "route-h",
        waypoints: [
          { x: 180, y: 360 },
          { x: 180, y: 260 },
          { x: 420, y: 260 },
          { x: 420, y: 300 },
        ],
        segmentModes: ["manual", "manual", "manual", "manual", "manual"],
      },
    ]);
  });
});
