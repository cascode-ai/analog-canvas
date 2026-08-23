import { describe, expect, it } from "vitest";

import { moveRouteSegment } from "./route-geometry-edit.js";
import type { RouteEditPath } from "./route-geometry-edit.js";

describe("direct route segment movement", () => {
  it("turns a direct segment into a stable orthogonal dogleg", () => {
    expect(
      moveRouteSegment(
        {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
          segmentModes: ["manual"],
        },
        0,
        { x: 50, y: 30 },
      ),
    ).toEqual({
      waypoints: [
        { x: 0, y: 30 },
        { x: 100, y: 30 },
      ],
      segmentModes: ["manual", "manual", "manual"],
    });
  });

  it("moves a direct 45-degree segment with an octilinear dogleg", () => {
    expect(
      moveRouteSegment(
        {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
          segmentModes: ["manual"],
        },
        0,
        { x: 50, y: 20 },
      ),
    ).toEqual({
      waypoints: [
        { x: 0, y: -30 },
        { x: 100, y: 70 },
      ],
      segmentModes: ["manual", "manual", "manual"],
    });
  });

  it("moves only an interior segment and rejects protected neighbors", () => {
    const polyline: RouteEditPath = {
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 40 },
        { x: 80, y: 40 },
      ],
      segmentModes: ["manual", "manual", "manual"],
    };
    expect(moveRouteSegment(polyline, 1, { x: 35, y: 20 })).toEqual({
      waypoints: [
        { x: 35, y: 0 },
        { x: 35, y: 40 },
      ],
      segmentModes: ["manual", "manual", "manual"],
    });
    expect(() =>
      moveRouteSegment(
        { ...polyline, segmentModes: ["locked", "manual", "manual"] },
        1,
        { x: 35, y: 20 },
      ),
    ).toThrow("protected");
  });
});
