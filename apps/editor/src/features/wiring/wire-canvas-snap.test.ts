import { createRoutePath } from "@icm/model";
import { resolveDocumentRoutingGeometry } from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { resolveWireCanvasSnap } from "./wire-canvas-snap";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function source(
  contactPoint: { x: number; y: number } = { x: 0, y: 0 },
  instanceId = "R1",
): WireSource {
  const endpoint = {
    kind: "terminal" as const,
    instanceId,
    pinName: "1",
  };
  return {
    endpoint,
    netId: null,
    connection: {
      endpoint,
      contactPoint,
      gridLanding: contactPoint,
      escapePath: [],
      outward: null,
    },
    preludeEdits: [],
  };
}

describe("wire canvas snap", () => {
  it("uses only the grid while snap suppression is active", () => {
    const document = createEmptyDocument("document", "Document");
    document.presentation.grid = 10;

    expect(
      resolveWireCanvasSnap(
        {
          document,
          resolver,
          wiringEndpoints: [],
          routeGeometryRecords: [],
          contactComponents: [],
          wireSource: null,
          wireWaypoints: [],
          captureTolerance: 7,
        },
        { x: 24, y: 36 },
        true,
      ),
    ).toEqual({ point: { x: 20, y: 40 }, guides: [] });
  });

  it("snaps to a routed conductor and returns its segment address", () => {
    const document = createEmptyDocument("document", "Document");
    document.presentation.grid = 10;
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      {
        id: "j1",
        netId: "net",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "j2",
        netId: "net",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "route",
        netId: "net",
        start: { kind: "junction", junctionId: "j1" },
        end: { kind: "junction", junctionId: "j2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const routing = resolveDocumentRoutingGeometry(document, resolver);
    const geometry = routing.routes.get("route")!;

    const result = resolveWireCanvasSnap(
      {
        document,
        resolver,
        wiringEndpoints: [],
        routeGeometryRecords: [{ route: document.routes[0]!, geometry }],
        contactComponents: [],
        wireSource: null,
        wireWaypoints: [],
        captureTolerance: 8,
      },
      { x: 43, y: 3 },
      false,
    );

    expect(result.route).toEqual({
      routeId: "route",
      segmentIndex: 0,
      point: { x: 40, y: 0 },
    });
    expect(result.ambiguous).toBeUndefined();
  });

  it("excludes the active wire source from endpoint capture", () => {
    const document = createEmptyDocument("document", "Document");
    document.presentation.grid = 10;
    const active = source();

    const result = resolveWireCanvasSnap(
      {
        document,
        resolver,
        wiringEndpoints: [active],
        routeGeometryRecords: [],
        contactComponents: [],
        wireSource: active,
        wireWaypoints: [],
        captureTolerance: 8,
      },
      { x: 2, y: 2 },
      false,
    );

    expect(result.endpoint).toBeUndefined();
    expect(result.point).toEqual({ x: 0, y: 0 });
  });

  it("keeps a one-grid offset exactly where it was put", () => {
    // Offsetting a wire a single grid is ordinary drawing, not a wobble to be
    // corrected. An earlier axis hold straightened these away.
    const document = createEmptyDocument("document", "Document");
    document.presentation.grid = 10;
    const context = {
      document,
      resolver,
      wiringEndpoints: [],
      routeGeometryRecords: [],
      contactComponents: [],
      wireSource: source(),
      wireWaypoints: [{ x: -20, y: 0 }],
      captureTolerance: 7,
    };

    expect(
      resolveWireCanvasSnap(context, { x: -10, y: 40 }, false).point,
    ).toEqual({ x: -10, y: 40 });
    expect(
      resolveWireCanvasSnap(context, { x: 40, y: 10 }, false).point,
    ).toEqual({ x: 40, y: 10 });
  });

  it("does not create an axis snap from a remote electrical endpoint", () => {
    const document = createEmptyDocument("document", "Document");
    document.presentation.grid = 10;
    const remote = source({ x: 1000, y: 50 }, "R2");

    const result = resolveWireCanvasSnap(
      {
        document,
        resolver,
        wiringEndpoints: [remote],
        routeGeometryRecords: [],
        contactComponents: [],
        wireSource: null,
        wireWaypoints: [],
        captureTolerance: 8,
      },
      { x: 2, y: 44 },
      false,
    );

    expect(result.endpoint).toBeUndefined();
    expect(result.point).toEqual({ x: 0, y: 40 });
  });
});
