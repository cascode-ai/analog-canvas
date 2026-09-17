import type { Point } from "@icm/model";
import { describe, expect, it } from "vitest";

import { moveRouteSegment } from "./route-geometry-edit.js";
import type { RouteEditPath, SegmentMode } from "./route-geometry-edit.js";

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

  it("slides an interior 45-degree segment along its orthogonal legs", () => {
    const modes: SegmentMode[] = ["manual", "manual", "manual"];
    const move = (points: Point[], target: Point) =>
      moveRouteSegment({ points, segmentModes: modes }, 1, target);
    // Between two horizontal legs the diagonal moves sideways and both legs
    // stretch; no jog is added.
    const horizontal = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 80, y: 50 },
      { x: 110, y: 50 },
    ];
    expect(move(horizontal, { x: 60, y: 20 })).toEqual({
      waypoints: [
        { x: 40, y: 0 },
        { x: 90, y: 50 },
      ],
      segmentModes: modes,
    });
    // A leg can shrink away, leaving the diagonal on the Route end, but it
    // never folds back past that end.
    expect(move(horizontal, { x: 0, y: 0 })).toEqual({
      waypoints: [{ x: 50, y: 50 }],
      segmentModes: ["manual", "manual"],
    });
    expect(() => move(horizontal, { x: 0, y: 10 })).toThrow("fold back");
    // Between two vertical legs it moves up or down instead.
    expect(
      move(
        [
          { x: 0, y: 0 },
          { x: 0, y: 30 },
          { x: 50, y: 80 },
          { x: 50, y: 110 },
        ],
        { x: 20, y: 60 },
      ),
    ).toEqual({
      waypoints: [
        { x: 0, y: 40 },
        { x: 50, y: 90 },
      ],
      segmentModes: modes,
    });
    // With one leg of each kind, each end slides along its own leg.
    const mixed = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 80, y: 50 },
      { x: 80, y: 100 },
    ];
    expect(move(mixed, { x: 60, y: 20 })).toEqual({
      waypoints: [
        { x: 40, y: 0 },
        { x: 80, y: 40 },
      ],
      segmentModes: modes,
    });
    expect(() => move(mixed, { x: 130, y: 0 })).toThrow("reverse");
  });

  it("jogs only at the Route end of a 45-degree segment", () => {
    expect(
      moveRouteSegment(
        {
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 50 },
            { x: 80, y: 50 },
          ],
          segmentModes: ["manual", "manual"],
        },
        0,
        { x: 35, y: 25 },
      ),
    ).toEqual({
      waypoints: [
        { x: 0, y: -10 },
        { x: 60, y: 50 },
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
