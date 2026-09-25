import type { Point } from "@icm/model";
import { describe, expect, it } from "vitest";

import type { ResolvedRouteGeometry } from "./resolved-route-geometry.js";
import {
  isNearVerticalSegment,
  netLabelSideOffset,
  resolveRouteAttachment,
} from "./route-attachment.js";

function oneSegment(from: Point, to: Point): ResolvedRouteGeometry {
  return {
    routeId: "route",
    netId: "net",
    centerline: [from, to],
    segments: [
      {
        address: { routeId: "route", legId: "leg", segmentIndex: 0 },
        from,
        to,
        mode: "manual",
      },
    ],
    vertices: [],
    endpointJoins: [],
    endpointConnections: {
      from: { kind: "free", point: from },
      to: { kind: "free", point: to },
    },
  } as unknown as ResolvedRouteGeometry;
}

function labelPoint(from: Point, to: Point): Point {
  return resolveRouteAttachment(oneSegment(from, to), {
    routeId: "route",
    legId: "leg",
    t: 0.5,
    direction: "forward",
    normalOffset: netLabelSideOffset(from, to, 8),
  })!.labelPoint;
}

describe("a Net Label's side of its wire", () => {
  it("is above a horizontal wire drawn either way", () => {
    expect(labelPoint({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({
      x: 50,
      y: -8,
    });
    expect(labelPoint({ x: 100, y: 0 }, { x: 0, y: 0 })).toEqual({
      x: 50,
      y: -8,
    });
  });

  it("is right of a vertical wire drawn either way", () => {
    expect(labelPoint({ x: 0, y: 0 }, { x: 0, y: 100 })).toEqual({
      x: 8,
      y: 50,
    });
    expect(labelPoint({ x: 0, y: 100 }, { x: 0, y: 0 })).toEqual({
      x: 8,
      y: 50,
    });
    expect(isNearVerticalSegment({ x: 0, y: 100 }, { x: 0, y: 0 })).toBe(true);
    expect(isNearVerticalSegment({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(false);
  });

  it("puts a 45° wire's label on the same side whichever way it was drawn", () => {
    const down = labelPoint({ x: 0, y: 0 }, { x: 100, y: 100 });
    const up = labelPoint({ x: 100, y: 100 }, { x: 0, y: 0 });
    expect(up).toEqual(down);
    expect(down.y).toBeLessThan(50);
  });
});
