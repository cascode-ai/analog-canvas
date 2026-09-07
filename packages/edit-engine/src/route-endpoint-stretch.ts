import type { Point, SegmentMode } from "@icm/model";
import { isSegmentAllowed } from "@icm/derived";
import { bridgeStretchedSegment, type PinAxis } from "./route-geometry-edit.js";

function protectedMode(mode: SegmentMode | undefined): boolean {
  return mode === "locked" || mode === "trunk";
}

/** Shared endpoint deformation for planners and transaction following. */
export function stretchRouteEndpoint(
  routeId: string,
  points: Point[],
  modes: SegmentMode[],
  side: "from" | "to",
  originalPoint: Point,
  movedPoint: Point,
  /**
   * The leads of the Route's two endpoints, in Route order. Supplied where the
   * caller knows them so a stretched single segment can meet both pins along
   * their own leads instead of arriving across one of them.
   */
  leads?: { from: PinAxis; to: PinAxis; grid: number },
  outward?: Point | null,
): void {
  if (originalPoint.x === movedPoint.x && originalPoint.y === movedPoint.y)
    return;
  const segmentMode = side === "from" ? modes[0] : modes.at(-1);
  if (protectedMode(segmentMode)) {
    throw new Error(`Route ${routeId} has a protected adjacent segment`);
  }
  const endpointIndex = side === "from" ? 0 : points.length - 1;
  const neighborIndex = side === "from" ? 1 : points.length - 2;
  const neighbor = points[neighborIndex]!;
  points[endpointIndex] = { ...movedPoint };

  if (segmentMode === "escape" && outward && points.length > 2) {
    const distance =
      Math.abs(neighbor.x - originalPoint.x) +
      Math.abs(neighbor.y - originalPoint.y);
    neighbor.x = movedPoint.x + outward.x * distance;
    neighbor.y = movedPoint.y + outward.y * distance;
    const nextIndex = side === "from" ? neighborIndex + 1 : neighborIndex - 1;
    const next = points[nextIndex]!;
    if (neighbor.x !== next.x && neighbor.y !== next.y) {
      const bridge =
        outward.x !== 0
          ? { x: neighbor.x, y: next.y }
          : { x: next.x, y: neighbor.y };
      const modeIndex = side === "from" ? 1 : modes.length - 2;
      const bridgeMode = modes[modeIndex] ?? "auto";
      if (protectedMode(bridgeMode)) {
        throw new Error(`Route ${routeId} has a protected adjacent segment`);
      }
      points.splice(side === "from" ? nextIndex : neighborIndex, 0, bridge);
      modes.splice(modeIndex, 1, bridgeMode, bridgeMode);
    }
    return;
  }

  const originallyVertical =
    originalPoint.x === neighbor.x && originalPoint.y !== neighbor.y;
  const originallyHorizontal =
    originalPoint.y === neighbor.y && originalPoint.x !== neighbor.x;
  // Preserve established orthogonal stretch geometry byte-for-byte. The
  // generic branch below only handles an existing diagonal or future heading.
  if (originallyVertical || originallyHorizontal) {
    if (points.length > 2) {
      const alignedMove = originallyVertical
        ? movedPoint.x === neighbor.x
        : movedPoint.y === neighbor.y;
      const secondModeIndex = side === "from" ? 1 : modes.length - 2;
      // Sliding the neighbor rewrites the SECOND leg. When that leg is
      // locked or trunk it must survive byte-for-byte, so the moved
      // endpoint elbows back through the original endpoint instead and
      // the whole established path stays untouched.
      if (!alignedMove && protectedMode(modes[secondModeIndex])) {
        const corner = originallyVertical
          ? { x: movedPoint.x, y: originalPoint.y }
          : { x: originalPoint.x, y: movedPoint.y };
        const inserted =
          side === "from"
            ? [corner, { ...originalPoint }]
            : [{ ...originalPoint }, corner];
        const insertIndex = side === "from" ? 1 : points.length - 1;
        points.splice(insertIndex, 0, ...inserted);
        const modeIndex = side === "from" ? 0 : modes.length - 1;
        const mode = modes[modeIndex]!;
        modes.splice(modeIndex, 1, mode, mode, mode);
        return;
      }
      if (originallyVertical) neighbor.x = movedPoint.x;
      else neighbor.y = movedPoint.y;
      return;
    }
    const stillAligned = originallyVertical
      ? movedPoint.x === neighbor.x
      : movedPoint.y === neighbor.y;
    if (stillAligned) return;
    const modeIndex = side === "from" ? 0 : modes.length - 1;
    const mode = modes[modeIndex]!;
    if (leads) {
      const bends = bridgeStretchedSegment(
        points[0]!,
        points[1]!,
        leads.from,
        leads.to,
        originallyVertical,
        leads.grid,
      );
      points.splice(1, 0, ...bends);
      modes.splice(
        0,
        1,
        ...new Array<SegmentMode>(bends.length + 1).fill(mode),
      );
      return;
    }
    const insertIndex = side === "from" ? 1 : points.length - 1;
    points.splice(
      insertIndex,
      0,
      originallyVertical
        ? { x: neighbor.x, y: movedPoint.y }
        : { x: movedPoint.x, y: neighbor.y },
    );
    modes.splice(modeIndex, 1, mode, mode);
    return;
  }

  // A leg that was already free-angle keeps its heading; the tidying elbow is
  // for orthogonal drawings and would otherwise put a corner into a diagonal.
  if (isSegmentAllowed(movedPoint, neighbor, "octilinear")) return;

  const dx = neighbor.x - movedPoint.x;
  const dy = neighbor.y - movedPoint.y;
  const diagonalDistance = Math.min(Math.abs(dx), Math.abs(dy));
  const elbow =
    Math.abs(dx) > Math.abs(dy)
      ? {
          x: movedPoint.x + Math.sign(dx) * diagonalDistance,
          y: neighbor.y,
        }
      : {
          x: neighbor.x,
          y: movedPoint.y + Math.sign(dy) * diagonalDistance,
        };
  const insertIndex = side === "from" ? 1 : points.length - 1;
  // The local stretch uses exactly the same octilinear leg constraint as Wire
  // authoring. Existing points are never rerouted or reclassified.
  points.splice(insertIndex, 0, elbow);
  const modeIndex = side === "from" ? 0 : modes.length - 1;
  const mode = modes[modeIndex]!;
  modes.splice(modeIndex, 1, mode, mode);
}
