import {
  derivePowerRailComponent,
  normalizeRouteGeometry,
  proposeGroupMove,
  proposeJunctionGroupTranslation,
  proposeWireSegmentDrag,
  resolveEndpointPoint,
  type SegmentMode,
} from "@icm/derived";
import type {
  Point,
  RouteEndpoint,
  RoutePresentation,
  SchematicDocument,
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
}

export interface VisualRouteDeletion {
  routeIds: string[];
  junctionIds: string[];
  /** Annotations removed as an inseparable part of the selected visual route. */
  annotationIds: string[];
  edits: SchematicEdit[];
}

export interface WireManipulationProposal {
  routeId: string;
  edits: SchematicEdit[];
}

export interface GroupMoveEditProposal {
  edits: SchematicEdit[];
}

/** Plan instance-group movement and all internal route/Junction/label follow edits. */
export function proposeGroupMoveEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  moves: readonly { instanceId: string; position: Point }[],
): GroupMoveEditProposal {
  const proposal = proposeGroupMove(document, resolver, moves);
  return {
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
): WireManipulationProposal {
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
): WireManipulationProposal {
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
): WireManipulationProposal {
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

/** Resize the left or right visual end of a continuous horizontal VDD rail. */
export function proposePowerRailEndpointResize(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  side: "start" | "end",
  x: number,
): WireManipulationProposal {
  const component = derivePowerRailComponent(document, routeId);
  if (!component || component.endpointJunctionIds.length !== 2) {
    throw new Error("VDD rail must have exactly two editable ends");
  }
  const endpoints = component.endpointJunctionIds
    .map((junctionId) =>
      document.junctions.find((junction) => junction.id === junctionId)!,
    )
    .sort((left, right) => left.position.x - right.position.x);
  const start = endpoints[0]!;
  const end = endpoints[1]!;
  const target = side === "start" ? start : end;
  const fixed = side === "start" ? end : start;
  if (
    (side === "start" && x >= fixed.position.x) ||
    (side === "end" && x <= fixed.position.x)
  ) {
    throw new Error("VDD rail must retain a non-zero horizontal length");
  }
  const proposal = proposeJunctionGroupTranslation(document, resolver, [
    {
      junctionId: target.id,
      position: { x, y: target.position.y },
    },
  ]);
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
            routesToRemove.has(route.id) &&
            route.presentation === "bulk-dashed",
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
        route.presentation === "bulk-dashed" &&
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
    .map((annotation) => annotation.id)
    .sort((a, b) => a.localeCompare(b, "en"));
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
            routesToRemove.has(route.id) &&
            route.presentation === "bulk-dashed",
        )
        .flatMap((route) => [route.from, route.to])
        .filter(
          (
            endpoint,
          ): endpoint is Extract<RouteEndpoint, { kind: "terminal" }> =>
            endpoint.kind === "terminal" && endpoint.pinName === "B",
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
    annotationIds: removedPowerLabelIds,
    edits: [
      ...removedPowerLabelIds.map((annotationId): SchematicEdit => ({
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
): void {
  const last = points.at(-1)!;
  if (samePoint(last, target)) return;
  if (last.x !== target.x && last.y !== target.y) {
    const previous = points.at(-2);
    append(
      points,
      modes,
      previous
        ? previous.y === last.y
          ? { x: target.x, y: last.y }
          : { x: last.x, y: target.y }
        : { x: target.x, y: last.y },
      mode,
    );
  }
  append(points, modes, target, mode);
}

/** Build a persisted manual orthogonal path without hidden terminal escapes. */
export function buildManualWirePath(
  from: WireEndpointGeometry,
  to: WireEndpointGeometry,
  manualWaypoints: readonly Point[] = [],
): ManualWirePath {
  const points: Point[] = [{ ...from.point }];
  const modes: SegmentMode[] = [];
  for (const waypoint of manualWaypoints) {
    appendOrthogonal(points, modes, waypoint, "manual");
  }
  appendOrthogonal(points, modes, to.point, "manual");
  if (points.length === 1) return { points, waypoints: [], segmentModes: [] };
  const normalized = normalizeRouteGeometry(points, modes);
  return {
    points: normalized.points,
    waypoints: normalized.points.slice(1, -1),
    segmentModes: normalized.segmentModes,
  };
}

export function proposeWireCommit(
  from: WireSource,
  to: WireSource,
  manualWaypoints: readonly Point[],
  suffixOrIds: number | { routeId: string; newNetId: string },
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
  const routed = buildManualWirePath(from, to, manualWaypoints);
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
    const horizontal = from.y === to.y;
    const vertical = from.x === to.x;
    const onSegment = horizontal
      ? point.y === from.y &&
        point.x >= Math.min(from.x, to.x) &&
        point.x <= Math.max(from.x, to.x)
      : vertical
        ? point.x === from.x &&
          point.y >= Math.min(from.y, to.y) &&
          point.y <= Math.max(from.y, to.y)
        : false;
    if (onSegment) {
      return offset + Math.abs(point.x - from.x) + Math.abs(point.y - from.y);
    }
    offset += Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
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
    offset += Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
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
): WireCommitProposal {
  const path = buildManualWirePath(from, to, manualWaypoints);
  const endpointInstanceIds = new Set(
    [terminalInstanceId(from), terminalInstanceId(to)].filter(
      (instanceId): instanceId is string => instanceId !== null,
    ),
  );
  const totalOffset = path.points.slice(0, -1).reduce((total, point, index) => {
    const next = path.points[index + 1]!;
    return total + Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
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
    return proposeWireCommit(from, to, manualWaypoints, suffixOrIds);
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
    ...(route.presentation && route.presentation !== "power-rail"
      ? { routePresentation: route.presentation }
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
  return proposeWireCommit(from, to, intent.waypoints ?? [], {
    routeId: `${intent.id}-route`,
    newNetId,
  });
}
