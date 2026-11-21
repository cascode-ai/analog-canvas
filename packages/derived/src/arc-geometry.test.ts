import { describe, expect, it } from "vitest";

import {
  arcPathData,
  arcPointAt,
  arcThroughPoints,
  distanceToArc,
} from "./arc-geometry.js";

/** Bounds to a thousandth, past floating-point noise from the angles. */
const rounded = (bounds: { [key: string]: number }) =>
  Object.fromEntries(
    Object.entries(bounds).map(([key, value]) => [
      key,
      Math.round(value * 1000) / 1000 + 0,
    ]),
  );

describe("arcThroughPoints", () => {
  it("finds the circle and the arc that passes the middle point", () => {
    // A half circle of radius 10 bowing up (y down: through y = -10).
    const arc = arcThroughPoints(
      { x: -10, y: 0 },
      { x: 0, y: -10 },
      { x: 10, y: 0 },
    )!;
    expect(arc.center.x).toBeCloseTo(0);
    expect(arc.center.y).toBeCloseTo(0);
    expect(arc.radius).toBeCloseTo(10);
    expect(arc.startAngle).toBeCloseTo(180);
    expect(arc.sweepAngle).toBeCloseTo(90 + 90);
    expect(rounded(arc.bounds)).toEqual({
      x: -10,
      y: -10,
      width: 20,
      height: 10,
    });
    expect(arcPathData({ x: -10, y: 0 }, { x: 10, y: 0 }, arc)).toBe(
      "M -10 0 A 10 10 0 0 1 10 0",
    );
  });

  it("sweeps the other way when the bow is on the other side", () => {
    const arc = arcThroughPoints(
      { x: -10, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    )!;
    expect(arc.sweepAngle).toBeCloseTo(-180);
    expect(rounded(arc.bounds)).toEqual({
      x: -10,
      y: 0,
      width: 20,
      height: 10,
    });
    expect(arcPathData({ x: -10, y: 0 }, { x: 10, y: 0 }, arc)).toBe(
      "M -10 0 A 10 10 0 0 0 10 0",
    );
  });

  it("marks an arc over half a circle as large", () => {
    const start = { x: 0, y: 10 };
    const end = { x: 10, y: 0 };
    const arc = arcThroughPoints(start, { x: 0, y: -10 }, end)!;
    expect(Math.abs(arc.sweepAngle)).toBeCloseTo(270);
    expect(arcPathData(start, end, arc)).toMatch(/ A 10 10 0 1 /u);
    // Three of the four extremes are on it; the right one is its end.
    expect(arc.bounds.x).toBeCloseTo(-10);
    expect(arc.bounds.y).toBeCloseTo(-10);
    expect(arc.bounds.width).toBeCloseTo(20);
    expect(arc.bounds.height).toBeCloseTo(20);
  });

  it("has no arc for three points on one line", () => {
    expect(
      arcThroughPoints({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }),
    ).toBeUndefined();
  });

  it("walks the sweep and measures distance to the stroke", () => {
    const arc = arcThroughPoints(
      { x: -10, y: 0 },
      { x: 0, y: -10 },
      { x: 10, y: 0 },
    )!;
    const middle = arcPointAt(arc, 0.5);
    expect(middle.x).toBeCloseTo(0);
    expect(middle.y).toBeCloseTo(-10);
    expect(distanceToArc(arc, { x: 0, y: -12 })).toBeCloseTo(2);
    // Below the chord is off the arc: the nearest point is an end.
    expect(distanceToArc(arc, { x: 10, y: 5 })).toBeCloseTo(5);
  });
});
