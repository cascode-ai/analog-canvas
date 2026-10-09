// The primitive edits an authored wire commits as: one Route between two
// sources, a chain through every pin contact on its path, endpoints attached
// part-way along a Route, and the anchors a wire starts or ends at.
import {
  isMosBulkRoute,
  pointOnSegment,
  resolveRouteGeometry,
  segmentLength,
  type EndpointConnection,
} from "@icm/derived";
import type {
  Point,
  RouteEndpoint,
  RoutePresentation,
  SchematicDocument,
} from "@icm/model";
import { createRoutePath } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { SchematicEdit } from "./transaction.js";
import { splitRoutePieceIds } from "./split-route-ids.js";
import { routeTapLanding } from "./wire-intent-target.js";
import {
  compileWireDraft,
  type ManualWirePath,
  type WireDraftOptions,
  type WireEndpointGeometry,
} from "./wire-draft.js";

export interface WireSource extends WireEndpointGeometry {
  connection: EndpointConnection;
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
  const leg = route.legs[segmentIndex];
  if (!leg) throw new Error(`Route leg index is out of range: ${segmentIndex}`);
  const edits: SchematicEdit[] = [];
  if (endpointNetId && endpointNetId !== route.netId) {
    edits.push({
      kind: "merge_nets",
      targetNetId: route.netId,
      sourceNetId: endpointNetId,
    });
  }
  const pieces = splitRoutePieceIds(route.id, suffix);
  const routeIds = [pieces.firstRouteId, pieces.secondRouteId] as const;
  edits.push({
    kind: "attach_endpoint_to_route",
    endpoint,
    routeId: route.id,
    point,
    legId: leg.id,
    firstRouteId: routeIds[0],
    secondRouteId: routeIds[1],
  });
  return { netId: route.netId, routeIds, edits };
}

export interface EndpointRouteAttachmentRequest {
  endpoint: RouteEndpoint;
  endpointNetId: string | null;
  point: Point;
  segmentIndex: number;
}

export interface EndpointsRouteAttachmentProposal {
  netId: string;
  /** Final Route segments in start-to-end order after every attach. */
  routeIds: readonly string[];
  edits: SchematicEdit[];
}

/**
 * Attach several real endpoints to one Route in one transaction.
 *
 * The device-into-wire gesture lands more than one pin on the same conductor,
 * and each pin must become a real Route endpoint. Attaches are emitted
 * far-to-near along the Route: every attach splits the current start-side
 * piece, and the start side of a split retains its Route id and original leg
 * identity, so each later edit can address the leg it computed against the
 * original Route.
 */
export function proposeEndpointsRouteAttachment(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  requests: readonly EndpointRouteAttachmentRequest[],
  suffix: string,
): EndpointsRouteAttachmentProposal {
  if (requests.length === 0) {
    throw new Error("Route attachment requires at least one endpoint");
  }
  if (requests.length === 1) {
    const only = requests[0]!;
    return proposeEndpointRouteAttachment(
      document,
      only.endpoint,
      only.endpointNetId,
      routeId,
      only.point,
      only.segmentIndex,
      suffix,
    );
  }
  const route = document.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error(`Route not found: ${routeId}`);
  const centerline = resolveRouteGeometry(
    document,
    resolver,
    route,
  )?.centerline;
  if (!centerline) {
    throw new Error(`Route has an unresolved endpoint: ${routeId}`);
  }
  const ordered = requests
    .map((request) => {
      const leg = route.legs[request.segmentIndex];
      if (!leg) {
        throw new Error(
          `Route leg index is out of range: ${request.segmentIndex}`,
        );
      }
      const offset = pathOffsetAtPoint(centerline, request.point);
      if (offset === null) {
        throw new Error(`Attachment point is not on Route ${routeId}`);
      }
      return { request, legId: leg.id, offset };
    })
    .sort((left, right) => right.offset - left.offset);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.offset === ordered[index - 1]!.offset) {
      throw new Error("Two endpoints cannot attach at the same Route point");
    }
  }
  const edits: SchematicEdit[] = [];
  const mergedNetIds = new Set<string>();
  for (const { request } of ordered) {
    if (
      request.endpointNetId &&
      request.endpointNetId !== route.netId &&
      !mergedNetIds.has(request.endpointNetId)
    ) {
      mergedNetIds.add(request.endpointNetId);
      edits.push({
        kind: "merge_nets",
        targetNetId: route.netId,
        sourceNetId: request.endpointNetId,
      });
    }
  }
  let currentRouteId = route.id;
  const tailRouteIds: string[] = [];
  ordered.forEach((entry, index) => {
    const { firstRouteId, secondRouteId } = splitRoutePieceIds(
      route.id,
      `${suffix}-p${index + 1}`,
    );
    edits.push({
      kind: "attach_endpoint_to_route",
      endpoint: entry.request.endpoint,
      routeId: currentRouteId,
      point: entry.request.point,
      legId: entry.legId,
      firstRouteId,
      secondRouteId,
    });
    tailRouteIds.push(secondRouteId);
    currentRouteId = firstRouteId;
  });
  return {
    netId: route.netId,
    routeIds: [currentRouteId, ...tailRouteIds.reverse()],
    edits,
  };
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
  // Only an identity hint; the completed endpoint graph derives membership.
  const netId = from.netId ?? to.netId ?? ids.newNetId;
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
  // Direct contact has no path to persist and remains an explicit connection.
  if (routed.points.length < 2) {
    edits.push({
      kind: "connect_endpoints",
      from: from.endpoint,
      to: to.endpoint,
      ...(!from.netId && !to.netId ? { newNetId: netId } : {}),
    });
    return { routeId, netId, edits };
  }
  edits.push({
    kind: "set_route_path",
    route: createRoutePath({
      id: routeId,
      netId,
      start: from.endpoint,
      end: to.endpoint,
      bends: routed.waypoints,
      modes: routed.segmentModes,
      ...(presentation ? { presentation } : {}),
    }),
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
      const offset = pathOffsetAtPoint(
        path.points,
        source.connection.contactPoint,
      );
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
      edits.push({
        kind: "connect_endpoints",
        from: next.source.endpoint,
        to: extra.source.endpoint,
        newNetId: ids.newNetId,
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
    connection: {
      endpoint: { kind: "junction", junctionId },
      contactPoint: point,
      gridLanding: point,
      escapePath: [],
      outward: null,
    },
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
  ids: {
    junctionId: string;
    firstRouteId: string;
    secondRouteId: string;
  },
  resolver?: SymbolResolver,
): WireSource {
  const junctionId = ids.junctionId;
  const splitPoint = routeTapLanding(
    resolver
      ? resolveRouteGeometry(document, resolver, route)?.segments[segmentIndex]
      : undefined,
    point,
    grid,
  );
  return {
    endpoint: { kind: "junction", junctionId },
    netId: route.netId,
    connection: {
      endpoint: { kind: "junction", junctionId },
      contactPoint: splitPoint,
      gridLanding: splitPoint,
      escapePath: [],
      outward: null,
    },
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
          legId: route.legs[segmentIndex]!.id,
        },
      },
    ],
  };
}
