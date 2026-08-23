import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";
import {
  resolveRouteGeometry,
  resolveSchematicStyleProfile,
} from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";

import {
  annotationAnchor,
  attachmentAtPoint,
  routeTapPoint,
  defaultInstanceLabel,
  dragNetLabelAttachmentAtPoint,
  dragRouteAttachmentAtPoint,
  effectiveRouteAttachment,
  looseRouteAnchorIds,
} from "./route-interaction-geometry";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function looseRouteDocument() {
  const document = createEmptyDocument("route-geometry", "Route geometry");
  document.nets.push({
    id: "net-1",
    scope: "local",
    terminals: [],
  });
  document.junctions.push(
    {
      id: "j1",
      netId: "net-1",
      position: { x: 0, y: 0 },
      role: "route-anchor",
    },
    {
      id: "j2",
      netId: "net-1",
      position: { x: 100, y: 0 },
      role: "route-anchor",
    },
  );
  document.routes.push({
    id: "route-1",
    netId: "net-1",
    from: { kind: "junction", junctionId: "j1" },
    to: { kind: "junction", junctionId: "j2" },
    waypoints: [],
    segmentModes: ["manual"],
  });
  return document;
}

function routeRecord(document: ReturnType<typeof looseRouteDocument>) {
  const route = document.routes[0]!;
  const geometry = resolveRouteGeometry(document, resolver, route);
  if (!geometry) throw new Error("Fixture route must resolve");
  return { route, geometry };
}

describe("route interaction geometry", () => {
  it("recognizes a free route backed by two loose route anchors", () => {
    const document = looseRouteDocument();
    expect(looseRouteAnchorIds(document, document.routes[0]!)).toEqual([
      "j1",
      "j2",
    ]);

    document.junctions[0]!.role = "branch";
    document.routes.push({
      ...document.routes[0]!,
      id: "route-branch",
      to: { kind: "junction", junctionId: "j1" },
    });
    expect(looseRouteAnchorIds(document, document.routes[0]!)).toBeNull();
  });

  it("projects to the nearest route segment and resolves a route VisualAnchor", () => {
    const document = looseRouteDocument();
    const record = routeRecord(document);
    const attached = attachmentAtPoint([record], { x: 75, y: 12 });
    expect(attached).toEqual({
      routeAttachment: {
        routeId: "route-1",
        segmentIndex: 0,
        t: 0.75,
        direction: "forward",
        normalOffset: -14,
      },
      position: { x: 75, y: 0 },
    });

    const marker = {
      id: "current-1",
      kind: "route-marker" as const,
      markerKind: "current" as const,
      content: { runs: [{ kind: "text" as const, value: "I_1" }] },
      anchor: {
        kind: "route" as const,
        routeId: "route-1",
        segmentIndex: 0,
        t: 0.5,
        normalOffset: -14,
        direction: "forward" as const,
        orientation: "follow" as const,
        fallbackPosition: { x: -1, y: -1 },
      },
      alignment: "middle" as const,
      rotation: 0 as const,
      locked: false,
    };
    expect(effectiveRouteAttachment(marker)?.t).toBe(0.5);
    expect(
      annotationAnchor(
        document,
        resolver,
        marker,
        [record],
        resolveSchematicStyleProfile(document.presentation.styleProfileId),
      ),
    ).toEqual({ x: 50, y: 0 });

    expect(
      dragRouteAttachmentAtPoint(
        [record],
        { x: 80, y: -24 },
        effectiveRouteAttachment(marker)!,
      ),
    ).toEqual({
      routeAttachment: {
        routeId: "route-1",
        segmentIndex: 0,
        t: 0.8,
        direction: "forward",
        normalOffset: -24,
      },
      position: { x: 80, y: 0 },
    });
  });

  it("keeps a dragged marker label in a stable bounded halo around its route", () => {
    const document = looseRouteDocument();
    const record = routeRecord(document);
    const current = {
      routeId: "route-1",
      segmentIndex: 0,
      t: 0.5,
      direction: "forward" as const,
      normalOffset: -14,
    };
    expect(
      dragRouteAttachmentAtPoint([record], { x: 60, y: -2 }, current)
        ?.routeAttachment,
    ).toMatchObject({ t: 0.6, normalOffset: -12 });
    expect(
      dragRouteAttachmentAtPoint([record], { x: 60, y: 90 }, current)
        ?.routeAttachment,
    ).toMatchObject({ t: 0.6, normalOffset: 40 });
  });

  it("slides a dragged Net label along its route in a wide offset band", () => {
    const document = looseRouteDocument();
    document.junctions[1]!.position = { x: 100, y: 100 };
    document.routes[0]!.waypoints = [{ x: 100, y: 0 }];
    document.routes[0]!.segmentModes = ["manual", "manual"];
    const record = routeRecord(document);
    // Above the first segment, well past the old +/-30 clamp.
    expect(
      dragNetLabelAttachmentAtPoint([record], { x: 30, y: -40 }, "route-1"),
    ).toMatchObject({ segmentIndex: 0, t: 0.3, normalOffset: -40 });
    // Near or across the conductor keeps a readable offset and flips sides.
    expect(
      dragNetLabelAttachmentAtPoint([record], { x: 40, y: -2 }, "route-1"),
    ).toMatchObject({ normalOffset: -8 });
    // The band tops out at the generous maximum.
    expect(
      dragNetLabelAttachmentAtPoint([record], { x: 30, y: -500 }, "route-1"),
    ).toMatchObject({ normalOffset: -200 });
    // Around the corner the nearest segment wins.
    expect(
      dragNetLabelAttachmentAtPoint([record], { x: 108, y: 40 }, "route-1"),
    ).toMatchObject({ segmentIndex: 1, t: 0.4, normalOffset: -8 });
    expect(
      dragNetLabelAttachmentAtPoint([record], { x: 0, y: 0 }, "route-2"),
    ).toBeNull();
  });

  it("builds an implicit instance label only while no explicit label exists", () => {
    const document = createEmptyDocument("labels", "Labels");
    const instance = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    document.instances.push(instance);
    const profile = resolveSchematicStyleProfile(
      document.presentation.styleProfileId,
    );
    const label = defaultInstanceLabel(document, instance, resolver, profile);
    expect(label).toMatchObject({
      id: "instance-label-R1",
      kind: "instance-label",
      binding: { kind: "instance-schematic-name", instanceId: "R1" },
      anchor: expect.objectContaining({ kind: "object", objectId: "R1" }),
    });
    document.annotations.push(label!);
    expect(
      defaultInstanceLabel(document, instance, resolver, profile),
    ).toBeNull();
  });

  it("stores a rotated MOS label at the visible glyph baseline", () => {
    const document = createEmptyDocument("mos-label", "MOS Label");
    const instance = {
      id: "M1",
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 90 as const,
        mirror: "none" as const,
      },
    };
    document.instances.push(instance);
    const profile = resolveSchematicStyleProfile(
      document.presentation.styleProfileId,
    );

    expect(
      defaultInstanceLabel(document, instance, resolver, profile),
    ).toMatchObject({
      anchor: {
        localOffset: { x: -10, y: 40 },
        fallbackPosition: { x: 90, y: 140 },
      },
      alignment: "middle",
    });
  });
});

describe("routeTapPoint", () => {
  const grid = 10;
  const vertical = { from: { x: 370, y: 120 }, to: { x: 370, y: 460 } };
  const horizontal = { from: { x: 200, y: 290 }, to: { x: 600, y: 290 } };

  it("quantizes a tap that is merely aimed at a conductor", () => {
    expect(
      routeTapPoint({ x: 372, y: 263 }, vertical.from, vertical.to, grid),
    ).toEqual({ x: 370, y: 260 });
    expect(
      routeTapPoint({ x: 417, y: 288 }, horizontal.from, horizontal.to, grid),
    ).toEqual({ x: 420, y: 290 });
  });

  it("lands where the run arrives, so the grid cannot bend it", () => {
    // A run arriving at y = 265 must reach the wire at 265, not be dragged to
    // 260 and turned into an elbow. Any point along a conductor is tappable.
    expect(
      routeTapPoint({ x: 372, y: 264 }, vertical.from, vertical.to, grid, {
        x: 620,
        y: 265,
      }),
    ).toEqual({ x: 370, y: 265 });
    expect(
      routeTapPoint({ x: 417, y: 288 }, horizontal.from, horizontal.to, grid, {
        x: 415,
        y: 100,
      }),
    ).toEqual({ x: 415, y: 290 });
  });

  it("keeps the grid when the run arrives somewhere else entirely", () => {
    // Aiming at one end of a wire while the run comes from far away is not a
    // straight connection to preserve; the tidy grid tap is the better answer.
    expect(
      routeTapPoint({ x: 372, y: 263 }, vertical.from, vertical.to, grid, {
        x: 620,
        y: 440,
      }),
    ).toEqual({ x: 370, y: 260 });
  });

  it("never lands off the end of the segment it taps", () => {
    // An arrival beyond the wire's own extent is not on that wire.
    expect(
      routeTapPoint({ x: 372, y: 130 }, vertical.from, vertical.to, grid, {
        x: 620,
        y: 90,
      }),
    ).toEqual({ x: 370, y: 130 });
  });

  it("keeps a diagonal tap on the segment", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 100 };
    expect(routeTapPoint({ x: 44, y: 46 }, from, to, grid)).toEqual({
      x: 50,
      y: 50,
    });
  });
});
