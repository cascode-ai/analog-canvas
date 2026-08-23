import {
  reflectOrientation,
  type Orientation,
  type Rotation,
  type ScreenFlip,
} from "@icm/model";

export { reflectOrientation };
export type { ScreenFlip };

/**
 * A canvas-local orientation command. It is deliberately not a model edit:
 * placement applies these commands to an existing instance orientation only
 * when the user commits the preview.
 */
export type PlacementOrientationOperation =
  | { kind: "rotate"; deltaDegrees: 90 | -90 }
  | { kind: "reflect"; direction: ScreenFlip };

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
