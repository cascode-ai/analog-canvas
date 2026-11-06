import type { ResolvedDraftingGeometry } from "@icm/derived";
import { snapGridCoordinate } from "@icm/model";
import type { DraftingObject, GridPoint } from "@icm/model";

type Arrow = Extract<DraftingObject, { kind: "arrow" }>;
type ArrowGeometry = Extract<ResolvedDraftingGeometry, { kind: "arrow" }>;

/**
 * Which way a straight leg of a bent arrow slides: across itself, so a
 * level leg moves up or down and an upright one sideways. Null for a
 * slanted or curved leg, a straight arrow's only leg, or a leg ending on a
 * pin, none of which a slide can keep.
 */
export function arrowLegSlide(
  object: Arrow,
  geometry: ArrowGeometry,
  index: number,
): "x" | "y" | null {
  const points = geometry.points;
  const a = points[index];
  const b = points[index + 1];
  if (!a || !b || points.length < 3 || object.outline) return null;
  if (geometry.curveControls[index]) return null;
  if (index === 0 && object.from.kind !== "free") return null;
  if (index + 1 === points.length - 1 && object.to.kind !== "free") return null;
  return a.y === b.y && a.x !== b.x
    ? "y"
    : a.x === b.x && a.y !== b.y
      ? "x"
      : null;
}

/**
 * A straight leg slid across itself to the pointer: both its ends move,
 * so the legs on either side stretch and keep their direction.
 */
export function moveArrowLeg(
  object: Arrow,
  geometry: ArrowGeometry,
  index: number,
  point: GridPoint,
  grid: number,
): Arrow | null {
  const axis = arrowLegSlide(object, geometry, index);
  if (!axis) return null;
  const value = snapGridCoordinate(point[axis], grid);
  const last = geometry.points.length - 1;
  const waypoints = [...(object.waypoints ?? [])];
  let { from, to } = object;
  for (const at of [index, index + 1]) {
    if (at === 0 && from.kind === "free")
      from = { ...from, position: { ...from.position, [axis]: value } };
    else if (at === last && to.kind === "free")
      to = { ...to, position: { ...to.position, [axis]: value } };
    else if (waypoints[at - 1])
      waypoints[at - 1] = { ...waypoints[at - 1]!, [axis]: value };
  }
  return { ...object, from, to, waypoints };
}
