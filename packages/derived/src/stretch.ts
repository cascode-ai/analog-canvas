import type { Point, RouteBranch, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { endpointKey, resolveEndpointPoint } from "./endpoint.js";
import {
  resolveDocumentRoutingGeometry,
  type ResolvedDocumentRoutingGeometry,
} from "./resolved-route-geometry.js";
import {
  isOrthogonal,
  moveRouteSegment,
  normalizeRouteGeometry,
} from "./routes.js";
import type { RoutePolyline, SegmentMode } from "./routes.js";

export interface RouteStretchProposal {
  routeId: string;
  waypoints: Point[];
  segmentModes: SegmentMode[];
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
 * The visually continuous subset of a VDD rail. A wire tap splits one stored
 * Route in two, but it must not turn the two resulting supply segments into
 * independent editor objects.
 */
export interface PowerRailComponent {
  routeIds: string[];
  junctionIds: string[];
  endpointJunctionIds: string[];
}

/**
 * Find the connected `power-rail` component containing `routeId`.
 *
 * Connectivity deliberately traverses only other power-rail fragments on the
 * same Net. Normal wires meeting a rail at a branch Junction remain branches,
 * rather than making every VDD conductor in the document one draggable rail.
 */
export function derivePowerRailComponent(
  document: SchematicDocument,
  routeId: string,
): PowerRailComponent | null {
  const seed = document.routes.find((route) => route.id === routeId);
  if (!seed || seed.presentation !== "power-rail") return null;
  const candidates = document.routes.filter(
    (route) =>
      route.netId === seed.netId && route.presentation === "power-rail",
  );
  const byJunction = new Map<string, typeof candidates>();
  for (const route of candidates) {
    for (const endpoint of [route.from, route.to]) {
      if (endpoint.kind !== "junction") continue;
      const incident = byJunction.get(endpoint.junctionId) ?? [];
      incident.push(route);
      byJunction.set(endpoint.junctionId, incident);
    }
  }

  const visited = new Set<string>([seed.id]);
  const queue = [seed];
  while (queue.length > 0) {
    const route = queue.shift()!;
    for (const endpoint of [route.from, route.to]) {
      if (endpoint.kind !== "junction") continue;
      for (const incident of byJunction.get(endpoint.junctionId) ?? []) {
        if (visited.has(incident.id)) continue;
        visited.add(incident.id);
        queue.push(incident);
      }
    }
  }

  const railRoutes = candidates.filter((route) => visited.has(route.id));
  const degreeByJunction = new Map<string, number>();
  for (const route of railRoutes) {
    for (const endpoint of [route.from, route.to]) {
      if (endpoint.kind !== "junction") continue;
      degreeByJunction.set(
        endpoint.junctionId,
        (degreeByJunction.get(endpoint.junctionId) ?? 0) + 1,
      );
    }
  }
  const order = (left: string, right: string) =>
    left.localeCompare(right, "en");
  const junctionIds = [...degreeByJunction.keys()].sort(order);
  return {
    routeIds: railRoutes.map((route) => route.id).sort(order),
    junctionIds,
    endpointJunctionIds: junctionIds
      .filter((junctionId) => degreeByJunction.get(junctionId) === 1)
      .sort(order),
  };
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

function protectedMode(mode: SegmentMode | undefined): boolean {
  return mode === "locked" || mode === "trunk";
}

function routePolylineFromGeometry(
  routingGeometry: ResolvedDocumentRoutingGeometry,
  routeId: string,
): RoutePolyline | null {
  const geometry = routingGeometry.routes.get(routeId);
  if (!geometry) return null;
  return {
    routeId: geometry.routeId,
    netId: geometry.netId,
    points: [...geometry.centerline],
    segmentModes: geometry.segments.map((segment) => segment.mode),
  };
}

function normalizeProposal(
  routeId: string,
  points: readonly Point[],
  modes: readonly SegmentMode[],
): RouteStretchProposal {
  const normalized = normalizeRouteGeometry(points, modes);
  if (!isOrthogonal(normalized.points)) {
    throw new Error(
      `Wire segment drag would make route ${routeId} non-orthogonal`,
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
  if (!originallyVertical && !originallyHorizontal) {
    throw new Error(`Route ${routeId} has invalid endpoint geometry`);
  }

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
  // A direct Route needs an orthogonal elbow when its Junction moves in both
  // axes. Re-inserting the old endpoint would create a diagonal segment.
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

    const polyline = routePolylineFromGeometry(routingGeometry, route.id);
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
  const selectedPolyline = routePolylineFromGeometry(routingGeometry, routeId);
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
  if (!horizontal && !vertical) {
    throw new Error(`Route ${routeId} segment is not orthogonal`);
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
    const polyline = routePolylineFromGeometry(routingGeometry, route.id);
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

  return {
    routes: [...proposals.values()].sort((leftProposal, rightProposal) =>
      leftProposal.routeId.localeCompare(rightProposal.routeId, "en"),
    ),
    junctions: [...movedJunctions.entries()]
      .map(([junctionId, position]) => ({ junctionId, position }))
      .sort((leftMove, rightMove) =>
        leftMove.junctionId.localeCompare(rightMove.junctionId, "en"),
      ),
  };
}

export interface InternalGroupSelection {
  netIds: string[];
  routeIds: string[];
  junctionIds: string[];
}

export function deriveInternalGroupSelection(
  document: SchematicDocument,
  instanceIds: readonly string[],
): InternalGroupSelection {
  const selectedIds = new Set(instanceIds);
  const netIds = document.nets
    .filter(
      (net) =>
        net.terminals.length > 0 &&
        net.terminals.every((terminal) => selectedIds.has(terminal.instanceId)),
    )
    .map((net) => net.id)
    .sort((left, right) => left.localeCompare(right, "en"));
  const internalRouteIds = new Set<string>();
  const internalJunctionIds = new Set<string>();
  const routesByNetId = new Map<string, RouteBranch[]>();
  for (const route of document.routes) {
    const netRoutes = routesByNetId.get(route.netId) ?? [];
    netRoutes.push(route);
    routesByNetId.set(route.netId, netRoutes);
  }

  for (const net of document.nets) {
    const netRoutes = [...(routesByNetId.get(net.id) ?? [])].sort(
      (left, right) => left.id.localeCompare(right.id, "en"),
    );
    const routesByEndpoint = new Map<string, typeof netRoutes>();
    for (const route of netRoutes) {
      for (const endpoint of [route.from, route.to]) {
        const key = endpointKey(endpoint);
        const incident = routesByEndpoint.get(key) ?? [];
        incident.push(route);
        routesByEndpoint.set(key, incident);
      }
    }

    const unvisited = new Set(netRoutes.map((route) => route.id));
    for (const seed of netRoutes) {
      if (!unvisited.has(seed.id)) continue;
      const component = [] as typeof netRoutes;
      const queue = [seed];
      unvisited.delete(seed.id);
      while (queue.length > 0) {
        const route = queue.shift()!;
        component.push(route);
        for (const endpoint of [route.from, route.to]) {
          for (const incident of routesByEndpoint.get(endpointKey(endpoint)) ??
            []) {
            if (!unvisited.delete(incident.id)) continue;
            queue.push(incident);
          }
        }
      }

      const componentEndpoints = new Map(
        component
          .flatMap((route) => [route.from, route.to])
          .map((endpoint) => [endpointKey(endpoint), endpoint] as const),
      );
      let hasSelectedTerminal = false;
      let crossesSelectionBoundary = false;
      for (const endpoint of componentEndpoints.values()) {
        if (endpoint.kind === "terminal") {
          if (selectedIds.has(endpoint.instanceId)) hasSelectedTerminal = true;
          else crossesSelectionBoundary = true;
        }
      }
      if (!hasSelectedTerminal || crossesSelectionBoundary) continue;

      for (const route of component) internalRouteIds.add(route.id);
      for (const endpoint of componentEndpoints.values()) {
        if (endpoint.kind === "junction") {
          internalJunctionIds.add(endpoint.junctionId);
        }
      }
    }
  }

  return {
    netIds,
    routeIds: [...internalRouteIds].sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
    junctionIds: [...internalJunctionIds].sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
  };
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
    const original = routePolylineFromGeometry(routingGeometry, route.id);
    const newFrom = resolveEndpointPoint(movedDocument, resolver, route.from);
    const newTo = resolveEndpointPoint(movedDocument, resolver, route.to);
    if (!original || !newFrom || !newTo) continue;
    const adjacentMode = movesFrom
      ? route.segmentModes[0]
      : route.segmentModes.at(-1);
    if (adjacentMode === "locked" || adjacentMode === "trunk") {
      throw new Error(`Route ${route.id} has a protected adjacent segment`);
    }
    const waypoints = route.waypoints.map((point) => ({ ...point }));
    let modes = [...route.segmentModes];
    if (waypoints.length === 0) {
      if (newFrom.x !== newTo.x && newFrom.y !== newTo.y) {
        waypoints.push({ x: newTo.x, y: newFrom.y });
        const mode = route.segmentModes[0] ?? "escape";
        modes = [mode, mode];
      }
    } else if (movesFrom) {
      const oldFrom = original.points[0]!;
      const first = waypoints[0]!;
      if (oldFrom.x === first.x) first.x = newFrom.x;
      else first.y = newFrom.y;
    } else if (movesTo) {
      const oldTo = original.points.at(-1)!;
      const last = waypoints.at(-1)!;
      if (oldTo.x === last.x) last.x = newTo.x;
      else last.y = newTo.y;
    }
    const normalized = normalizeRouteGeometry(
      [newFrom, ...waypoints, newTo],
      modes,
    );
    if (!isOrthogonal(normalized.points)) {
      throw new Error(
        `Local stretch would make route ${route.id} non-orthogonal`,
      );
    }
    proposals.push({
      routeId: route.id,
      waypoints: normalized.points.slice(1, -1),
      segmentModes: normalized.segmentModes,
    });
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
  const internalSelection = deriveInternalGroupSelection(document, [
    ...moveByInstance.keys(),
  ]);
  const internalNetIds = new Set(internalSelection.netIds);
  const movableJunctionIds = new Set(internalSelection.junctionIds);

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
    const instanceId =
      route.from.kind === "terminal" &&
      moveByInstance.has(route.from.instanceId)
        ? route.from.instanceId
        : route.to.kind === "terminal"
          ? route.to.instanceId
          : null;
    if (!instanceId) continue;
    const position = moveByInstance.get(instanceId)!;
    const local = proposeLocalStretch(document, resolver, instanceId, position);
    const proposal = local.find((candidate) => candidate.routeId === route.id);
    if (proposal) proposals.set(route.id, proposal);
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
