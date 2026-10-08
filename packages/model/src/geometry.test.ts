import { describe, expect, it } from "vitest";

import { inverseTransformPoint, transformPoint } from "./geometry.js";
import type { Mirror, Rotation } from "./schema.js";

describe("coordinate transforms", () => {
  const rotations: Rotation[] = [0, 45, 90, 135, 180, 225, 270, 315];
  const mirrors: Mirror[] = ["none", "horizontal", "vertical", "both"];

  it.each(
    rotations.flatMap((rotation) =>
      mirrors.map((mirror) => ({ mirror, rotation })),
    ),
  )("round-trips rotation $rotation and mirror $mirror", (orientation) => {
    const local = { x: 13, y: -7 };
    const origin = { x: 100, y: 80 };
    const roundTrip = inverseTransformPoint(
      transformPoint(local, origin, orientation),
      origin,
      orientation,
    );
    expect(roundTrip.x).toBeCloseTo(local.x, 10);
    expect(roundTrip.y).toBeCloseTo(local.y, 10);
  });

  it("turns a point clockwise by 45 degrees", () => {
    const point = transformPoint(
      { x: 10, y: 0 },
      { x: 100, y: 80 },
      { rotation: 45, mirror: "none" },
    );
    expect(point.x).toBeCloseTo(100 + Math.sqrt(50), 10);
    expect(point.y).toBeCloseTo(80 + Math.sqrt(50), 10);
  });
});
