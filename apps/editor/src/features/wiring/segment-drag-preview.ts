import { routeEnd, type Point, type SchematicDocument } from "@icm/model";

type Route = SchematicDocument["routes"][number];

export interface SegmentDragJunctionMove {
  readonly junctionId: string;
  readonly position: Point;
}

/**
 * The polyline a segment drag should draw while the pointer is down.
 *
 * The planner repairs a dragged segment into orthogonal legs and, where an
 * end of the Route is a free Junction, moves that Junction to suit. The
 * preview has to follow it. Drawing the planned waypoints between the Route's
 * ORIGINAL endpoints leaves the far end where it was, so the last leg closes
 * back at an angle and the drag reads as a triangle — even though releasing
 * commits the orthogonal path the planner intended. The person sees a shape
 * the editor never builds.
 *
 * An endpoint the plan does not move stays exactly where it is: a wire that
 * ends on a device terminal is anchored there, and the drag may not pretend
 * otherwise.
 */
export function segmentDragPreviewPolyline(
  route: Route,
  centerline: readonly Point[],
  waypoints: readonly Point[],
  junctionMoves: readonly SegmentDragJunctionMove[],
): Point[] {
  const moved = new Map(
    junctionMoves.map((move) => [move.junctionId, move.position]),
  );
  const endpointPoint = (
    endpoint: Route["start"],
    fallback: Point | undefined,
  ): Point | undefined =>
    endpoint.kind === "junction"
      ? (moved.get(endpoint.junctionId) ?? fallback)
      : fallback;

  const start = endpointPoint(route.start, centerline[0]);
  const end = endpointPoint(routeEnd(route), centerline.at(-1));
  return [...(start ? [start] : []), ...waypoints, ...(end ? [end] : [])];
}
