import { createRoutePath } from "@icm/model";
import {
  deriveVisibleConnectivity,
  resolveDocumentRoutingGeometry,
  resolveEndpointConnection,
} from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import { createEmptyDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  resolveWireCanvasSnap,
  type WireCanvasSnapContext,
} from "./wire-canvas-snap";

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
  it("selects each dense AND pin independently without joining its neighbors", () => {
    const document = createEmptyDocument("fine-snap", "Fine snap");
    document.instances.push({
      id: "X1",
      symbolId: "and-gate-4",
      placement: { position: { x: 200, y: 100 }, rotation: 0, mirror: "none" },
    });
    const wiringEndpoints = ["A", "B", "C", "D"].map((pinName) => {
      const endpoint = { kind: "terminal" as const, instanceId: "X1", pinName };
      return {
        endpoint,
        netId: null,
        connection: resolveEndpointConnection(document, resolver, endpoint)!,
        preludeEdits: [],
      } satisfies WireSource;
    });
    const context: WireCanvasSnapContext = {
      document,
      resolver,
      wiringEndpoints,
      routeGeometryRecords: [],
      contactComponents: [],
      wireSource: null,
      wireWaypoints: [],
      captureTolerance: 5,
    };
    for (const [index, pinName] of ["A", "B", "C", "D"].entries()) {
      const y = [88, 96, 104, 112][index]!;
      const result = resolveWireCanvasSnap(context, { x: 170, y }, false);
      expect(result.point).toEqual({ x: 170, y });
      expect(result.endpoint?.endpoint).toEqual({
        kind: "terminal",
        instanceId: "X1",
        pinName,
      });
      expect(result.ambiguous).toBeUndefined();
    }
  });
  function conductorContext(diagonal = false): WireCanvasSnapContext {
    const document = createEmptyDocument("snap", "Snap");
    document.presentation.grid = 10;
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      { id: "a", netId: "net", position: { x: 0, y: 0 } },
      { id: "b", netId: "net", position: { x: 100, y: diagonal ? 100 : 0 } },
    );
    const route = createRoutePath({
      id: "route",
      netId: "net",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [],
      modes: ["manual"],
    });
    document.routes.push(route);
    return {
      document,
      resolver,
      wiringEndpoints: [],
      contactComponents: [],
      routeGeometryRecords: [
        {
          route,
          geometry: resolveDocumentRoutingGeometry(
            document,
            resolver,
          ).routes.get(route.id)!,
        },
      ],
      wireSource: null,
      wireWaypoints: [],
      captureTolerance: 1,
    };
  }

  it.each([false, true])(
    "captures between grid points before quantizing (diagonal=%s)",
    (diagonal) => {
      const result = resolveWireCanvasSnap(
        conductorContext(diagonal),
        { x: 45, y: diagonal ? 45 : 0 },
        false,
      );
      expect(result.route?.point).toEqual({ x: 50, y: diagonal ? 50 : 0 });
    },
  );

  it("preserves a straight arrival without using that offset as the capture distance", () => {
    const context = conductorContext();
    context.wireSource = source({ x: 40, y: -100 });
    const result = resolveWireCanvasSnap(context, { x: 45, y: 0.5 }, false);
    expect(result.route?.point).toEqual({ x: 40, y: 0 });
  });

  it("does not capture a wire outside the radius even if its grid landing is nearby", () => {
    expect(
      resolveWireCanvasSnap(conductorContext(), { x: 45, y: 2 }, false).route,
    ).toBeUndefined();
  });

  it.each([false, true])(
    "keeps different nets ambiguous at the landing (crossing=%s)",
    (crossing) => {
      const context = conductorContext();
      const second = conductorContext();
      second.document.nets[0]!.id = "other";
      for (const junction of second.document.junctions) {
        junction.id += "-other";
        junction.netId = "other";
      }
      if (crossing) {
        second.document.junctions[0]!.position = { x: 50, y: -100 };
        second.document.junctions[1]!.position = { x: 50, y: 100 };
      }
      const route = createRoutePath({
        id: "other-route",
        netId: "other",
        start: { kind: "junction", junctionId: "a-other" },
        end: { kind: "junction", junctionId: "b-other" },
        bends: [],
        modes: ["manual"],
      });
      context.document.nets.push(...second.document.nets);
      context.document.junctions.push(...second.document.junctions);
      context.document.routes.push(route);
      context.routeGeometryRecords = [
        ...context.routeGeometryRecords,
        {
          route,
          geometry: resolveDocumentRoutingGeometry(
            context.document,
            resolver,
          ).routes.get(route.id)!,
        },
      ];
      expect(
        resolveWireCanvasSnap(
          context,
          { x: crossing ? 49.8 : 45, y: 0.1 },
          false,
        ).ambiguous,
      ).toBe(true);
    },
  );

  it.each([false, true])(
    "captures an existing T-Junction as one endpoint (active wire=%s)",
    (activeWire) => {
      const document = createEmptyDocument("tee", "Tee");
      document.presentation.grid = 10;
      document.nets.push({ id: "net", terminals: [] });
      document.junctions.push({
        id: "tee",
        netId: "net",
        position: { x: 50, y: 0 },
        role: "branch",
      });
      for (const [id, position] of [
        ["west", { x: 0, y: 0 }],
        ["east", { x: 100, y: 0 }],
        ["south", { x: 50, y: 50 }],
      ] as const) {
        document.junctions.push({
          id: `${id}-end`,
          netId: "net",
          position,
          role: "route-anchor",
        });
        document.routes.push(
          createRoutePath({
            id,
            netId: "net",
            start: { kind: "junction", junctionId: "tee" },
            end: { kind: "junction", junctionId: `${id}-end` },
            bends: [],
            modes: ["manual"],
          }),
        );
      }
      const endpoint = { kind: "junction" as const, junctionId: "tee" };
      const junction: WireSource = {
        endpoint,
        netId: "net",
        preludeEdits: [],
        connection: resolveEndpointConnection(document, resolver, endpoint)!,
      };
      const routing = resolveDocumentRoutingGeometry(document, resolver);
      const result = resolveWireCanvasSnap(
        {
          document,
          resolver,
          wiringEndpoints: [junction],
          routeGeometryRecords: document.routes.map((route) => ({
            route,
            geometry: routing.routes.get(route.id)!,
          })),
          contactComponents: deriveVisibleConnectivity(
            document,
            resolver,
          ).flatMap((net) => net.components),
          wireSource: activeWire ? source({ x: 200, y: -100 }) : null,
          wireWaypoints: [],
          captureTolerance: 7,
        },
        { x: 51, y: 1 },
        false,
      );
      // Its two collinear arms are the same conductor as the Junction.
      expect(result.ambiguous).toBeUndefined();
      expect(result.point).toEqual({ x: 50, y: 0 });
      expect(result.endpoint?.endpoint).toEqual(endpoint);
    },
  );

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
