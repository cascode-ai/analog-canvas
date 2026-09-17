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

describe("45-degree segment drag", () => {
  const manual = (count: number): SegmentMode[] =>
    Array.from({ length: count }, () => "manual");
  const drag = (
    points: Point[],
    segmentIndex: number,
    delta: Point,
    carried?: { from?: boolean; to?: boolean },
  ) =>
    moveRouteSegment(
      { points, segmentModes: manual(points.length - 1) },
      segmentIndex,
      delta,
      { origin: { x: 0, y: 0 }, ...(carried ? { carried } : {}) },
    );
  // Leg, diagonal, leg: the cross-coupled shape.
  const zig = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 80, y: 50 },
    { x: 110, y: 50 },
  ];

  it("moves sideways between horizontal legs, which stretch", () => {
    // Mostly horizontal travel picks the horizontal axis; the rest is ignored.
    expect(drag(zig, 1, { x: 10, y: 2 })).toEqual({
      waypoints: [
        { x: 40, y: 0 },
        { x: 90, y: 50 },
      ],
      segmentModes: manual(3),
    });
    // A leg may shrink away, but never folds back past its far end.
    expect(drag(zig, 1, { x: -30, y: 0 }).waypoints).toEqual([
      { x: 50, y: 50 },
    ]);
    expect(() => drag(zig, 1, { x: -40, y: 0 })).toThrow("fold the wire back");
  });

  it("moves vertically with its perpendicular legs", () => {
    // Fixed Route ends stay and are reached by vertical jogs.
    expect(drag(zig, 1, { x: 2, y: 10 })).toEqual({
      waypoints: [
        { x: 0, y: 10 },
        { x: 30, y: 10 },
        { x: 80, y: 60 },
        { x: 110, y: 60 },
      ],
      segmentModes: manual(5),
    });
    // Carried Junction ends travel with the run instead.
    expect(drag(zig, 1, { x: 0, y: 10 }, { from: true, to: true })).toEqual({
      waypoints: [
        { x: 30, y: 10 },
        { x: 80, y: 60 },
      ],
      segmentModes: manual(3),
    });
  });

  it("jogs at a pin end along the move and never doubles back there", () => {
    // Leg, then a diagonal rising to a pin: a cross-coupled gate.
    const toPin = [
      { x: 0, y: 50 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
    ];
    expect(drag(toPin, 1, { x: -10, y: 0 })).toEqual({
      waypoints: [
        { x: 40, y: 50 },
        { x: 90, y: 0 },
      ],
      segmentModes: manual(3),
    });
    // Moving right would overshoot the pin and come back to it.
    expect(() => drag(toPin, 1, { x: 10, y: 0 })).toThrow("fold the wire back");
  });

  it("keeps a direct diagonal between two fixed ends in place", () => {
    const direct = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    // Any one-axis move would double back at one of the ends.
    for (const delta of [
      { x: 10, y: 0 },
      { x: -10, y: 0 },
      { x: 0, y: 10 },
      { x: 0, y: -10 },
    ]) {
      expect(() => drag(direct, 0, delta)).toThrow("fold the wire back");
    }
    expect(drag(direct, 0, { x: 0, y: -30 }, { from: true, to: true })).toEqual(
      { waypoints: [], segmentModes: manual(1) },
    );
  });

  it("carries a diagonal with a dragged leg beside it", () => {
    const leg = (segmentIndex: number, target: Point) =>
      moveRouteSegment(
        { points: zig, segmentModes: manual(3) },
        segmentIndex,
        target,
      );
    // Either horizontal leg moved down carries the whole run: the diagonal
    // keeps its angle instead of being bent to reach the moved bend.
    const down = {
      waypoints: [
        { x: 0, y: 10 },
        { x: 30, y: 10 },
        { x: 80, y: 60 },
        { x: 110, y: 60 },
      ],
      segmentModes: manual(5),
    };
    expect(leg(0, { x: 10, y: 10 })).toEqual(down);
    expect(leg(2, { x: 100, y: 60 })).toEqual(down);
    // A leg between two vertical legs still moves on its own.
    expect(
      moveRouteSegment(
        {
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 20 },
            { x: 40, y: 20 },
            { x: 40, y: 60 },
          ],
          segmentModes: manual(3),
        },
        1,
        { x: 20, y: 30 },
      ).waypoints,
    ).toEqual([
      { x: 0, y: 30 },
      { x: 40, y: 30 },
    ]);
  });

  it("moves horizontally when the drag origin is unknown", () => {
    expect(
      moveRouteSegment({ points: zig, segmentModes: manual(3) }, 1, {
        x: 60,
        y: 20,
      }),
    ).toEqual({
      waypoints: [
        { x: 40, y: 0 },
        { x: 90, y: 50 },
      ],
      segmentModes: manual(3),
    });
  });
});
