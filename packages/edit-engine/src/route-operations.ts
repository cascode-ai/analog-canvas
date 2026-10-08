// Route move proposals: the types every move planner returns, the smoothing
// a followed Route gets at the transaction boundary, Junction translation,
// a part's local stretch, and group translation.
import { stretchRouteEndpoint } from "./route-endpoint-stretch.js";
import type { TextAlignment } from "./annotation-reflection.js";
import {
  electricalConnectionGrid,
  routeBends,
  routeEnd,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  deriveInternalGroupSelection as deriveRoutingInternalGroupSelection,
  resolveDocumentRoutingGeometry,
  resolveEndpointConnection,
  resolveRouteGeometry,
  type ResolvedDocumentRoutingGeometry,
  type InternalGroupSelection,
} from "@icm/derived";
import {
  normalizeRouteGeometry,
  usablePinAxis,
  type PinAxis,
  type RouteEditPath,
  type SegmentMode,
} from "./route-geometry-edit.js";
import {
  assertPowerRailStaysStraight,
  carriedRouteProposal,
  collapsedDirectContact,
  normalizeProposal,
  protectedMode,
  routeEditPathFromGeometry,
  tidyDragProposal,
} from "./route-stretch-proposal.js";
import {
  movedInstanceBodies,
  smoothedBoundaryProposal,
  type BoundarySmoothing,
} from "./route-boundary-smoothing.js";

export interface RouteStretchProposal {
  routeId: string;
  waypoints: Point[];
  segmentModes: SegmentMode[];
  /** The endpoints now coincide: retain membership, remove redundant geometry. */
  collapsedToContact?: true;
}

/** Read-only source facts scoped to one immutable translation gesture. */
export interface RoutingTranslationSource {
  readonly document: SchematicDocument;
  readonly routingGeometry: ResolvedDocumentRoutingGeometry;
  readonly internalSelection: InternalGroupSelection;
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
  anchor: SchematicDocument["annotations"][number]["anchor"];
  /** A mirror reverses the side a start- or end-aligned label grows from. */
  alignment?: TextAlignment;
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
 * Apply the same boundary cleanup used by interactive move/turn planners to
 * a Route that followed instance placement edits at the transaction boundary.
 */
export function smoothRouteAfterInstanceTransform(
  originalDocument: SchematicDocument,
  movedDocument: SchematicDocument,
  resolver: SymbolResolver,
  movedInstanceIds: ReadonlySet<string>,
  route: SchematicDocument["routes"][number],
  originalBendCount: number,
  stretched: RouteStretchProposal,
  stretchedRawBendCount: number = stretched.waypoints.length,
): RouteStretchProposal {
  return smoothedBoundaryProposal(
    route,
    originalBendCount,
    stretched,
    {
      originalDocument,
      movedDocument,
      movedBodies: movedInstanceBodies(
        movedDocument,
        resolver,
        movedInstanceIds,
      ),
    },
    resolver,
    stretchedRawBendCount,
  );
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
  options: {
    preserveBranchDirections?: boolean;
    source?: RoutingTranslationSource;
  } = {},
): WireSegmentDragProposal {
  return tidyDragProposal(
    document,
    resolver,
    proposeJunctionTranslationGeometry(document, resolver, moves, options),
  );
}

function proposeJunctionTranslationGeometry(
  document: SchematicDocument,
  resolver: SymbolResolver,
  moves: readonly JunctionMoveProposal[],
  options: {
    preserveBranchDirections?: boolean;
    source?: RoutingTranslationSource;
  },
): WireSegmentDragProposal {
  const movedJunctions = new Map(
    moves.map((move) => [move.junctionId, move.position] as const),
  );
  for (const junctionId of movedJunctions.keys()) {
    if (!document.junctions.some((junction) => junction.id === junctionId)) {
      throw new Error(`Junction not found: ${junctionId}`);
    }
  }
  const routingGeometry =
    options.source?.document === document
      ? options.source.routingGeometry
      : resolveDocumentRoutingGeometry(document, resolver);
  const movedDocument = {
    ...document,
    junctions: document.junctions.map((junction) => ({
      ...junction,
      position: movedJunctions.get(junction.id) ?? junction.position,
    })),
  };
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
        options.preserveBranchDirections
          ? stretchedSegmentLeads(
              movedDocument,
              resolver,
              route,
              polyline.points,
              true,
            )
          : undefined,
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
        options.preserveBranchDirections
          ? stretchedSegmentLeads(
              movedDocument,
              resolver,
              route,
              polyline.points,
              true,
            )
          : undefined,
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

/** @internal Tests drive the endpoint stretch a part move uses. */
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
    originalDocument: document,
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
        normalizeRouteGeometry(points, modes).points.length - 2,
      ),
    );
  }
  return proposals.sort((left, right) =>
    left.routeId.localeCompare(right.routeId, "en"),
  );
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
  originalPoints: readonly Point[],
  preserveBranchDirections = false,
): { from: PinAxis; to: PinAxis; grid: number } | undefined {
  if (originalPoints.length !== 2) return undefined;
  const from = resolveEndpointConnection(movedDocument, resolver, route.start);
  const to = resolveEndpointConnection(
    movedDocument,
    resolver,
    routeEnd(route),
  );
  if (!from || !to) return undefined;
  // A Junction has no symbol lead, but its branch has an authored departure.
  // Losing that direction lets the stretched branch run back along the trunk;
  // conductor normalization then recreates the branch at its OLD position.
  const junctionAxis: PinAxis =
    originalPoints[0]!.x === originalPoints[1]!.x
      ? "vertical"
      : originalPoints[0]!.y === originalPoints[1]!.y
        ? "horizontal"
        : null;
  return {
    from:
      preserveBranchDirections && route.start.kind === "junction"
        ? junctionAxis
        : usablePinAxis(from.outward, from.contactPoint, to.contactPoint),
    to:
      preserveBranchDirections && routeEnd(route).kind === "junction"
        ? junctionAxis
        : usablePinAxis(to.outward, to.contactPoint, from.contactPoint),
    grid: [from.gridLanding, to.gridLanding].some(
      (point) =>
        point.x % movedDocument.presentation.grid !== 0 ||
        point.y % movedDocument.presentation.grid !== 0,
    )
      ? electricalConnectionGrid(movedDocument.presentation.grid)
      : movedDocument.presentation.grid,
  };
}

export function proposeGroupMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  moves: readonly InstanceMoveProposal[],
  additionalJunctionIds: readonly string[] = [],
  explicitDelta?: Point,
  source?: RoutingTranslationSource,
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
  const internalSelection =
    source?.document === document
      ? source.internalSelection
      : deriveRoutingInternalGroupSelection(document, [
          ...moveByInstance.keys(),
        ]);
  const internalNetIds = new Set(internalSelection.netIds);
  const movableJunctionIds = new Set(internalSelection.junctionIds);
  for (const junctionId of additionalJunctionIds) {
    if (document.junctions.some((junction) => junction.id === junctionId)) {
      movableJunctionIds.add(junctionId);
    }
  }
  const routingGeometry =
    source?.document === document
      ? source.routingGeometry
      : resolveDocumentRoutingGeometry(document, resolver);
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
    originalDocument: document,
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
      const contact = collapsedDirectContact(document, routingGeometry, route);
      if (contact) {
        proposals.set(route.id, contact);
        continue;
      }
      proposals.set(
        route.id,
        carriedRouteProposal(routingGeometry, route, (point) => ({
          x: point.x + resolvedFromDelta.x,
          y: point.y + resolvedFromDelta.y,
        })),
      );
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
      original.points,
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
    const stretchedProposal = smoothedBoundaryProposal(
      route,
      original.points.length - 2,
      normalizeProposal(route.id, points, modes),
      smoothing,
      resolver,
      normalizeRouteGeometry(points, modes).points.length - 2,
    );
    assertPowerRailStaysStraight(
      route,
      points[0]!,
      points.at(-1)!,
      stretchedProposal.waypoints,
    );
    proposals.set(route.id, stretchedProposal);
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
