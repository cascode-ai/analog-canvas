// Boundary-Route smoothing after a transform: fresh landing-to-landing
// candidates, scored on body crossings and lead axes, replace a stretched
// wire only where the stretch degraded it.
import {
  electricalConnectionGrid,
  routeEnd,
  transformPoint,
  type Point,
  type Rect,
  type SchematicDocument,
} from "@icm/model";
import { resolveInstanceSymbol, type SymbolResolver } from "@icm/symbols";
import {
  resolveEndpointConnection,
  visibleSymbolLocalBounds,
  type EndpointConnection,
} from "@icm/derived";
import type { SegmentMode } from "./route-geometry-edit.js";
import type { RouteStretchProposal } from "./route-operations.js";
import {
  normalizeProposal,
  protectedMode,
  tidyTerminalProposal,
} from "./route-stretch-proposal.js";

/**
 * A transform's boundary-Route smoothing context: the document with every
 * transformed placement applied, plus the world bounds of the moved bodies.
 */
export interface BoundarySmoothing {
  originalDocument: SchematicDocument;
  movedDocument: SchematicDocument;
  movedBodies: readonly Rect[];
}

export function movedInstanceBodies(
  document: SchematicDocument,
  resolver: SymbolResolver,
  movedInstanceIds: ReadonlySet<string>,
): Rect[] {
  return document.instances.flatMap((instance) => {
    if (!movedInstanceIds.has(instance.id) || !instance.placement) return [];
    // Its drawn ink, an adder's sign marks included.
    const resolved = resolveInstanceSymbol(resolver, instance);
    if (!resolved) return [];
    const box = visibleSymbolLocalBounds(
      resolved,
      instance.signalFlowParameters,
    );
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x, y: box.y + box.height },
      { x: box.x + box.width, y: box.y + box.height },
    ].map((point) =>
      transformPoint(point, instance.placement!.position, instance.placement!),
    );
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return [{ x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }];
  });
}

/** Count axis-aligned legs that pass through a body's interior. */
function bodyCrossings(
  points: readonly Point[],
  bodies: readonly Rect[],
): number {
  const inset = 0.5;
  let crossings = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    for (const body of bodies) {
      const left = body.x + inset;
      const right = body.x + body.width - inset;
      const top = body.y + inset;
      const bottom = body.y + body.height - inset;
      if (right <= left || bottom <= top) continue;
      const minX = Math.max(Math.min(a.x, b.x), left);
      const maxX = Math.min(Math.max(a.x, b.x), right);
      const minY = Math.max(Math.min(a.y, b.y), top);
      const maxY = Math.min(Math.max(a.y, b.y), bottom);
      if (minX > maxX || minY > maxY) continue;
      // Positive clipped length inside the interior counts; touching a
      // corner or grazing an edge does not.
      if (maxX - minX > 0.01 || maxY - minY > 0.01) crossings += 1;
    }
  }
  return crossings;
}

function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(
      points[index]!.x - points[index - 1]!.x,
      points[index]!.y - points[index - 1]!.y,
    );
  }
  return total;
}

function axisOf(a: Point, b: Point): "x" | "y" | null {
  if (a.x === b.x && a.y !== b.y) return "y";
  if (a.y === b.y && a.x !== b.x) return "x";
  return null;
}

/**
 * Rebuild a stretched boundary Route as a fresh minimal orthogonal path only
 * when the stretch itself degraded it: the transform grew the bend count (a
 * hook or double-back appeared) and a fresh landing-to-landing path is
 * simpler, or the stretched result runs through a moved symbol body a fresh
 * path avoids. A stretch that merely slides an existing bend keeps the
 * author's established detour byte-for-byte. Endpoints, Net, and Route
 * identity never change: this is presentation geometry only.
 */
export function smoothedBoundaryProposal(
  route: SchematicDocument["routes"][number],
  originalBendCount: number,
  stretched: RouteStretchProposal,
  smoothing: BoundarySmoothing,
  resolver: SymbolResolver,
  stretchedRawBendCount: number = stretched.waypoints.length,
): RouteStretchProposal {
  const proposal = smoothedBoundaryGeometry(
    route,
    originalBendCount,
    stretched,
    smoothing,
    resolver,
    stretchedRawBendCount,
  );
  return tidyTerminalProposal(
    smoothing.movedDocument,
    resolver,
    route,
    proposal,
    smoothing.originalDocument,
  );
}

function smoothedBoundaryGeometry(
  route: SchematicDocument["routes"][number],
  originalBendCount: number,
  stretched: RouteStretchProposal,
  smoothing: BoundarySmoothing,
  resolver: SymbolResolver,
  /**
   * Bend count of the stretched path BEFORE fold-back cancellation. A
   * cancelled double-back still means the stretch degraded the shape, so
   * the complexity trigger reads the raw count.
   */
  stretchedRawBendCount: number = stretched.waypoints.length,
): RouteStretchProposal {
  if (route.presentation === "power-rail" || stretched.collapsedToContact) {
    return stretched;
  }
  if (stretched.segmentModes.some((mode) => protectedMode(mode))) {
    return stretched;
  }
  const from = resolveEndpointConnection(
    smoothing.movedDocument,
    resolver,
    route.start,
  );
  const to = resolveEndpointConnection(
    smoothing.movedDocument,
    resolver,
    routeEnd(route),
  );
  if (!from || !to) return stretched;

  const candidates: Point[][] = [];
  const a = from.gridLanding;
  const b = to.gridLanding;
  if (a.x === b.x || a.y === b.y) {
    candidates.push([a, b]);
  } else {
    candidates.push([a, { x: b.x, y: a.y }, b]);
    candidates.push([a, { x: a.x, y: b.y }, b]);
    // One corner can only align with one of the two leads. Where both pins
    // point along the same axis, every single-corner shape has to arrive
    // across one of them and lay the wire over that symbol, so the two-corner
    // shapes are offered as well and scored on the same terms.
    const coarseGrid = smoothing.movedDocument.presentation.grid;
    const grid = [a, b].some(
      (point) => point.x % coarseGrid !== 0 || point.y % coarseGrid !== 0,
    )
      ? electricalConnectionGrid(coarseGrid)
      : coarseGrid;
    const between = (left: number, right: number): number =>
      grid > 0
        ? Math.round((left + right) / 2 / grid) * grid
        : (left + right) / 2;
    const crossbarY = between(a.y, b.y);
    const crossbarX = between(a.x, b.x);
    candidates.push([a, { x: a.x, y: crossbarY }, { x: b.x, y: crossbarY }, b]);
    candidates.push([a, { x: crossbarX, y: a.y }, { x: crossbarX, y: b.y }, b]);
  }

  const escapeAxis = (connection: EndpointConnection): "x" | "y" | null =>
    connection.outward === null
      ? null
      : Math.abs(connection.outward.x) >= Math.abs(connection.outward.y)
        ? "x"
        : "y";
  const fromAxis = escapeAxis(from);
  const toAxis = escapeAxis(to);

  let best: { points: Point[]; crossings: number } | null = null;
  let bestScore = -Infinity;
  for (const landing of candidates) {
    const full = [
      { ...from.contactPoint },
      ...landing.map((point) => ({ ...point })),
      { ...to.contactPoint },
    ].filter(
      (point, index, all) =>
        index === 0 ||
        point.x !== all[index - 1]!.x ||
        point.y !== all[index - 1]!.y,
    );
    const crossings = bodyCrossings(full, smoothing.movedBodies);
    let score = -4 * crossings;
    if (landing.length > 1) {
      if (fromAxis && axisOf(landing[0]!, landing[1]!) === fromAxis) score += 1;
      if (toAxis && axisOf(landing.at(-2)!, landing.at(-1)!) === toAxis) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = { points: full, crossings };
    }
  }
  if (!best || best.points.length < 2) return stretched;

  const freshModes: SegmentMode[] = [];
  for (let index = 1; index < best.points.length; index += 1) {
    const isFirst = index === 1;
    const isLast = index === best.points.length - 1;
    const escapeLeg =
      (isFirst &&
        (from.contactPoint.x !== a.x || from.contactPoint.y !== a.y)) ||
      (isLast && (to.contactPoint.x !== b.x || to.contactPoint.y !== b.y));
    freshModes.push(escapeLeg ? "escape" : "manual");
  }
  let fresh: RouteStretchProposal;
  try {
    fresh = normalizeProposal(route.id, best.points, freshModes);
  } catch {
    return stretched;
  }

  const stretchedFull = [
    best.points[0]!,
    ...stretched.waypoints,
    best.points.at(-1)!,
  ];
  // A rigid turn re-aims the pins but the stretch kept the old leg axes:
  // an escape end leg that no longer leaves its pin outward can never pass
  // commit validation, so a stale lead forces the rebuild.
  const escapeLegStale = (
    mode: SegmentMode | undefined,
    anchor: Point,
    next: Point | undefined,
    outward: Point | null,
  ): boolean => {
    if (mode !== "escape" || !outward || !next) return false;
    const dir = { x: next.x - anchor.x, y: next.y - anchor.y };
    return dir.x * outward.x + dir.y * outward.y <= 0;
  };
  const escapeStale =
    escapeLegStale(
      stretched.segmentModes[0],
      stretchedFull[0]!,
      stretchedFull[1],
      from.outward,
    ) ||
    escapeLegStale(
      stretched.segmentModes.at(-1),
      stretchedFull.at(-1)!,
      stretchedFull.at(-2),
      to.outward,
    );
  const stretchedCrossings = bodyCrossings(
    stretchedFull,
    smoothing.movedBodies,
  );
  const grewComplexity = stretchedRawBendCount > originalBendCount;
  // A wrap-around stretch shows up as sheer length: substantially longer
  // than the minimal landing-to-landing path means the old shape has gone
  // stale for the new positions.
  const lengthDegraded =
    pathLength(stretchedFull) > pathLength(best.points) * 1.5 + 20;
  const rebuild =
    escapeStale ||
    (best.crossings <= stretchedCrossings &&
      ((grewComplexity &&
        fresh.waypoints.length < stretched.waypoints.length) ||
        best.crossings < stretchedCrossings ||
        lengthDegraded) &&
      fresh.waypoints.length <= Math.max(stretched.waypoints.length, 1));
  return rebuild ? fresh : stretched;
}
