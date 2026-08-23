import {
  derivePowerRailComponent,
  isMosBulkRoute,
  isMosBulkTerminal,
  pointOnSegment,
  resolveEndpointPoint,
  segmentLength,
} from "@icm/derived";
import {
  normalizeRouteGeometry,
  type SegmentMode,
} from "./route-geometry-edit.js";
import {
  proposeGroupMove,
  proposeGroupReflection,
  proposeGroupRotation,
  type GroupRotationProposal,
  proposeJunctionGroupTranslation,
  proposeWireSegmentDrag,
  type JunctionMoveProposal,
  type RouteStretchProposal,
} from "./route-operations.js";
import type {
  Point,
  RouteEndpoint,
  RoutePresentation,
  SchematicDocument,
  ScreenFlip,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./transaction.js";

export interface WireEndpointGeometry {
  point: Point;
}

export interface ManualWirePath {
  points: Point[];
  waypoints: Point[];
  segmentModes: SegmentMode[];
}

/** A transient command constraint, never a second persisted Route type. */
export type WireRoutingMode = "orthogonal" | "octilinear" | "free";
/**
 * Which leg of a corner is drawn first. `diagonal-first`/`orthogonal-first`
 * order an octilinear corner; `horizontal-first`/`vertical-first` order an
 * orthogonal one. `auto` keeps the incoming segment's direction, which is the
 * behavior every existing draft relies on.
 */
export type WireCornerOrder =
  | "auto"
  | "diagonal-first"
  | "orthogonal-first"
  | "horizontal-first"
  | "vertical-first";

/** One authored click. The compiler may insert an unpersisted elbow. */
export interface WireDraftStep {
  point: Point;
  routingMode: WireRoutingMode;
  cornerOrder?: WireCornerOrder;
}

export interface WireDraftOptions {
  steps?: readonly WireDraftStep[];
  routingMode?: WireRoutingMode;
  cornerOrder?: WireCornerOrder;
}

export interface WireSource extends WireEndpointGeometry {
  endpoint: RouteEndpoint;
  netId: string | null;
  preludeEdits: SchematicEdit[];
  routePresentation?: RoutePresentation;
}

export interface WireCommitProposal {
  routeId: string;
  netId: string;
  edits: SchematicEdit[];
}

export interface EndpointRouteAttachmentProposal {
  netId: string;
  routeIds: readonly [string, string];
  edits: SchematicEdit[];
}

/**
 * Make a real endpoint the common node of two Route halves. This is the one
 * topology primitive used when a placed or moved pin lands on a conductor;
 * no coincident decorative Junction or zero-length Route is introduced.
 */
export function proposeEndpointRouteAttachment(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
  endpointNetId: string | null,
  routeId: string,
  point: Point,
  segmentIndex: number,
  suffix: string,
): EndpointRouteAttachmentProposal {
  const route = document.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error(`Route not found: ${routeId}`);
  const edits: SchematicEdit[] = [];
  if (endpointNetId && endpointNetId !== route.netId) {
    edits.push({
      kind: "merge_nets",
      targetNetId: route.netId,
      sourceNetId: endpointNetId,
    });
  }
  const routeIds = [
    `${route.id}-a-${suffix}`,
    `${route.id}-b-${suffix}`,
  ] as const;
  edits.push({
    kind: "attach_endpoint_to_route",
    endpoint,
    routeId: route.id,
    point,
    segmentIndex,
    firstRouteId: routeIds[0],
    secondRouteId: routeIds[1],
  });
  return { netId: route.netId, routeIds, edits };
}

export type WireIntentAnchor =
  | { kind: "endpoint"; endpoint: RouteEndpoint }
  | {
      kind: "route-segment";
      routeId: string;
      segmentIndex: number;
      point: Point;
    }
  | { kind: "free"; point: Point };

export interface WireIntent {
  id: string;
  from: WireIntentAnchor;
  to: WireIntentAnchor;
  waypoints?: readonly Point[] | undefined;
  routingMode?: WireRoutingMode | undefined;
  cornerOrder?: WireCornerOrder | undefined;
}

export interface VisualRouteDeletion {
  routeIds: string[];
  junctionIds: string[];
  /** Annotations removed as an inseparable part of the selected visual route. */
  annotationIds: string[];
  edits: SchematicEdit[];
}

/** The exact edit payload and preview produced by one routed interaction. */
export interface RouteEditPlan {
  routeId: string;
  edits: SchematicEdit[];
  preview?: {
    routes: readonly RouteStretchProposal[];
    junctions: readonly JunctionMoveProposal[];
  };
}

export interface GroupMoveEditProposal {
  edits: SchematicEdit[];
  preview: {
    routes: readonly RouteStretchProposal[];
    junctions: readonly JunctionMoveProposal[];
  };
}

/** Plan instance-group movement and all internal route/Junction/label follow edits. */
export function proposeGroupMoveEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  moves: readonly { instanceId: string; position: Point }[],
): GroupMoveEditProposal {
  const proposal = proposeGroupMove(document, resolver, moves);
  return {
    preview: {
      routes: proposal.routes,
      junctions: proposal.junctions,
    },
    edits: [
      ...moves.map((move): SchematicEdit => ({
        kind: "move_instance",
        ...move,
      })),
      ...proposal.junctions.map((move): SchematicEdit => ({
        kind: "move_junction",
        ...move,
      })),
      // A group plan is the sole geometry authority. Emitting every planned
      // Route prevents move_instance from progressively re-stretching an
      // internal wire once per selected Instance, which otherwise makes a
      // group translation depend on transaction edit order.
      ...routeEdits(document, proposal.routes),
      ...proposal.annotations.flatMap((move): SchematicEdit[] => {
        const annotation = document.annotations.find(
          (candidate) => candidate.id === move.annotationId,
        );
        return annotation
          ? [
              {
                kind: "upsert_schematic_annotation",
                annotation: { ...annotation, anchor: move.anchor },
              },
            ]
          : [];
      }),
    ],
  };
}

/**
 * Typed edits that turn a selection as one rigid body.
 *
 * Instance rotation and translation travel together: a member both spins in
 * place and orbits the shared pivot, and the plan supplies every affected
 * Route so geometry does not depend on transaction edit order.
 */
/** Typed edits that reflect a selection as one rigid body. */
export function proposeGroupReflectionEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  direction: ScreenFlip,
): GroupMoveEditProposal {
  return rigidBodyEdits(
    document,
    proposeGroupReflection(document, resolver, instanceIds, direction),
  );
}

export function proposeGroupRotationEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  deltaDegrees: 90 | -90,
): GroupMoveEditProposal {
  return rigidBodyEdits(
    document,
    proposeGroupRotation(document, resolver, instanceIds, deltaDegrees),
  );
}

/**
 * Typed edits for a rigid-body move of a selection.
 *
 * Orientation and position travel together — a part both turns or flips and
 * carries to its new place — and the plan supplies every affected Route so
 * geometry does not depend on transaction edit order.
 */
function rigidBodyEdits(
  document: SchematicDocument,
  proposal: GroupRotationProposal,
): GroupMoveEditProposal {
  return {
    preview: {
      routes: proposal.routes,
      junctions: proposal.junctions,
    },
    edits: [
      ...proposal.instances.flatMap((moved): SchematicEdit[] => [
        {
          kind: "mirror_instance",
          instanceId: moved.instanceId,
          mirror: moved.mirror,
        },
        {
          kind: "rotate_instance",
          instanceId: moved.instanceId,
          rotation: moved.rotation,
        },
        {
          kind: "move_instance",
          instanceId: moved.instanceId,
          position: moved.position,
        },
      ]),
      ...proposal.junctions.map((move): SchematicEdit => ({
        kind: "move_junction",
        ...move,
      })),
      ...routeEdits(document, proposal.routes),
      ...proposal.annotations.flatMap((move): SchematicEdit[] => {
        const annotation = document.annotations.find(
          (candidate) => candidate.id === move.annotationId,
        );
        return annotation
          ? [
              {
                kind: "upsert_schematic_annotation",
                annotation: { ...annotation, anchor: move.anchor },
              },
            ]
          : [];
      }),
    ],
  };
}

function routeEdits(
  document: SchematicDocument,
  routes: readonly {
    routeId: string;
    waypoints: Point[];
    segmentModes: SegmentMode[];
  }[],
): SchematicEdit[] {
  return routes.map((proposal) => {
    const route = document.routes.find(
      (candidate) => candidate.id === proposal.routeId,
    );
    if (!route) throw new Error(`Route not found: ${proposal.routeId}`);
    return {
      kind: "set_route_points" as const,
      routeId: route.id,
      netId: route.netId,
      from: route.from,
      to: route.to,
      waypoints: proposal.waypoints,
      segmentModes: proposal.segmentModes,
      ...(route.presentation ? { presentation: route.presentation } : {}),
    };
  });
}

/** Plan one topology-preserving segment drag as typed transaction edits. */
export function proposeWireSegmentMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  segmentIndex: number,
  target: Point,
): RouteEditPlan {
  const proposal = proposeWireSegmentDrag(
    document,
    resolver,
    routeId,
    segmentIndex,
    target,
  );
  return {
    routeId,
    edits: [
      ...proposal.junctions.map((move): SchematicEdit => ({
        kind: "move_junction",
        ...move,
      })),
      ...routeEdits(document, proposal.routes),
    ],
    preview: proposal,
  };
}

function looseRouteAnchorIds(
  document: SchematicDocument,
  route: SchematicDocument["routes"][number],
): [string, string] | null {
  if (
    route.from.kind !== "junction" ||
    route.to.kind !== "junction" ||
    route.from.junctionId === route.to.junctionId
  ) {
    return null;
  }
  const isLoose = (junctionId: string) => {
    const junction = document.junctions.find(
      (candidate) => candidate.id === junctionId,
    );
    if (!junction) return false;
    const degree = document.routes.filter(
      (candidate) =>
        (candidate.from.kind === "junction" &&
          candidate.from.junctionId === junctionId) ||
        (candidate.to.kind === "junction" &&
          candidate.to.junctionId === junctionId),
    ).length;
    return (
      junction.role === "route-anchor" ||
      ((junction.role ?? "branch") === "branch" && degree === 1)
    );
  };
  return isLoose(route.from.junctionId) && isLoose(route.to.junctionId)
    ? [route.from.junctionId, route.to.junctionId]
    : null;
}

/** Plan translation of an isolated loose route and its two endpoint anchors. */
export function proposeLooseRouteTranslation(
  document: SchematicDocument,
  routeId: string,
  delta: Point,
): RouteEditPlan {
  const route = document.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error(`Route not found: ${routeId}`);
  const anchors = looseRouteAnchorIds(document, route);
  if (!anchors) {
    throw new Error("Only a route with two loose ends can move as a whole");
  }
  if (delta.x === 0 && delta.y === 0) return { routeId, edits: [] };
  const anchorEdits = anchors.map((junctionId): SchematicEdit => {
    const junction = document.junctions.find(
      (candidate) => candidate.id === junctionId,
    )!;
    return {
      kind: "move_junction",
      junctionId,
      position: {
        x: junction.position.x + delta.x,
        y: junction.position.y + delta.y,
      },
    };
  });
  return {
    routeId,
    edits: [
      ...anchorEdits,
      {
        kind: "set_route_points",
        routeId: route.id,
        netId: route.netId,
        from: route.from,
        to: route.to,
        waypoints: route.waypoints.map((point) => ({
          x: point.x + delta.x,
          y: point.y + delta.y,
        })),
        segmentModes: [...route.segmentModes],
        ...(route.presentation ? { presentation: route.presentation } : {}),
      },
    ],
  };
}

/**
 * Translate every fragment and Junction belonging to one visually continuous
 * VDD rail. Ordinary branch wires are not translated wholesale: they are
 * reshaped around the moved rail Junction instead.
 */
export function proposePowerRailTranslation(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  delta: Point,
): RouteEditPlan {
  const component = derivePowerRailComponent(document, routeId);
  if (!component) {
    throw new Error(`Route ${routeId} is not a power rail`);
  }
  if (delta.x === 0 && delta.y === 0) return { routeId, edits: [] };
  const proposal = proposeJunctionGroupTranslation(
    document,
    resolver,
    component.junctionIds.map((junctionId) => {
      const junction = document.junctions.find(
        (candidate) => candidate.id === junctionId,
      )!;
      return {
        junctionId,
        position: {
          x: junction.position.x + delta.x,
          y: junction.position.y + delta.y,
        },
      };
    }),
  );
  return {
    routeId,
    edits: [
      ...proposal.junctions.map((move): SchematicEdit => ({
        kind: "move_junction",
        ...move,
      })),
      ...routeEdits(document, proposal.routes),
    ],
  };
}

/** Resize the leading or trailing visual end of one straight Power Rail. */
export function proposePowerRailEndpointResize(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  side: "start" | "end",
  point: Point,
): RouteEditPlan {
  const component = derivePowerRailComponent(document, routeId);
  if (!component || component.endpointJunctionIds.length !== 2) {
    throw new Error("Power rail must have exactly two editable ends");
  }
  const endpoints = component.endpointJunctionIds.map((junctionId) =>
    document.junctions.find((junction) => junction.id === junctionId)!,
  );
  const horizontal =
    endpoints[0]!.position.y === endpoints[1]!.position.y &&
    endpoints[0]!.position.x !== endpoints[1]!.position.x;
  const vertical =
    endpoints[0]!.position.x === endpoints[1]!.position.x &&
    endpoints[0]!.position.y !== endpoints[1]!.position.y;
  if (!horizontal && !vertical) {
    throw new Error("Power rail must be straight and axis-aligned");
  }
  endpoints.sort((left, right) =>
    horizontal
      ? left.position.x - right.position.x
      : left.position.y - right.position.y,
  );
  const start = endpoints[0]!;
  const end = endpoints[1]!;
  const target = side === "start" ? start : end;
  const fixed = side === "start" ? end : start;
  const coordinate = horizontal ? point.x : point.y;
  const fixedCoordinate = horizontal ? fixed.position.x : fixed.position.y;
  if (
    (side === "start" && coordinate >= fixedCoordinate) ||
    (side === "end" && coordinate <= fixedCoordinate)
  ) {
    throw new Error("Power rail must retain a non-zero length");
  }
  const proposal = proposeJunctionGroupTranslation(document, resolver, [
    {
      junctionId: target.id,
      position: horizontal
        ? { x: coordinate, y: target.position.y }
        : { x: target.position.x, y: coordinate },
    },
  ]);
  return {
    routeId,
    preview: {
      routes: proposal.routes,
      junctions: proposal.junctions,
    },
    edits: [
      ...proposal.junctions.map((move): SchematicEdit => ({
        kind: "move_junction",
        ...move,
      })),
      ...routeEdits(document, proposal.routes),
    ],
  };
}

/**
 * Collect the closure for deleting visual route geometry. Ordinary Wire
 * deletion deliberately preserves Net membership. A `bulk-dashed` route is
 * different: it is the visible representation of an explicit MOS B binding,
 * so deleting the terminal-touching route also disconnects B and restores the
 * configured/default bulk policy. Keeping that exception here makes button,
 * keyboard, marquee, and Agent-facing deletion paths share one contract.
 */
export function proposeVisualRouteDeletion(
  document: SchematicDocument,
  routeIds: readonly string[],
  junctionIds: readonly string[],
): VisualRouteDeletion {
  const routesToRemove = new Set(routeIds);
  const junctionsToRemove = new Set(junctionIds);
  let changed = true;
  while (changed) {
    changed = false;
    const bulkJunctions = new Set(
      document.routes
        .filter(
          (route) =>
            routesToRemove.has(route.id) && isMosBulkRoute(document, route),
        )
        .flatMap((route) => [route.from, route.to])
        .filter(
          (
            endpoint,
          ): endpoint is Extract<RouteEndpoint, { kind: "junction" }> =>
            endpoint.kind === "junction",
        )
        .map((endpoint) => endpoint.junctionId),
    );
    for (const route of document.routes) {
      if (
        isMosBulkRoute(document, route) &&
        !routesToRemove.has(route.id) &&
        [route.from, route.to].some(
          (endpoint) =>
            endpoint.kind === "junction" &&
            bulkJunctions.has(endpoint.junctionId),
        )
      ) {
        routesToRemove.add(route.id);
        changed = true;
      }
    }
    for (const route of document.routes) {
      const touchesDeletedJunction =
        (route.from.kind === "junction" &&
          junctionsToRemove.has(route.from.junctionId)) ||
        (route.to.kind === "junction" &&
          junctionsToRemove.has(route.to.junctionId));
      if (touchesDeletedJunction && !routesToRemove.has(route.id)) {
        routesToRemove.add(route.id);
        changed = true;
      }
    }
    for (const junction of document.junctions) {
      if (junctionsToRemove.has(junction.id)) continue;
      const attachedRoutes = document.routes.filter(
        (route) =>
          (route.from.kind === "junction" &&
            route.from.junctionId === junction.id) ||
          (route.to.kind === "junction" && route.to.junctionId === junction.id),
      );
      if (
        attachedRoutes.length > 0 &&
        attachedRoutes.every((route) => routesToRemove.has(route.id))
      ) {
        junctionsToRemove.add(junction.id);
        changed = true;
      }
    }
  }
  const sortedRouteIds = [...routesToRemove].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const sortedJunctionIds = [...junctionsToRemove].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const removedRouteAnnotationIds = document.annotations
    .filter(
      (annotation) =>
        annotation.anchor.kind === "route" &&
        routesToRemove.has(annotation.anchor.routeId),
    )
    .map((annotation) => annotation.id);
  const removedPowerLabelIds = document.annotations
    .filter(
      (annotation) =>
        annotation.kind === "power-label" &&
        annotation.anchor.kind === "object" &&
        sortedJunctionIds.includes(annotation.anchor.objectId) &&
        document.routes.some(
          (route) =>
            routesToRemove.has(route.id) &&
            route.presentation === "power-rail" &&
            route.netId === annotation.netId,
        ),
    )
    .map((annotation) => annotation.id);
  const removedAnnotationIds = [
    ...new Set([...removedRouteAnnotationIds, ...removedPowerLabelIds]),
  ].sort((a, b) => a.localeCompare(b, "en"));
  // `cut_connection` removes a junction that becomes orphaned. Only a selected
  // junction already detached before this transaction needs an explicit edit;
  // otherwise a second remove would reject the transaction.
  const alreadyOrphanedJunctionIds = sortedJunctionIds.filter(
    (junctionId) =>
      !document.routes.some(
        (route) =>
          (route.from.kind === "junction" &&
            route.from.junctionId === junctionId) ||
          (route.to.kind === "junction" && route.to.junctionId === junctionId),
      ),
  );
  const disconnectedBulkInstances = [
    ...new Set(
      document.routes
        .filter(
          (route) =>
            routesToRemove.has(route.id) && isMosBulkRoute(document, route),
        )
        .flatMap((route) => [route.from, route.to])
        .filter(
          (
            endpoint,
          ): endpoint is Extract<RouteEndpoint, { kind: "terminal" }> =>
            isMosBulkTerminal(document, endpoint),
        )
        .filter(
          (endpoint) =>
            !document.routes.some(
              (route) =>
                !routesToRemove.has(route.id) &&
                [route.from, route.to].some(
                  (candidate) =>
                    candidate.kind === "terminal" &&
                    candidate.instanceId === endpoint.instanceId &&
                    candidate.pinName === "B",
                ),
            ),
        )
        .map((endpoint) => endpoint.instanceId),
    ),
  ].sort((a, b) => a.localeCompare(b, "en"));
  return {
    routeIds: sortedRouteIds,
    junctionIds: sortedJunctionIds,
    annotationIds: removedAnnotationIds,
    edits: [
      ...removedAnnotationIds.map((annotationId): SchematicEdit => ({
        kind: "remove_schematic_annotation",
        annotationId,
      })),
      ...sortedRouteIds.map((routeId): SchematicEdit => ({
        kind: "cut_connection",
        routeId,
      })),
      ...alreadyOrphanedJunctionIds.map((junctionId): SchematicEdit => ({
        kind: "remove_junction",
        junctionId,
      })),
      ...disconnectedBulkInstances.flatMap((instanceId): SchematicEdit[] => [
        {
          kind: "disconnect_endpoint",
          endpoint: { kind: "terminal", instanceId, pinName: "B" },
        },
        { kind: "reconcile_mos_bulk", instanceIds: [instanceId] },
      ]),
    ],
  };
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function append(
  points: Point[],
  modes: SegmentMode[],
  point: Point,
  mode: SegmentMode,
): void {
  if (samePoint(points.at(-1)!, point)) return;
  points.push({ ...point });
  modes.push(mode);
}

function appendOrthogonal(
  points: Point[],
  modes: SegmentMode[],
  target: Point,
  mode: SegmentMode,
  cornerOrder: WireCornerOrder = "auto",
): void {
  const last = points.at(-1)!;
  if (samePoint(last, target)) return;
  if (last.x !== target.x && last.y !== target.y) {
    const previous = points.at(-2);
    // An explicit axis wins; otherwise the corner carries the incoming
    // segment's direction through before it turns.
    const horizontalFirst =
      cornerOrder === "horizontal-first"
        ? true
        : cornerOrder === "vertical-first"
          ? false
          : previous
            ? previous.y === last.y
            : true;
    append(
      points,
      modes,
      horizontalFirst ? { x: target.x, y: last.y } : { x: last.x, y: target.y },
      mode,
    );
  }
  append(points, modes, target, mode);
}

function appendOctilinear(
  points: Point[],
  modes: SegmentMode[],
  target: Point,
  mode: SegmentMode,
  cornerOrder: WireCornerOrder,
): void {
  const last = points.at(-1)!;
  if (samePoint(last, target)) return;
  const dx = target.x - last.x;
  const dy = target.y - last.y;
  if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) {
    append(points, modes, target, mode);
    return;
  }
  const diagonalDistance = Math.min(Math.abs(dx), Math.abs(dy));
  const diagonal = {
    x: last.x + Math.sign(dx) * diagonalDistance,
    y: last.y + Math.sign(dy) * diagonalDistance,
  };
  const useDiagonalFirst = cornerOrder !== "orthogonal-first";
  if (useDiagonalFirst) {
    append(points, modes, diagonal, mode);
  } else if (Math.abs(dx) > Math.abs(dy)) {
    append(
      points,
      modes,
      { x: target.x - Math.sign(dx) * diagonalDistance, y: last.y },
      mode,
    );
  } else {
    append(
      points,
      modes,
      { x: last.x, y: target.y - Math.sign(dy) * diagonalDistance },
      mode,
    );
  }
  append(points, modes, target, mode);
}

/**
 * Compile authored wire clicks to ordinary persisted Route geometry.  A mode
 * applies only to the leg being authored; prior compiled legs are immutable.
 */
export function compileWireDraft(
  from: WireEndpointGeometry,
  to: WireEndpointGeometry,
  steps: readonly WireDraftStep[] = [],
  finalRoutingMode: WireRoutingMode = "orthogonal",
  finalCornerOrder: WireCornerOrder = "auto",
): ManualWirePath {
  const points: Point[] = [{ ...from.point }];
  const modes: SegmentMode[] = [];
  const appendStep = (step: WireDraftStep) => {
    // A free leg is the straight line to the click: no elbow is inserted, so
    // the wire lands at whatever angle reaches the endpoint.
    if (step.routingMode === "free") {
      append(points, modes, step.point, "manual");
      return;
    }
    if (step.routingMode === "orthogonal") {
      appendOrthogonal(
        points,
        modes,
        step.point,
        "manual",
        step.cornerOrder ?? "auto",
      );
    } else {
      appendOctilinear(
        points,
        modes,
        step.point,
        "manual",
        step.cornerOrder ?? "auto",
      );
    }
  };
  for (const step of steps) appendStep(step);
  appendStep({
    point: to.point,
    routingMode: finalRoutingMode,
    cornerOrder: finalCornerOrder,
  });
  if (points.length === 1) return { points, waypoints: [], segmentModes: [] };
  const normalized = normalizeRouteGeometry(points, modes);
  return {
    points: normalized.points,
    waypoints: normalized.points.slice(1, -1),
    segmentModes: normalized.segmentModes,
  };
}

/** Build a persisted manual orthogonal path without hidden terminal escapes. */
export function buildManualWirePath(
  from: WireEndpointGeometry,
  to: WireEndpointGeometry,
  manualWaypoints: readonly Point[] = [],
): ManualWirePath {
  return compileWireDraft(
    from,
    to,
    manualWaypoints.map((point) => ({ point, routingMode: "orthogonal" })),
  );
}

export function proposeWireCommit(
  from: WireSource,
  to: WireSource,
  manualWaypoints: readonly Point[],
  suffixOrIds: number | { routeId: string; newNetId: string },
  draft: WireDraftOptions = {},
): WireCommitProposal {
  const ids =
    typeof suffixOrIds === "number"
      ? {
          routeId: `route-ui-${suffixOrIds}`,
          newNetId: `net-ui-${suffixOrIds}`,
        }
      : suffixOrIds;
  const edits: SchematicEdit[] = [...from.preludeEdits, ...to.preludeEdits];
  const presentation =
    from.routePresentation === "bulk-dashed" ||
    to.routePresentation === "bulk-dashed"
      ? "bulk-dashed"
      : from.routePresentation === "power-rail" ||
          to.routePresentation === "power-rail"
        ? "power-rail"
        : undefined;
  let netId = from.netId ?? to.netId;
  if (from.netId && to.netId && from.netId !== to.netId) {
    netId = from.netId;
    edits.push({
      kind: "merge_nets",
      targetNetId: from.netId,
      sourceNetId: to.netId,
    });
  }
  if (!netId) netId = ids.newNetId;
  edits.push({
    kind: "connect_endpoints",
    from: from.endpoint,
    to: to.endpoint,
    ...(!from.netId && !to.netId ? { newNetId: netId } : {}),
  });
  const routeId = ids.routeId;
  const routed = compileWireDraft(
    from,
    to,
    draft.steps ??
      manualWaypoints.map((point) => ({
        point,
        routingMode: draft.routingMode ?? "orthogonal",
        ...(draft.cornerOrder ? { cornerOrder: draft.cornerOrder } : {}),
      })),
    draft.routingMode ?? "orthogonal",
    draft.cornerOrder ?? "auto",
  );
  edits.push({
    kind: "set_route_points",
    routeId,
    netId,
    from: from.endpoint,
    to: to.endpoint,
    waypoints: routed.waypoints,
    segmentModes: routed.segmentModes,
    ...(presentation ? { presentation } : {}),
  });
  return { routeId, netId, edits };
}

function sameEndpoint(left: RouteEndpoint, right: RouteEndpoint): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "terminal":
      return (
        right.kind === "terminal" &&
        left.instanceId === right.instanceId &&
        left.pinName === right.pinName
      );
    case "junction":
      return right.kind === "junction" && left.junctionId === right.junctionId;
  }
}

function endpointSortKey(endpoint: RouteEndpoint): string {
  switch (endpoint.kind) {
    case "terminal":
      return `terminal:${endpoint.instanceId}:${endpoint.pinName}`;
    case "junction":
      return `junction:${endpoint.junctionId}`;
  }
}

function pathOffsetAtPoint(
  points: readonly Point[],
  point: Point,
): number | null {
  let offset = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    if (pointOnSegment(point, from, to)) {
      return offset + segmentLength(from, point);
    }
    offset += segmentLength(from, to);
  }
  return null;
}

function waypointsBetweenOffsets(
  path: ManualWirePath,
  fromOffset: number,
  toOffset: number,
): Point[] {
  const result: Point[] = [];
  let offset = 0;
  for (let index = 0; index < path.points.length - 1; index += 1) {
    const from = path.points[index]!;
    const to = path.points[index + 1]!;
    offset += segmentLength(from, to);
    if (offset > fromOffset && offset < toOffset) result.push({ ...to });
  }
  return result;
}

interface OrderedWireContact {
  source: WireSource;
  offset: number;
}

function terminalInstanceId(source: WireSource): string | null {
  return source.endpoint.kind === "terminal"
    ? source.endpoint.instanceId
    : null;
}

/**
 * Author one wire through every exact visible pin contact in one transaction.
 *
 * The wire gesture is the connection intent: each interior contact becomes a
 * real route endpoint, and any Net already owned by that pin is merged through
 * the ordinary typed edit. Merely crossing a symbol body or passing near a pin
 * never reaches this planner because callers supply resolved visible pins.
 */
export function proposeWireCommitThroughContacts(
  from: WireSource,
  to: WireSource,
  manualWaypoints: readonly Point[],
  contacts: readonly WireSource[],
  suffixOrIds: number | { routeId: string; newNetId: string },
  draft: WireDraftOptions = {},
): WireCommitProposal {
  const path = compileWireDraft(
    from,
    to,
    draft.steps ??
      manualWaypoints.map((point) => ({
        point,
        routingMode: draft.routingMode ?? "orthogonal",
        ...(draft.cornerOrder ? { cornerOrder: draft.cornerOrder } : {}),
      })),
    draft.routingMode ?? "orthogonal",
    draft.cornerOrder ?? "auto",
  );
  const endpointInstanceIds = new Set(
    [terminalInstanceId(from), terminalInstanceId(to)].filter(
      (instanceId): instanceId is string => instanceId !== null,
    ),
  );
  const totalOffset = path.points.slice(0, -1).reduce((total, point, index) => {
    const next = path.points[index + 1]!;
    return total + segmentLength(point, next);
  }, 0);
  const ordered = contacts
    .flatMap((source): OrderedWireContact[] => {
      if (
        sameEndpoint(source.endpoint, from.endpoint) ||
        sameEndpoint(source.endpoint, to.endpoint) ||
        (source.endpoint.kind === "terminal" &&
          endpointInstanceIds.has(source.endpoint.instanceId))
      ) {
        return [];
      }
      const offset = pathOffsetAtPoint(path.points, source.point);
      return offset !== null && offset > 0 && offset < totalOffset
        ? [{ source, offset }]
        : [];
    })
    .filter(
      (contact, index, all) =>
        all.findIndex((candidate) =>
          sameEndpoint(candidate.source.endpoint, contact.source.endpoint),
        ) === index,
    )
    .sort(
      (left, right) =>
        left.offset - right.offset ||
        endpointSortKey(left.source.endpoint).localeCompare(
          endpointSortKey(right.source.endpoint),
          "en",
        ),
    );
  if (ordered.length === 0) {
    return proposeWireCommit(from, to, manualWaypoints, suffixOrIds, draft);
  }

  const ids =
    typeof suffixOrIds === "number"
      ? {
          routeId: `route-ui-${suffixOrIds}`,
          newNetId: `net-ui-${suffixOrIds}`,
        }
      : suffixOrIds;
  const groups = ordered.reduce<OrderedWireContact[][]>((result, contact) => {
    const current = result.at(-1);
    if (current?.[0]?.offset === contact.offset) current.push(contact);
    else result.push([contact]);
    return result;
  }, []);
  const presentation = from.routePresentation ?? to.routePresentation;
  const nodes = [
    { source: from, offset: 0, extras: [] as OrderedWireContact[] },
    ...groups.map((group) => ({
      source: {
        ...group[0]!.source,
        ...(presentation ? { routePresentation: presentation } : {}),
      },
      offset: group[0]!.offset,
      extras: group.slice(1),
    })),
    { source: to, offset: totalOffset, extras: [] as OrderedWireContact[] },
  ];
  const edits: SchematicEdit[] = [];
  let netId: string | null = from.netId;
  const routeIds: string[] = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const current = nodes[index]!;
    const next = nodes[index + 1]!;
    const currentSource =
      index === 0
        ? current.source
        : { ...current.source, netId, preludeEdits: [] };
    const proposal = proposeWireCommit(
      currentSource,
      next.source,
      waypointsBetweenOffsets(path, current.offset, next.offset),
      {
        routeId: `${ids.routeId}-part-${index + 1}`,
        newNetId: ids.newNetId,
      },
      { routingMode: "octilinear" },
    );
    edits.push(...proposal.edits);
    netId = proposal.netId;
    routeIds.push(proposal.routeId);

    for (const extra of next.extras) {
      edits.push(...extra.source.preludeEdits);
      if (extra.source.netId && extra.source.netId !== netId) {
        edits.push({
          kind: "merge_nets",
          targetNetId: netId,
          sourceNetId: extra.source.netId,
        });
      }
      edits.push({
        kind: "connect_endpoints",
        from: next.source.endpoint,
        to: extra.source.endpoint,
      });
    }
  }
  return { routeId: routeIds[0]!, netId: netId!, edits };
}

export function createFreeWireAnchor(
  point: Point,
  netId: string,
  createNet: boolean,
  suffixOrJunctionId: number | string,
): WireSource {
  const junctionId =
    typeof suffixOrJunctionId === "number"
      ? `junction-ui-${suffixOrJunctionId}`
      : suffixOrJunctionId;
  return {
    endpoint: { kind: "junction", junctionId },
    netId,
    point,
    preludeEdits: [
      {
        kind: "add_junction",
        junctionId,
        netId,
        position: point,
        role: "route-anchor",
        ...(createNet ? { createNet: true } : {}),
      },
    ],
  };
}

export function createRouteWireAnchor(
  document: SchematicDocument,
  route: SchematicDocument["routes"][number],
  point: Point,
  segmentIndex: number,
  grid: number,
  suffixOrIds:
    | number
    | {
        junctionId: string;
        firstRouteId: string;
        secondRouteId: string;
      },
): WireSource {
  const ids =
    typeof suffixOrIds === "number"
      ? {
          junctionId: `junction-ui-${suffixOrIds}`,
          firstRouteId: `${route.id}-a-${suffixOrIds}`,
          secondRouteId: `${route.id}-b-${suffixOrIds}`,
        }
      : suffixOrIds;
  const junctionId = ids.junctionId;
  const splitPoint = {
    x: Math.round(point.x / grid) * grid,
    y: Math.round(point.y / grid) * grid,
  };
  return {
    endpoint: { kind: "junction", junctionId },
    netId: route.netId,
    point: splitPoint,
    ...(isMosBulkRoute(document, route)
      ? { routePresentation: "bulk-dashed" as const }
      : {}),
    preludeEdits: [
      {
        kind: "add_junction",
        junctionId,
        netId: route.netId,
        position: splitPoint,
        split: {
          routeId: route.id,
          firstRouteId: ids.firstRouteId,
          secondRouteId: ids.secondRouteId,
          segmentIndex,
        },
      },
    ],
  };
}

function endpointNetId(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
): string | null {
  switch (endpoint.kind) {
    case "terminal":
      return (
        document.nets.find((net) =>
          net.terminals.some(
            (terminal) =>
              terminal.instanceId === endpoint.instanceId &&
              terminal.pinName === endpoint.pinName,
          ),
        )?.id ?? null
      );
    case "junction":
      return (
        document.junctions.find(
          (junction) => junction.id === endpoint.junctionId,
        )?.netId ?? null
      );
  }
}

function endpointWireSource(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoint: RouteEndpoint,
): WireSource | string {
  const point = resolveEndpointPoint(document, resolver, endpoint);
  if (!point) return `Wire endpoint is unresolved: ${JSON.stringify(endpoint)}`;
  return {
    endpoint,
    point,
    netId: endpointNetId(document, endpoint),
    preludeEdits: [],
  };
}

/**
 * Expand one ordinary Wire gesture into the same primitive edit sequence used
 * by the GUI. Agent transports call this planner instead of rebuilding Net,
 * route-split, and Junction choreography.
 */
export function proposeWireIntent(
  document: SchematicDocument,
  resolver: SymbolResolver,
  intent: WireIntent,
): WireCommitProposal | string {
  const routeFor = (
    anchor: Extract<WireIntentAnchor, { kind: "route-segment" }>,
  ) => document.routes.find((route) => route.id === anchor.routeId);
  const existingNetId = [intent.from, intent.to]
    .flatMap((anchor) => {
      if (anchor.kind === "route-segment")
        return [routeFor(anchor)?.netId ?? null];
      if (anchor.kind === "endpoint")
        return [endpointNetId(document, anchor.endpoint)];
      return [null];
    })
    .find((netId): netId is string => netId !== null);
  const newNetId = `${intent.id}-net`;
  let freeAnchorCreatedNet = false;
  const source = (
    anchor: WireIntentAnchor,
    side: "from" | "to",
  ): WireSource | string => {
    if (anchor.kind === "endpoint") {
      return endpointWireSource(document, resolver, anchor.endpoint);
    }
    if (anchor.kind === "route-segment") {
      const route = routeFor(anchor);
      if (!route) return `Wire route does not exist: ${anchor.routeId}`;
      return createRouteWireAnchor(
        document,
        route,
        anchor.point,
        anchor.segmentIndex,
        document.presentation.grid,
        {
          junctionId: `${intent.id}-${side}-junction`,
          firstRouteId: `${route.id}-a-${intent.id}-${side}`,
          secondRouteId: `${route.id}-b-${intent.id}-${side}`,
        },
      );
    }
    const netId = existingNetId ?? newNetId;
    const createNet = existingNetId === undefined && !freeAnchorCreatedNet;
    if (createNet) freeAnchorCreatedNet = true;
    return createFreeWireAnchor(
      anchor.point,
      netId,
      createNet,
      `${intent.id}-${side}-junction`,
    );
  };
  const from = source(intent.from, "from");
  if (typeof from === "string") return from;
  const to = source(intent.to, "to");
  if (typeof to === "string") return to;
  return proposeWireCommit(
    from,
    to,
    intent.waypoints ?? [],
    {
      routeId: `${intent.id}-route`,
      newNetId,
    },
    {
      ...(intent.routingMode ? { routingMode: intent.routingMode } : {}),
      ...(intent.cornerOrder ? { cornerOrder: intent.cornerOrder } : {}),
    },
  );
}
