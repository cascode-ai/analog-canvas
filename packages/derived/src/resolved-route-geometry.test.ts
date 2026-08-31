import { createRoutePath } from "@icm/model";
import { createEmptyProject } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  resolveDocumentRoutingGeometry,
  resolveRouteGeometry,
} from "./resolved-route-geometry.js";
import { resolveRouteAttachment } from "./route-attachment.js";
import { electricalTopologyHash } from "./topology-hash.js";

const resolver = new InMemorySymbolResolver([
  {
    schemaVersion: 1 as const,
    id: "dual",
    name: "Dual",
    viewBox: { x: -20, y: -20, width: 40, height: 40 },
    pins: [
      {
        name: "R",
        role: "passive",
        at: { x: 20, y: 0 },
        direction: "east" as const,
        presentation: { visibility: "visible" as const },
      },
    ],
    primitives: [
      { kind: "line" as const, from: { x: -10, y: 0 }, to: { x: 10, y: 0 } },
    ],
    variants: [],
  },
]);

function document(id: string): SchematicDocument {
  return createEmptyProject(id, id, id).documents[0]!;
}

describe("resolved route geometry", () => {
  it("characterizes the canonical stable-leg route contract", () => {
    const project = createEmptyProject(
      "route-contract",
      "Route contract",
      "doc",
    );
    const schematic = project.documents[0]!;
    schematic.nets.push({ id: "n", terminals: [] });
    schematic.junctions.push(
      { id: "j1", netId: "n", position: { x: 0, y: 0 } },
      { id: "j2", netId: "n", position: { x: 100, y: 100 } },
    );
    schematic.routes.push(
      createRoutePath({
        id: "route-contract",
        netId: "n",
        start: { kind: "junction", junctionId: "j1" },
        end: { kind: "junction", junctionId: "j2" },
        bends: [
          { x: 40, y: 0 },
          { x: 40, y: 100 },
        ],
        modes: ["escape", "manual", "trunk"],
      }),
    );

    const topologyBefore = electricalTopologyHash(project);
    const serializedRoute = JSON.parse(
      JSON.stringify(schematic.routes[0]),
    ) as unknown;
    const geometry = resolveRouteGeometry(
      schematic,
      resolver,
      schematic.routes[0]!,
    );

    expect(serializedRoute).toEqual(
      createRoutePath({
        id: "route-contract",
        netId: "n",
        start: { kind: "junction", junctionId: "j1" },
        end: { kind: "junction", junctionId: "j2" },
        bends: [
          { x: 40, y: 0 },
          { x: 40, y: 100 },
        ],
        modes: ["escape", "manual", "trunk"],
      }),
    );
    expect(geometry?.centerline).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 100 },
      { x: 100, y: 100 },
    ]);
    expect(geometry?.segments.map((segment) => segment.mode)).toEqual([
      "escape",
      "manual",
      "trunk",
    ]);
    expect(
      geometry &&
        resolveRouteAttachment(geometry, {
          routeId: "route-contract",
          legId: schematic.routes[0]!.legs[1]!.id,
          t: 0.25,
          direction: "forward",
          normalOffset: 10,
        }),
    ).toEqual({
      conductorPoint: { x: 40, y: 25 },
      labelPoint: { x: 30, y: 25 },
      rotation: 90,
    });

    const firstTarget = schematic.routes[0]!.legs[0]!.to;
    const secondTarget = schematic.routes[0]!.legs[1]!.to;
    if (firstTarget.kind === "bend") firstTarget.position.x = 60;
    if (secondTarget.kind === "bend") secondTarget.position.x = 60;
    expect(electricalTopologyHash(project)).toBe(topologyBefore);
  });

  it("resolves one canonical centerline with ordered segments and vertices", () => {
    const schematic = document("orthogonal-route");
    schematic.junctions.push(
      { id: "j1", netId: "n", position: { x: 0, y: 0 } },
      { id: "j2", netId: "n", position: { x: 100, y: 100 } },
    );
    schematic.routes.push(
      createRoutePath({
        id: "route-1",
        netId: "n",
        start: { kind: "junction", junctionId: "j1" },
        end: { kind: "junction", junctionId: "j2" },
        bends: [
          { x: 50, y: 0 },
          { x: 50, y: 100 },
        ],
        modes: ["manual", "auto", "escape"],
      }),
    );

    expect(
      resolveRouteGeometry(schematic, resolver, schematic.routes[0]!),
    ).toMatchObject({
      routeId: "route-1",
      netId: "n",
      centerline: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 100 },
        { x: 100, y: 100 },
      ],
      segments: [
        {
          address: { routeId: "route-1", segmentIndex: 0 },
          from: { x: 0, y: 0 },
          to: { x: 50, y: 0 },
          mode: "manual",
        },
        {
          address: { routeId: "route-1", segmentIndex: 1 },
          from: { x: 50, y: 0 },
          to: { x: 50, y: 100 },
          mode: "auto",
        },
        {
          address: { routeId: "route-1", segmentIndex: 2 },
          from: { x: 50, y: 100 },
          to: { x: 100, y: 100 },
          mode: "escape",
        },
      ],
      vertices: [
        { index: 0, kind: "junction", point: { x: 0, y: 0 } },
        { index: 1, kind: "bend", point: { x: 50, y: 0 } },
        { index: 2, kind: "bend", point: { x: 50, y: 100 } },
        { index: 3, kind: "junction", point: { x: 100, y: 100 } },
      ],
    });
  });

  it("is unresolved when either stored endpoint cannot be resolved", () => {
    const schematic = document("missing-endpoint");
    schematic.junctions.push({
      id: "present",
      netId: "n",
      position: { x: 100, y: 0 },
    });
    schematic.routes.push(
      createRoutePath({
        id: "route-missing",
        netId: "n",
        start: { kind: "junction", junctionId: "missing" },
        end: { kind: "junction", junctionId: "present" },
        bends: [],
        modes: ["manual"],
      }),
    );

    expect(
      resolveRouteGeometry(schematic, resolver, schematic.routes[0]!),
    ).toBeNull();
  });

  it("retains terminal miter ingredients at a real pin origin", () => {
    const schematic = document("terminal-miter");
    schematic.instances.push({
      id: "I1",
      symbolId: "dual",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    schematic.junctions.push({
      id: "j1",
      netId: "n",
      position: { x: 200, y: 100 },
    });
    schematic.routes.push(
      createRoutePath({
        id: "route-terminal",
        netId: "n",
        start: { kind: "terminal", instanceId: "I1", pinName: "R" },
        end: { kind: "junction", junctionId: "j1" },
        bends: [],
        modes: ["manual"],
      }),
    );

    expect(
      resolveRouteGeometry(schematic, resolver, schematic.routes[0]!)
        ?.endpointJoins,
    ).toEqual([
      {
        kind: "terminal-miter",
        routeId: "route-terminal",
        at: { x: 120, y: 100 },
        pinOutward: { x: 1, y: 0 },
        routeDirection: { x: 1, y: 0 },
      },
    ]);
  });

  it("aggregates deterministic route order and degree-two Junction joins", () => {
    const schematic = document("route-anchor");
    schematic.junctions.push(
      { id: "left", netId: "n", position: { x: 0, y: 0 } },
      {
        id: "anchor",
        netId: "n",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
      { id: "right", netId: "n", position: { x: 200, y: 0 } },
    );
    schematic.routes.push(
      createRoutePath({
        id: "z-right",
        netId: "n",
        start: { kind: "junction", junctionId: "anchor" },
        end: { kind: "junction", junctionId: "right" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "a-left",
        netId: "n",
        start: { kind: "junction", junctionId: "left" },
        end: { kind: "junction", junctionId: "anchor" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const geometry = resolveDocumentRoutingGeometry(schematic, resolver);
    expect([...geometry.routes.keys()]).toEqual(["a-left", "z-right"]);
    expect(geometry.endpointJoins).toEqual([
      {
        kind: "junction-miter",
        junctionId: "anchor",
        at: { x: 100, y: 0 },
        directions: [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
        ],
      },
    ]);
  });

  it("bridges a retained degree-two branch corner without treating it as a visible branch", () => {
    const schematic = document("branch-corner");
    schematic.junctions.push(
      { id: "left", netId: "n", position: { x: 0, y: 0 } },
      {
        id: "corner",
        netId: "n",
        position: { x: 100, y: 0 },
        role: "branch",
      },
      { id: "bottom", netId: "n", position: { x: 100, y: 100 } },
    );
    schematic.routes.push(
      createRoutePath({
        id: "horizontal",
        netId: "n",
        start: { kind: "junction", junctionId: "left" },
        end: { kind: "junction", junctionId: "corner" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "vertical",
        netId: "n",
        start: { kind: "junction", junctionId: "corner" },
        end: { kind: "junction", junctionId: "bottom" },
        bends: [],
        modes: ["manual"],
      }),
    );

    expect(
      resolveDocumentRoutingGeometry(schematic, resolver).endpointJoins,
    ).toContainEqual({
      kind: "junction-miter",
      junctionId: "corner",
      at: { x: 100, y: 0 },
      directions: [
        { x: -1, y: 0 },
        { x: 0, y: 1 },
      ],
    });
  });
});
