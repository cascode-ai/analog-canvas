import type { Orientation, Rotation } from "./schema.js";

/** The visible direction of a reflection in document coordinates. */
export type ScreenFlip = "left-right" | "top-bottom";

/**
 * Compose a screen-space reflection with the canonical orientation transform
 * (`rotate(mirror(local))`). The persisted representation deliberately has one
 * mirror bit: its four rotations form the other reflection direction without
 * needing another schema or edit kind.
 *
 * This lives beside the Orientation it transforms because both the editor's
 * placement preview and the edit engine's group reflection need it, and they
 * have to agree — a part reflected one way while the arrangement reflects the
 * other would come apart.
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
