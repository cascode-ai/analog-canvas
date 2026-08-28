import {
  reflectOrientation,
  routeBends,
  routeEnd,
  routeModes,
  transformPoint,
  type Orientation,
  type Point,
  type Rect,
  type RouteEndpoint,
  type SchematicDocument,
  type ScreenFlip,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  deriveInternalGroupSelection as deriveRoutingInternalGroupSelection,
  derivePowerRailComponent,
  isSegmentAllowed,
  polylineSatisfiesConstraint,
  resolveDocumentRoutingGeometry,
  resolveEndpointConnection,
  resolveRouteGeometry,
  visibleSymbolLocalBounds,
  type EndpointConnection,
  type ResolvedDocumentRoutingGeometry,
} from "@icm/derived";
import {
  bridgeStretchedSegment,
  moveRouteSegment,
  normalizeRouteGeometry,
  usablePinAxis,
  type PinAxis,
  type RouteEditPath,
  type SegmentMode,
} from "./route-geometry-edit.js";

export interface RouteStretchProposal {
  routeId: string;
  waypoints: Point[];
  segmentModes: SegmentMode[];
}

export function resolveRouteEditPath(
  document: SchematicDocument,
  resolver: SymbolResolver,
  route: SchematicDocument["routes"][number],
): RouteEditPath | null {
  const geometry = resolveRouteGeometry(document, resolver, route);
  return geometry
    ? {
        points: [...geometry.centerline],
        segmentModes: geometry.segments.map((segment) => segment.mode),
      }
    : null;
}

export interface InstanceMoveProposal {
  instanceId: string;
  position: Point;
}

export interface JunctionMoveProposal {
  junctionId: string;
  position: Point;
}

export interface AnnotationMoveProposal {
  annotationId: string;
  anchor: Extract<
    SchematicDocument["annotations"][number]["anchor"],
    {
      kind: "free";
    }
  >;
}

export interface GroupMoveProposal {
  routes: RouteStretchProposal[];
  junctions: JunctionMoveProposal[];
  annotations: AnnotationMoveProposal[];
  internalNetIds: string[];
  internalRouteIds: string[];
}

/**
 * A topology-preserving direct-manipulation proposal for one visible wire
 * segment. Multiple persisted Routes may participate when a dotless
 * `route-anchor` happens to divide the visible conductor.
 */
export interface WireSegmentDragProposal {
  routes: RouteStretchProposal[];
  junctions: JunctionMoveProposal[];
}

/**
 * A persisted Junction is a topological vertex, not an absolute geometric
 * anchor. Dragging a segment that terminates at one therefore moves the vertex
 * and lets every incident Route stretch around it. Terminals remain hard
 * anchors: their positions belong to their Symbols.
 */
function movableSegmentJunctionId(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
): string | null {
  if (endpoint.kind !== "junction") return null;
  const junction = document.junctions.find(
    (candidate) => candidate.id === endpoint.junctionId,
  );
  if (!junction) return null;
  return junction.id;
}

function routeSideEndpoint(
  route: SchematicDocument["routes"][number],
  side: "from" | "to",
): RouteEndpoint {
  return side === "from" ? route.start : routeEnd(route);
}

/**
 * Reject a Junction move that would leave two of its branches overlapping.
 *
 * A dragged segment carries its Junction anchor along, and the branches that
 * stay behind stretch to follow. Carried far enough, one of those branches
 * comes to leave the Junction in the direction another one already leaves in:
 * the two draw on top of each other, the shorter disappears inside the
 * longer, and the contact stops reading as a branch at all — which is exactly
 * when the junction dot goes out.
 *
 * Throwing is the drag's stop. Both the preview and the commit already keep
 * the last geometry that planned, so the wire simply stops following the
 * pointer at the last position where every branch is still its own line.
 */
function assertJunctionBranchesStayVisible(
  document: SchematicDocument,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  proposal: WireSegmentDragProposal,
  junctionIds: readonly string[],
): void {
  if (junctionIds.length === 0) return;
  const movedById = new Map(
    proposal.junctions.map((move) => [move.junctionId, move.position]),
  );
  const proposedById = new Map(
    proposal.routes.map((route) => [route.routeId, route.waypoints]),
  );

  const resultingPoints = (
    route: SchematicDocument["routes"][number],
  ): Point[] | null => {
    const original = routingGeometry.routes.get(route.id)?.centerline;
    if (!original || original.length < 2) return null;
    const endpoint = (
      side: "from" | "to",
      fallback: Point,
    ): Point | undefined => {
      const value = routeSideEndpoint(route, side);
      return value.kind === "junction"
        ? (movedById.get(value.junctionId) ?? fallback)
        : fallback;
    };
    const waypoints = proposedById.get(route.id) ?? original.slice(1, -1);
    const from = endpoint("from", original[0]!);
    const to = endpoint("to", original[original.length - 1]!);
    if (!from || !to) return null;
    return [from, ...waypoints, to];
  };

  const headingKey = (from: Point, to: Point): string | null => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;
    const round = (value: number) => Math.round((value / length) * 1e6) / 1e6;
    return `${round(dx)}:${round(dy)}`;
  };

  for (const junctionId of junctionIds) {
    const headings = new Map<string, string>();
    for (const route of document.routes) {
      const points = resultingPoints(route);
      if (!points) continue;
      for (const side of ["from", "to"] as const) {
        const value = routeSideEndpoint(route, side);
        if (value.kind !== "junction" || value.junctionId !== junctionId) {
          continue;
        }
        const at = side === "from" ? points[0]! : points[points.length - 1]!;
        const neighbor =
          side === "from" ? points[1]! : points[points.length - 2]!;
        const key = headingKey(at, neighbor);
        if (!key) continue;
        const existing = headings.get(key);
        if (existing && existing !== route.id) {
          throw new Error(
            `Routes ${existing} and ${route.id} would overlap leaving junction ${junctionId}`,
          );
        }
        headings.set(key, route.id);
      }
    }
  }
}

function protectedMode(mode: SegmentMode | undefined): boolean {
  return mode === "locked" || mode === "trunk";
}

function routeEditPathFromGeometry(
  routingGeometry: ResolvedDocumentRoutingGeometry,
  routeId: string,
): RouteEditPath | null {
  const geometry = routingGeometry.routes.get(routeId);
  if (!geometry) return null;
  return {
    points: [...geometry.centerline],
    segmentModes: geometry.segments.map((segment) => segment.mode),
  };
}

/** Every stored step must advance; heading itself is unconstrained. */
function isSegmentGeometryUsable(points: readonly Point[]): boolean {
  return polylineSatisfiesConstraint(points, "any-angle");
}

function normalizeProposal(
  routeId: string,
  points: readonly Point[],
  modes: readonly SegmentMode[],
): RouteStretchProposal {
  const normalized = normalizeRouteGeometry(points, modes);
  // Any heading is legal geometry (ADR 0039); only a degenerate segment is
  // not, and normalizeRouteGeometry already removes zero-length steps.
  if (!isSegmentGeometryUsable(normalized.points)) {
    throw new Error(
      `Wire segment drag would leave route ${routeId} degenerate`,
    );
  }
  return {
    routeId,
    waypoints: normalized.points.slice(1, -1),
    segmentModes: normalized.segmentModes,
  };
}

function stretchRouteEndpoint(
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
): void {
  const segmentMode = side === "from" ? modes[0] : modes.at(-1);
  if (protectedMode(segmentMode)) {
    throw new Error(`Route ${routeId} has a protected adjacent segment`);
  }
  const endpointIndex = side === "from" ? 0 : points.length - 1;
  const neighborIndex = side === "from" ? 1 : points.length - 2;
  const neighbor = points[neighborIndex]!;
  points[endpointIndex] = { ...movedPoint };

  const originallyVertical =
    originalPoint.x === neighbor.x && originalPoint.y !== neighbor.y;
  const originallyHorizontal =
    originalPoint.y === neighbor.y && originalPoint.x !== neighbor.x;
  // Preserve established orthogonal stretch geometry byte-for-byte. The
  // generic branch below only handles an existing diagonal or future heading.
  if (originallyVertical || originallyHorizontal) {
    if (points.length > 2) {
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

/**
 * A transform's boundary-Route smoothing context: the document with every
 * transformed placement applied, plus the world bounds of the moved bodies.
 */
interface BoundarySmoothing {
  movedDocument: SchematicDocument;
  movedBodies: readonly Rect[];
}

function movedInstanceBodies(
  document: SchematicDocument,
  resolver: SymbolResolver,
  movedInstanceIds: ReadonlySet<string>,
): Rect[] {
  return document.instances.flatMap((instance) => {
    if (!movedInstanceIds.has(instance.id) || !instance.placement) return [];
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) return [];
    const box = visibleSymbolLocalBounds(resolved);
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
function smoothedBoundaryProposal(
  route: SchematicDocument["routes"][number],
  originalBendCount: number,
  stretched: RouteStretchProposal,
  smoothing: BoundarySmoothing,
  resolver: SymbolResolver,
): RouteStretchProposal {
  if (
    route.presentation === "power-rail" ||
    route.presentation === "bulk-dashed"
  ) {
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
    const grid = smoothing.movedDocument.presentation.grid;
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
  const stretchedCrossings = bodyCrossings(
    stretchedFull,
    smoothing.movedBodies,
  );
  const grewComplexity = stretched.waypoints.length > originalBendCount;
  // A wrap-around stretch shows up as sheer length: substantially longer
  // than the minimal landing-to-landing path means the old shape has gone
  // stale for the new positions.
  const lengthDegraded =
    pathLength(stretchedFull) > pathLength(best.points) * 1.5 + 20;
  const rebuild =
    best.crossings <= stretchedCrossings &&
    ((grewComplexity && fresh.waypoints.length < stretched.waypoints.length) ||
      best.crossings < stretchedCrossings ||
      lengthDegraded) &&
    fresh.waypoints.length <= Math.max(stretched.waypoints.length, 1);
  return rebuild ? fresh : stretched;
}

/**
 * Move an explicit set of Junctions and reshape every incident Route in one
 * topology-preserving proposal. Routes wholly inside the moved set translate;
 * routes leaving it grow a local orthogonal dogleg at their moved end.
 */
export function proposeJunctionGroupTranslation(
  document: SchematicDocument,
  resolver: SymbolResolver,
  moves: readonly JunctionMoveProposal[],
): WireSegmentDragProposal {
  const movedJunctions = new Map(
    moves.map((move) => [move.junctionId, move.position] as const),
  );
  for (const junctionId of movedJunctions.keys()) {
    if (!document.junctions.some((junction) => junction.id === junctionId)) {
      throw new Error(`Junction not found: ${junctionId}`);
    }
  }
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const proposals = new Map<string, RouteStretchProposal>();
  for (const route of document.routes) {
    const end = routeEnd(route);
    const movedFrom =
      route.start.kind === "junction"
        ? movedJunctions.get(route.start.junctionId)
        : undefined;
    const movedTo =
      end.kind === "junction" ? movedJunctions.get(end.junctionId) : undefined;
    if (!movedFrom && !movedTo) continue;

    const polyline = routeEditPathFromGeometry(routingGeometry, route.id);
    if (!polyline) throw new Error(`Route ${route.id} has unresolved geometry`);
    const points = polyline.points.map((point) => ({ ...point }));
    const modes = [...polyline.segmentModes];
    const fromDelta = movedFrom
      ? {
          x: movedFrom.x - polyline.points[0]!.x,
          y: movedFrom.y - polyline.points[0]!.y,
        }
      : null;
    const toDelta = movedTo
      ? {
          x: movedTo.x - polyline.points.at(-1)!.x,
          y: movedTo.y - polyline.points.at(-1)!.y,
        }
      : null;
    if (
      fromDelta &&
      toDelta &&
      fromDelta.x === toDelta.x &&
      fromDelta.y === toDelta.y
    ) {
      if (modes.some(protectedMode)) {
        throw new Error(`Route ${route.id} contains a protected segment`);
      }
      proposals.set(route.id, {
        routeId: route.id,
        waypoints: routeBends(route).map((point) => ({
          x: point.x + fromDelta.x,
          y: point.y + fromDelta.y,
        })),
        segmentModes: modes,
      });
      continue;
    }
    if (movedFrom) {
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "from",
        polyline.points[0]!,
        movedFrom,
      );
    }
    if (movedTo) {
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "to",
        polyline.points.at(-1)!,
        movedTo,
      );
    }
    proposals.set(route.id, normalizeProposal(route.id, points, modes));
  }
  return {
    routes: [...proposals.values()].sort((left, right) =>
      left.routeId.localeCompare(right.routeId, "en"),
    ),
    junctions: [...movedJunctions.entries()]
      .map(([junctionId, position]) => ({ junctionId, position }))
      .sort((left, right) =>
        left.junctionId.localeCompare(right.junctionId, "en"),
      ),
  };
}

/**
 * Move a visible orthogonal segment perpendicular to itself while preserving
 * connectivity across persisted Route boundaries. The caller commits the
 * returned Junction and Route edits together in one transaction.
 */
export function proposeWireSegmentDrag(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  segmentIndex: number,
  target: Point,
): WireSegmentDragProposal {
  const selectedRoute = document.routes.find((route) => route.id === routeId);
  if (!selectedRoute) throw new Error(`Route not found: ${routeId}`);
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const selectedPolyline = routeEditPathFromGeometry(routingGeometry, routeId);
  if (!selectedPolyline)
    throw new Error(`Route ${routeId} has unresolved geometry`);
  if (segmentIndex < 0 || segmentIndex >= selectedPolyline.points.length - 1) {
    throw new Error(`Route segment index is out of range: ${segmentIndex}`);
  }
  const affectedModes = [
    selectedPolyline.segmentModes[segmentIndex - 1],
    selectedPolyline.segmentModes[segmentIndex],
    selectedPolyline.segmentModes[segmentIndex + 1],
  ];
  if (affectedModes.some(protectedMode)) {
    throw new Error("Route segment or its neighbor is protected");
  }

  const fromPoint = selectedPolyline.points[segmentIndex]!;
  const toPoint = selectedPolyline.points[segmentIndex + 1]!;
  const horizontal = fromPoint.y === toPoint.y;
  const vertical = fromPoint.x === toPoint.x;
  const diagonal = !horizontal && !vertical;
  if (horizontal && vertical) {
    throw new Error(`Route ${routeId} segment is degenerate`);
  }

  const lastPointIndex = selectedPolyline.points.length - 1;
  const selectedEndpointJunction = (pointIndex: number): string | null => {
    if (pointIndex === 0) {
      return movableSegmentJunctionId(document, selectedRoute.start);
    }
    if (pointIndex === lastPointIndex) {
      return movableSegmentJunctionId(document, routeEnd(selectedRoute));
    }
    return null;
  };
  const leftAnchorId = selectedEndpointJunction(segmentIndex);
  const rightAnchorId = selectedEndpointJunction(segmentIndex + 1);

  if (diagonal) {
    const slope = Math.sign(
      (toPoint.y - fromPoint.y) / (toPoint.x - fromPoint.x),
    );
    const offset =
      target.y - slope * target.x - (fromPoint.y - slope * fromPoint.x);
    const movedJunctions = new Map<string, Point>();
    for (const anchorId of [leftAnchorId, rightAnchorId]) {
      if (!anchorId || movedJunctions.has(anchorId)) continue;
      const junction = document.junctions.find(
        (candidate) => candidate.id === anchorId,
      )!;
      // Vertical translation is an exact perpendicular offset for either
      // 45-degree heading.  Incident routes are then stretched by the same
      // shared Junction proposal as an orthogonal drag.
      movedJunctions.set(anchorId, {
        x: junction.position.x,
        y: junction.position.y + offset,
      });
    }
    if (movedJunctions.size > 0) {
      const planned = proposeJunctionGroupTranslation(
        document,
        resolver,
        [...movedJunctions.entries()].map(([junctionId, position]) => ({
          junctionId,
          position,
        })),
      );
      const anchorIds = [leftAnchorId, rightAnchorId].filter(
        (value): value is string => value !== null,
      );
      try {
        assertJunctionBranchesStayVisible(
          document,
          routingGeometry,
          planned,
          anchorIds,
        );
        return planned;
      } catch {
        const doglegged: WireSegmentDragProposal = {
          routes: [
            {
              routeId,
              ...moveRouteSegment(selectedPolyline, segmentIndex, target),
            },
          ],
          junctions: [],
        };
        assertJunctionBranchesStayVisible(
          document,
          routingGeometry,
          doglegged,
          anchorIds,
        );
        return doglegged;
      }
    }
    return {
      routes: [
        {
          routeId,
          ...moveRouteSegment(selectedPolyline, segmentIndex, target),
        },
      ],
      junctions: [],
    };
  }

  // Ordinary single-Route bends keep the established dogleg behavior. The
  // topology-aware path is required only when a persisted Junction makes the
  // graph vertex observable.
  if (!leftAnchorId && !rightAnchorId) {
    return {
      routes: [
        {
          routeId,
          ...moveRouteSegment(selectedPolyline, segmentIndex, target),
        },
      ],
      junctions: [],
    };
  }

  const axis: "x" | "y" = horizontal ? "y" : "x";
  const coordinate = target[axis];
  const movedJunctions = new Map<string, Point>();
  for (const anchorId of [leftAnchorId, rightAnchorId]) {
    if (!anchorId || movedJunctions.has(anchorId)) continue;
    const junction = document.junctions.find(
      (candidate) => candidate.id === anchorId,
    )!;
    movedJunctions.set(anchorId, { ...junction.position, [axis]: coordinate });
  }

  const selectedPoints = selectedPolyline.points.map((point) => ({ ...point }));
  const selectedModes = [...selectedPolyline.segmentModes];
  const left = selectedPoints[segmentIndex]!;
  const right = selectedPoints[segmentIndex + 1]!;
  if (segmentIndex > 0 || leftAnchorId) left[axis] = coordinate;
  if (segmentIndex + 1 < lastPointIndex || rightAnchorId) {
    right[axis] = coordinate;
  }

  // A hard endpoint stays in place; split only that boundary segment to form
  // the local dogleg. Internal bends and soft anchors move with the segment.
  if (segmentIndex === 0 && !leftAnchorId && left[axis] !== coordinate) {
    const mode = selectedModes[0]!;
    selectedPoints.splice(1, 0, { ...left, [axis]: coordinate });
    selectedModes.splice(0, 1, mode, mode);
  }
  const selectedRightIndex = selectedPoints.indexOf(right);
  if (
    segmentIndex + 1 === lastPointIndex &&
    !rightAnchorId &&
    right[axis] !== coordinate
  ) {
    const modeIndex = selectedRightIndex - 1;
    const mode = selectedModes[modeIndex]!;
    selectedPoints.splice(selectedRightIndex, 0, {
      ...right,
      [axis]: coordinate,
    });
    selectedModes.splice(modeIndex, 1, mode, mode);
  }

  const proposals = new Map<string, RouteStretchProposal>();
  proposals.set(
    routeId,
    normalizeProposal(routeId, selectedPoints, selectedModes),
  );

  for (const route of document.routes) {
    if (route.id === routeId) continue;
    const fromAnchor = movableSegmentJunctionId(document, route.start);
    const toAnchor = movableSegmentJunctionId(document, routeEnd(route));
    const movedFrom = fromAnchor ? movedJunctions.get(fromAnchor) : undefined;
    const movedTo = toAnchor ? movedJunctions.get(toAnchor) : undefined;
    if (!movedFrom && !movedTo) continue;
    const polyline = routeEditPathFromGeometry(routingGeometry, route.id);
    if (!polyline) throw new Error(`Route ${route.id} has unresolved geometry`);
    const points = polyline.points.map((point) => ({ ...point }));
    const modes = [...polyline.segmentModes];
    if (movedFrom) {
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "from",
        polyline.points[0]!,
        movedFrom,
      );
    }
    if (movedTo) {
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "to",
        polyline.points.at(-1)!,
        movedTo,
      );
    }
    proposals.set(route.id, normalizeProposal(route.id, points, modes));
  }

  const planned: WireSegmentDragProposal = {
    routes: [...proposals.values()].sort((leftProposal, rightProposal) =>
      leftProposal.routeId.localeCompare(rightProposal.routeId, "en"),
    ),
    junctions: [...movedJunctions.entries()]
      .map(([junctionId, position]) => ({ junctionId, position }))
      .sort((leftMove, rightMove) =>
        leftMove.junctionId.localeCompare(rightMove.junctionId, "en"),
      ),
  };
  // Carrying the Junction is the nicer result while it works — the tap slides
  // and nothing bends. Once it would bury a branch, the Junction stays put and
  // the dragged Route doglegs to reach it instead, so the pointer is still
  // followed and the contact still reads as a branch.
  const anchorIds = [leftAnchorId, rightAnchorId].filter(
    (value): value is string => value !== null,
  );
  try {
    assertJunctionBranchesStayVisible(
      document,
      routingGeometry,
      planned,
      anchorIds,
    );
    return planned;
  } catch {
    // The dogleg is checked too: dragged far enough past a branch, its own
    // leg comes down that branch's line and buries it just as moving the
    // Junction would. When neither plan keeps every branch visible the error
    // stands, and the drag holds at the last position that did.
    const doglegged: WireSegmentDragProposal = {
      routes: [
        {
          routeId,
          ...moveRouteSegment(selectedPolyline, segmentIndex, target),
        },
      ],
      junctions: [],
    };
    assertJunctionBranchesStayVisible(
      document,
      routingGeometry,
      doglegged,
      anchorIds,
    );
    return doglegged;
  }
}

export function proposeLocalStretch(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceId: string,
  newPosition: Point,
): RouteStretchProposal[] {
  const instance = document.instances.find(
    (candidate) => candidate.id === instanceId,
  );
  if (!instance?.placement)
    throw new Error(`Placed instance not found: ${instanceId}`);
  const movedDocument = structuredClone(document);
  const movedInstance = movedDocument.instances.find(
    (candidate) => candidate.id === instanceId,
  )!;
  movedInstance.placement!.position = { ...newPosition };
  const smoothing: BoundarySmoothing = {
    movedDocument,
    movedBodies: movedInstanceBodies(
      movedDocument,
      resolver,
      new Set([instanceId]),
    ),
  };
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const proposals: RouteStretchProposal[] = [];

  for (const route of document.routes) {
    const end = routeEnd(route);
    const movesFrom =
      route.start.kind === "terminal" && route.start.instanceId === instanceId;
    const movesTo = end.kind === "terminal" && end.instanceId === instanceId;
    if (!movesFrom && !movesTo) continue;
    const original = routeEditPathFromGeometry(routingGeometry, route.id);
    const newFrom = resolveEndpointConnection(
      movedDocument,
      resolver,
      route.start,
    );
    const newTo = resolveEndpointConnection(movedDocument, resolver, end);
    if (!original || !newFrom || !newTo) continue;
    const points = original.points.map((point) => ({ ...point }));
    const modes = [...original.segmentModes];
    if (movesFrom) {
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "from",
        original.points[0]!,
        newFrom.contactPoint,
      );
    }
    if (movesTo) {
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "to",
        original.points.at(-1)!,
        newTo.contactPoint,
      );
    }
    proposals.push(
      smoothedBoundaryProposal(
        route,
        original.points.length - 2,
        normalizeProposal(route.id, points, modes),
        smoothing,
        resolver,
      ),
    );
  }
  return proposals.sort((left, right) =>
    left.routeId.localeCompare(right.routeId, "en"),
  );
}

export function proposeGroupStretch(
  document: SchematicDocument,
  resolver: SymbolResolver,
  moves: readonly InstanceMoveProposal[],
): RouteStretchProposal[] {
  return proposeGroupMove(document, resolver, moves).routes;
}

/**
 * Lead axes for a Route whose whole body is one segment, read from the
 * post-move document so the pins are where the drag left them. Longer Routes
 * already turn before each pin and need no bridge.
 */
function stretchedSegmentLeads(
  movedDocument: SchematicDocument,
  resolver: SymbolResolver,
  route: SchematicDocument["routes"][number],
  pointCount: number,
): { from: PinAxis; to: PinAxis; grid: number } | undefined {
  if (pointCount !== 2) return undefined;
  const from = resolveEndpointConnection(movedDocument, resolver, route.start);
  const to = resolveEndpointConnection(
    movedDocument,
    resolver,
    routeEnd(route),
  );
  if (!from || !to) return undefined;
  return {
    from: usablePinAxis(from.outward, from.contactPoint, to.contactPoint),
    to: usablePinAxis(to.outward, to.contactPoint, from.contactPoint),
    grid: movedDocument.presentation.grid,
  };
}

export function proposeGroupMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  moves: readonly InstanceMoveProposal[],
  additionalJunctionIds: readonly string[] = [],
  explicitDelta?: Point,
): GroupMoveProposal {
  const moveByInstance = new Map(
    moves.map((move) => [move.instanceId, move.position]),
  );
  const deltaByInstance = new Map<string, Point>();
  for (const move of moves) {
    const instance = document.instances.find(
      (candidate) => candidate.id === move.instanceId,
    );
    if (!instance?.placement) {
      throw new Error(`Placed instance not found: ${move.instanceId}`);
    }
    deltaByInstance.set(move.instanceId, {
      x: move.position.x - instance.placement.position.x,
      y: move.position.y - instance.placement.position.y,
    });
  }

  const deltas = [...deltaByInstance.values()];
  const groupDelta = deltas[0] ?? explicitDelta ?? { x: 0, y: 0 };
  if (
    deltas.some((delta) => delta.x !== groupDelta.x || delta.y !== groupDelta.y)
  ) {
    throw new Error("Group members must move by one common delta");
  }
  const internalSelection = deriveRoutingInternalGroupSelection(document, [
    ...moveByInstance.keys(),
  ]);
  const internalNetIds = new Set(internalSelection.netIds);
  const movableJunctionIds = new Set(internalSelection.junctionIds);
  for (const junctionId of additionalJunctionIds) {
    if (document.junctions.some((junction) => junction.id === junctionId)) {
      movableJunctionIds.add(junctionId);
    }
  }
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const movedDocument = structuredClone(document);
  for (const instance of movedDocument.instances) {
    const target = moveByInstance.get(instance.id);
    if (target && instance.placement) {
      instance.placement.position = { ...target };
    }
  }
  for (const junction of movedDocument.junctions) {
    if (movableJunctionIds.has(junction.id)) {
      junction.position = {
        x: junction.position.x + groupDelta.x,
        y: junction.position.y + groupDelta.y,
      };
    }
  }
  const smoothing: BoundarySmoothing = {
    movedDocument,
    movedBodies: movedInstanceBodies(
      movedDocument,
      resolver,
      new Set(moveByInstance.keys()),
    ),
  };

  const proposals = new Map<string, RouteStretchProposal>();
  for (const route of document.routes) {
    const end = routeEnd(route);
    const fromDelta =
      route.start.kind === "terminal"
        ? deltaByInstance.get(route.start.instanceId)
        : undefined;
    const toDelta =
      end.kind === "terminal"
        ? deltaByInstance.get(end.instanceId)
        : end.kind === "junction" && movableJunctionIds.has(end.junctionId)
          ? groupDelta
          : undefined;
    const resolvedFromDelta =
      route.start.kind === "junction" &&
      movableJunctionIds.has(route.start.junctionId)
        ? groupDelta
        : fromDelta;
    if (!resolvedFromDelta && !toDelta) continue;

    if (
      resolvedFromDelta &&
      toDelta &&
      resolvedFromDelta.x === toDelta.x &&
      resolvedFromDelta.y === toDelta.y
    ) {
      if (route.legs.some((leg) => leg.mode === "locked")) {
        throw new Error(`Route ${route.id} contains a locked segment`);
      }
      proposals.set(route.id, {
        routeId: route.id,
        waypoints: routeBends(route).map((point) => ({
          x: point.x + resolvedFromDelta.x,
          y: point.y + resolvedFromDelta.y,
        })),
        segmentModes: routeModes(route),
      });
      continue;
    }

    if (resolvedFromDelta && toDelta) {
      throw new Error(
        `Route ${route.id} cannot stretch endpoints by different group deltas`,
      );
    }
    const original = routeEditPathFromGeometry(routingGeometry, route.id);
    if (!original) throw new Error(`Route ${route.id} has unresolved geometry`);
    const points = original.points.map((point) => ({ ...point }));
    const modes = [...original.segmentModes];
    const leads = stretchedSegmentLeads(
      movedDocument,
      resolver,
      route,
      original.points.length,
    );
    if (resolvedFromDelta) {
      const from = original.points[0]!;
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "from",
        from,
        { x: from.x + resolvedFromDelta.x, y: from.y + resolvedFromDelta.y },
        leads,
      );
    }
    if (toDelta) {
      const to = original.points.at(-1)!;
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "to",
        to,
        { x: to.x + toDelta.x, y: to.y + toDelta.y },
        leads,
      );
    }
    proposals.set(
      route.id,
      smoothedBoundaryProposal(
        route,
        original.points.length - 2,
        normalizeProposal(route.id, points, modes),
        smoothing,
        resolver,
      ),
    );
  }
  const internalRouteIds = internalSelection.routeIds;
  const internallyMovedObjectIds = new Set<string>([
    ...internalNetIds,
    ...internalRouteIds,
    ...movableJunctionIds,
  ]);
  return {
    routes: [...proposals.values()].sort((left, right) =>
      left.routeId.localeCompare(right.routeId, "en"),
    ),
    junctions: document.junctions
      .filter((junction) => movableJunctionIds.has(junction.id))
      .map((junction) => ({
        junctionId: junction.id,
        position: {
          x: junction.position.x + groupDelta.x,
          y: junction.position.y + groupDelta.y,
        },
      }))
      .sort((left, right) =>
        left.junctionId.localeCompare(right.junctionId, "en"),
      ),
    annotations: document.annotations
      .filter(
        (annotation) =>
          annotation.anchor.kind === "free" &&
          // Free text has no object relationship. It follows a selected group
          // only when it lies inside that group's translated routing closure.
          internallyMovedObjectIds.has(annotation.netId ?? ""),
      )
      .map((annotation) => {
        const anchor = annotation.anchor;
        if (anchor.kind !== "free") {
          throw new Error("Free annotation filter lost anchor narrowing");
        }
        return {
          annotationId: annotation.id,
          anchor: {
            kind: "free" as const,
            position: {
              x: anchor.position.x + groupDelta.x,
              y: anchor.position.y + groupDelta.y,
            },
          },
        };
      })
      .sort((left, right) =>
        left.annotationId.localeCompare(right.annotationId, "en"),
      ),
    internalNetIds: [...internalNetIds].sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
    internalRouteIds,
  };
}

export interface InstanceRotationProposal {
  instanceId: string;
  position: Point;
  rotation: 0 | 90 | 180 | 270;
  mirror: "none" | "x";
}

export interface GroupRotationProposal {
  instances: InstanceRotationProposal[];
  routes: RouteStretchProposal[];
  junctions: JunctionMoveProposal[];
  annotations: AnnotationMoveProposal[];
  pivot: Point;
}

/** Screen-space turn: positive angles turn clockwise, as SVG rotate() does. */
function turn(point: Point, pivot: Point, deltaDegrees: 90 | -90 | 180): Point {
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  if (deltaDegrees === 90) return { x: pivot.x - dy, y: pivot.y + dx };
  if (deltaDegrees === -90) return { x: pivot.x + dy, y: pivot.y - dx };
  return { x: pivot.x - dx, y: pivot.y - dy };
}

/**
 * Turn a selection as one rigid body.
 *
 * Rotating each Instance about its own origin leaves the group's layout
 * untouched, which is not what selecting several parts and turning them
 * means. Here every member orbits one shared pivot and turns by the same
 * angle, so the arrangement itself rotates.
 *
 * The pivot is the centre of the selected Instances' bounding box snapped to
 * the grid, which keeps on-grid geometry exactly on-grid through the turn.
 *
 * A rigid turn also fixes where each pin lands: an Instance and its pins
 * rotate together, so a terminal endpoint's new position is simply its old
 * position orbited about the pivot. Routes wholly inside the selection turn
 * with it; a Route that leaves the selection keeps its outside endpoint and
 * stretches, exactly as a group translation does.
 */
export function proposeGroupRotation(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  deltaDegrees: 90 | -90 | 180,
  center?: Point,
): GroupRotationProposal {
  return proposeRigidBodyMove(
    document,
    resolver,
    instanceIds,
    (pivot) => ({
      point: (point) => turn(point, pivot, deltaDegrees),
      placement: (placement) => ({
        rotation: ((((placement.rotation + deltaDegrees) % 360) + 360) %
          360) as 0 | 90 | 180 | 270,
        mirror: placement.mirror,
      }),
    }),
    center,
  );
}

/**
 * Reflect a selection as one rigid body.
 *
 * Reflecting each part about its own centre leaves the arrangement exactly
 * where it was, the same way rotating each part in place did — a row of three
 * flipped one at a time is still the same row. Here the arrangement reflects
 * about the selection's own axis and every part reflects with it, so a signal
 * path that ran left to right runs right to left.
 */
export function proposeGroupReflection(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  direction: ScreenFlip,
  center?: Point,
): GroupRotationProposal {
  const axis = direction === "left-right" ? "x" : "y";
  return proposeRigidBodyMove(
    document,
    resolver,
    instanceIds,
    (pivot) => ({
      point: (point) => ({ ...point, [axis]: 2 * pivot[axis] - point[axis] }),
      placement: (placement) => reflectOrientation(placement, direction),
    }),
    center,
  );
}

interface RigidBodyTransform {
  point: (point: Point) => Point;
  placement: (placement: Orientation) => Orientation;
}

function proposeRigidBodyMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  transformFor: (pivot: Point) => RigidBodyTransform,
  center?: Point,
): GroupRotationProposal {
  const selected = new Set(instanceIds);
  const placed = document.instances.filter(
    (instance) => selected.has(instance.id) && instance.placement,
  );
  if (placed.length === 0) {
    return {
      instances: [],
      routes: [],
      junctions: [],
      annotations: [],
      pivot: { x: 0, y: 0 },
    };
  }

  const grid = document.presentation.grid;
  const xs = placed.map((instance) => instance.placement!.position.x);
  const ys = placed.map((instance) => instance.placement!.position.y);
  const snap = (value: number): number =>
    grid > 0 ? Math.round(value / grid) * grid : value;
  const pivot = center
    ? { x: snap(center.x), y: snap(center.y) }
    : {
        x: snap((Math.min(...xs) + Math.max(...xs)) / 2),
        y: snap((Math.min(...ys) + Math.max(...ys)) / 2),
      };

  const transform = transformFor(pivot);
  const instances = placed
    .map((instance): InstanceRotationProposal => {
      const placement = instance.placement!;
      const oriented = transform.placement(placement);
      return {
        instanceId: instance.id,
        position: transform.point(placement.position),
        rotation: oriented.rotation,
        mirror: oriented.mirror,
      };
    })
    .sort((left, right) =>
      left.instanceId.localeCompare(right.instanceId, "en"),
    );

  const internalSelection = deriveRoutingInternalGroupSelection(document, [
    ...selected,
  ]);
  const internalNetIds = new Set(internalSelection.netIds);
  const turningJunctionIds = new Set(internalSelection.junctionIds);
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const movedDocument = structuredClone(document);
  for (const instance of movedDocument.instances) {
    if (!selected.has(instance.id) || !instance.placement) continue;
    const oriented = transform.placement(instance.placement);
    instance.placement = {
      ...instance.placement,
      position: transform.point(instance.placement.position),
      rotation: oriented.rotation,
      mirror: oriented.mirror,
    };
  }
  for (const junction of movedDocument.junctions) {
    if (turningJunctionIds.has(junction.id)) {
      junction.position = transform.point(junction.position);
    }
  }
  const smoothing: BoundarySmoothing = {
    movedDocument,
    movedBodies: movedInstanceBodies(movedDocument, resolver, selected),
  };

  const turns = (endpoint: RouteEndpoint): boolean =>
    (endpoint.kind === "terminal" && selected.has(endpoint.instanceId)) ||
    (endpoint.kind === "junction" &&
      turningJunctionIds.has(endpoint.junctionId));

  const proposals = new Map<string, RouteStretchProposal>();
  for (const route of document.routes) {
    const fromTurns = turns(route.start);
    const toTurns = turns(routeEnd(route));
    if (!fromTurns && !toTurns) continue;

    if (fromTurns && toTurns) {
      if (route.legs.some((leg) => leg.mode === "locked")) {
        throw new Error(`Route ${route.id} contains a locked segment`);
      }
      // Wholly inside: the Route is part of the body, so its own geometry
      // turns rather than being stretched between two moved ends.
      proposals.set(route.id, {
        routeId: route.id,
        waypoints: routeBends(route).map((point) => transform.point(point)),
        segmentModes: routeModes(route),
      });
      continue;
    }

    const original = routeEditPathFromGeometry(routingGeometry, route.id);
    if (!original) throw new Error(`Route ${route.id} has unresolved geometry`);
    const points = original.points.map((point) => ({ ...point }));
    const modes = [...original.segmentModes];
    if (fromTurns) {
      const from = original.points[0]!;
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "from",
        from,
        transform.point(from),
      );
    }
    if (toTurns) {
      const to = original.points.at(-1)!;
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "to",
        to,
        transform.point(to),
      );
    }
    proposals.set(
      route.id,
      smoothedBoundaryProposal(
        route,
        original.points.length - 2,
        normalizeProposal(route.id, points, modes),
        smoothing,
        resolver,
      ),
    );
  }

  const turnedObjectIds = new Set<string>([
    ...internalNetIds,
    ...internalSelection.routeIds,
    ...turningJunctionIds,
  ]);
  return {
    instances,
    pivot,
    routes: [...proposals.values()].sort((left, right) =>
      left.routeId.localeCompare(right.routeId, "en"),
    ),
    junctions: document.junctions
      .filter((junction) => turningJunctionIds.has(junction.id))
      .map((junction) => ({
        junctionId: junction.id,
        position: transform.point(junction.position),
      }))
      .sort((left, right) =>
        left.junctionId.localeCompare(right.junctionId, "en"),
      ),
    annotations: document.annotations
      .filter(
        (annotation) =>
          annotation.anchor.kind === "free" &&
          turnedObjectIds.has(annotation.netId ?? ""),
      )
      .map((annotation) => {
        const anchor = annotation.anchor;
        if (anchor.kind !== "free") {
          throw new Error("Free annotation filter lost anchor narrowing");
        }
        return {
          annotationId: annotation.id,
          anchor: {
            kind: "free" as const,
            position: transform.point(anchor.position),
          },
        };
      })
      .sort((left, right) =>
        left.annotationId.localeCompare(right.annotationId, "en"),
      ),
  };
}
