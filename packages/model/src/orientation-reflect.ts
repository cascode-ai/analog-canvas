import type { Mirror, Orientation } from "./schema.js";

/** The visible direction of a reflection in document coordinates. */
export type ScreenFlip = "left-right" | "top-bottom";

/**
 * Compose a screen-space reflection with the canonical orientation transform.
 * Horizontal and vertical are independent bits; neither operation rewrites
 * rotation. Applying the same reflection twice therefore restores the exact
 * authored orientation, while applying both axes records `both` explicitly.
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
  const horizontal =
    orientation.mirror === "horizontal" || orientation.mirror === "both";
  const vertical =
    orientation.mirror === "vertical" || orientation.mirror === "both";
  const nextHorizontal = direction === "left-right" ? !horizontal : horizontal;
  const nextVertical = direction === "top-bottom" ? !vertical : vertical;
  return {
    rotation: orientation.rotation,
    mirror: mirrorFromAxes(nextHorizontal, nextVertical),
  };
}

function mirrorFromAxes(horizontal: boolean, vertical: boolean): Mirror {
  if (horizontal && vertical) return "both";
  if (horizontal) return "horizontal";
  if (vertical) return "vertical";
  return "none";
}

/** SVG/model scale for a persisted screen-space mirror mode. */
export function mirrorScale(mirror: Mirror): {
  readonly x: 1 | -1;
  readonly y: 1 | -1;
} {
  return {
    x: mirror === "horizontal" || mirror === "both" ? -1 : 1,
    y: mirror === "vertical" || mirror === "both" ? -1 : 1,
  };
}
