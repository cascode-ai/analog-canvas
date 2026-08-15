import type { Orientation, Rotation } from "@icm/model";

/** The visible direction of a reflection in document coordinates. */
export type ScreenFlip = "left-right" | "top-bottom";

/**
 * A canvas-local orientation command. It is deliberately not a model edit:
 * placement applies these commands to an existing instance orientation only
 * when the user commits the preview.
 */
export type PlacementOrientationOperation =
  | { kind: "rotate"; deltaDegrees: 90 | -90 }
  | { kind: "reflect"; direction: ScreenFlip };

/**
 * Compose a screen-space reflection with the canonical orientation transform
 * (`rotate(mirror(local))`). The persisted representation deliberately has one
 * mirror bit: its four rotations form the other reflection direction without
 * needing another schema or edit kind.
 */
export function reflectOrientation(
  orientation: Orientation,
  direction: ScreenFlip,
): Orientation {
  const baseRotation = direction === "left-right" ? 0 : 180;
  return {
    rotation: ((baseRotation - orientation.rotation + 360) % 360) as Rotation,
    mirror: orientation.mirror === "none" ? "x" : "none",
  };
}

export function applyOrientationOperations(
  orientation: Orientation,
  operations: readonly PlacementOrientationOperation[],
): Orientation {
  return operations.reduce<Orientation>((current, operation) => {
    if (operation.kind === "reflect") {
      return reflectOrientation(current, operation.direction);
    }
    return {
      ...current,
      rotation: ((current.rotation + operation.deltaDegrees + 360) %
        360) as Rotation,
    };
  }, orientation);
}
