import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  deriveInternalGroupSelection as deriveRoutingInternalGroupSelection,
  derivePowerRailComponent,
  isSegmentAllowed,
  polylineSatisfiesConstraint,
  resolveDocumentRoutingGeometry,
  resolveEndpointPoint,
  resolveRouteGeometry,
  type ResolvedDocumentRoutingGeometry,
} from "@icm/derived";
import {
  moveRouteSegment,
  normalizeRouteGeometry,
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
  endpoint: SchematicDocument["routes"][number]["from"],
): string | null {
  if (endpoint.kind !== "junction") return null;
  const junction = document.junctions.find(
    (candidate) => candidate.id === endpoint.junctionId,
  );
  if (!junction) return null;
  return junction.id;
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
      const value = route[side];
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
        const value = route[side];
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
    const insertIndex = side === "from" ? 1 : points.length - 1;
    points.splice(
      insertIndex,
      0,
      originallyVertical
        ? { x: neighbor.x, y: movedPoint.y }
        : { x: movedPoint.x, y: neighbor.y },
    );
    const modeIndex = side === "from" ? 0 : modes.length - 1;
    const mode = modes[modeIndex]!;
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
    const movedFrom =
      route.from.kind === "junction"
        ? movedJunctions.get(route.from.junctionId)
        : undefined;
    const movedTo =
      route.to.kind === "junction"
        ? movedJunctions.get(route.to.junctionId)
        : undefined;
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
        waypoints: route.waypoints.map((point) => ({
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
      return movableSegmentJunctionId(document, selectedRoute.from);
    }
    if (pointIndex === lastPointIndex) {
      return movableSegmentJunctionId(document, selectedRoute.to);
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
    const fromAnchor = movableSegmentJunctionId(document, route.from);
    const toAnchor = movableSegmentJunctionId(document, route.to);
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
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const proposals: RouteStretchProposal[] = [];

  for (const route of document.routes) {
    const movesFrom =
      route.from.kind === "terminal" && route.from.instanceId === instanceId;
    const movesTo =
      route.to.kind === "terminal" && route.to.instanceId === instanceId;
    if (!movesFrom && !movesTo) continue;
    const original = routeEditPathFromGeometry(routingGeometry, route.id);
    const newFrom = resolveEndpointPoint(movedDocument, resolver, route.from);
    const newTo = resolveEndpointPoint(movedDocument, resolver, route.to);
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
        newFrom,
      );
    }
    if (movesTo) {
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "to",
        original.points.at(-1)!,
        newTo,
      );
    }
    proposals.push(normalizeProposal(route.id, points, modes));
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

export function proposeGroupMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  moves: readonly InstanceMoveProposal[],
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
  const groupDelta = deltas[0] ?? { x: 0, y: 0 };
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
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);

  const proposals = new Map<string, RouteStretchProposal>();
  for (const route of document.routes) {
    const fromDelta =
      route.from.kind === "terminal"
        ? deltaByInstance.get(route.from.instanceId)
        : undefined;
    const toDelta =
      route.to.kind === "terminal"
        ? deltaByInstance.get(route.to.instanceId)
        : route.to.kind === "junction" &&
            movableJunctionIds.has(route.to.junctionId)
          ? groupDelta
          : undefined;
    const resolvedFromDelta =
      route.from.kind === "junction" &&
      movableJunctionIds.has(route.from.junctionId)
        ? groupDelta
        : fromDelta;
    if (!resolvedFromDelta && !toDelta) continue;

    if (
      resolvedFromDelta &&
      toDelta &&
      resolvedFromDelta.x === toDelta.x &&
      resolvedFromDelta.y === toDelta.y
    ) {
      if (route.segmentModes.includes("locked")) {
        throw new Error(`Route ${route.id} contains a locked segment`);
      }
      proposals.set(route.id, {
        routeId: route.id,
        waypoints: route.waypoints.map((point) => ({
          x: point.x + resolvedFromDelta.x,
          y: point.y + resolvedFromDelta.y,
        })),
        segmentModes: [...route.segmentModes],
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
    if (resolvedFromDelta) {
      const from = original.points[0]!;
      stretchRouteEndpoint(route.id, points, modes, "from", from, {
        x: from.x + resolvedFromDelta.x,
        y: from.y + resolvedFromDelta.y,
      });
    }
    if (toDelta) {
      const to = original.points.at(-1)!;
      stretchRouteEndpoint(route.id, points, modes, "to", to, {
        x: to.x + toDelta.x,
        y: to.y + toDelta.y,
      });
    }
    proposals.set(route.id, normalizeProposal(route.id, points, modes));
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
}

export interface GroupRotationProposal {
  instances: InstanceRotationProposal[];
  routes: RouteStretchProposal[];
  junctions: JunctionMoveProposal[];
  annotations: AnnotationMoveProposal[];
  pivot: Point;
}

/** Screen-space quarter turn: +90 turns clockwise, as SVG rotate() does. */
function turn(point: Point, pivot: Point, deltaDegrees: 90 | -90): Point {
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return deltaDegrees === 90
    ? { x: pivot.x - dy, y: pivot.y + dx }
    : { x: pivot.x + dy, y: pivot.y - dx };
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
  deltaDegrees: 90 | -90,
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
  const pivot = {
    x: snap((Math.min(...xs) + Math.max(...xs)) / 2),
    y: snap((Math.min(...ys) + Math.max(...ys)) / 2),
  };

  const instances = placed
    .map((instance): InstanceRotationProposal => {
      const placement = instance.placement!;
      return {
        instanceId: instance.id,
        position: turn(placement.position, pivot, deltaDegrees),
        rotation: ((((placement.rotation + deltaDegrees) % 360) + 360) %
          360) as 0 | 90 | 180 | 270,
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

  const turns = (
    endpoint: SchematicDocument["routes"][number]["from"],
  ): boolean =>
    (endpoint.kind === "terminal" && selected.has(endpoint.instanceId)) ||
    (endpoint.kind === "junction" &&
      turningJunctionIds.has(endpoint.junctionId));

  const proposals = new Map<string, RouteStretchProposal>();
  for (const route of document.routes) {
    const fromTurns = turns(route.from);
    const toTurns = turns(route.to);
    if (!fromTurns && !toTurns) continue;

    if (fromTurns && toTurns) {
      if (route.segmentModes.includes("locked")) {
        throw new Error(`Route ${route.id} contains a locked segment`);
      }
      // Wholly inside: the Route is part of the body, so its own geometry
      // turns rather than being stretched between two moved ends.
      proposals.set(route.id, {
        routeId: route.id,
        waypoints: route.waypoints.map((point) =>
          turn(point, pivot, deltaDegrees),
        ),
        segmentModes: [...route.segmentModes],
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
        turn(from, pivot, deltaDegrees),
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
        turn(to, pivot, deltaDegrees),
      );
    }
    proposals.set(route.id, normalizeProposal(route.id, points, modes));
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
        position: turn(junction.position, pivot, deltaDegrees),
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
            position: turn(anchor.position, pivot, deltaDegrees),
          },
        };
      })
      .sort((left, right) =>
        left.annotationId.localeCompare(right.annotationId, "en"),
      ),
  };
}
