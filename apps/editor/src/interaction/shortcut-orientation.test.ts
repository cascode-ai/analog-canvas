import { describe, expect, it } from "vitest";

import { transformPoint } from "@icm/model";
import type { Mirror, Orientation, Rotation } from "@icm/model";

import {
  applyOrientationOperations,
  reflectOrientation,
} from "./shortcut-orientation";
import type { ScreenFlip } from "./shortcut-orientation";

const rotations: Rotation[] = [0, 90, 180, 270];
const mirrors: Mirror[] = ["none", "x"];
const origin = { x: 120, y: 80 };
const local = { x: 17, y: -9 };

function reflectWorldPoint(
  point: { x: number; y: number },
  direction: ScreenFlip,
): { x: number; y: number } {
  return direction === "left-right"
    ? { x: 2 * origin.x - point.x, y: point.y }
    : { x: point.x, y: 2 * origin.y - point.y };
}

describe("reflectOrientation", () => {
  it.each(["left-right", "top-bottom"] as const)(
    "represents a %s screen-space reflection for every canonical orientation",
    (direction) => {
      for (const rotation of rotations) {
        for (const mirror of mirrors) {
          const orientation: Orientation = { rotation, mirror };
          const before = transformPoint(local, origin, orientation);
          const after = transformPoint(
            local,
            origin,
            reflectOrientation(orientation, direction),
          );

          expect(after).toEqual(reflectWorldPoint(before, direction));
        }
      }
    },
  );

  it("is an involution", () => {
    for (const direction of ["left-right", "top-bottom"] as const) {
      for (const rotation of rotations) {
        for (const mirror of mirrors) {
          const orientation: Orientation = { rotation, mirror };
          expect(
            reflectOrientation(
              reflectOrientation(orientation, direction),
              direction,
            ),
          ).toEqual(orientation);
        }
      }
    }
  });

  it("applies transient placement commands in their input order", () => {
    const start: Orientation = { rotation: 90, mirror: "none" };
    const expected = reflectOrientation(
      { rotation: 180, mirror: "none" },
      "top-bottom",
    );
    expect(
      applyOrientationOperations(start, [
        { kind: "rotate", deltaDegrees: 90 },
        { kind: "reflect", direction: "top-bottom" },
      ]),
    ).toEqual(expected);
  });
});
