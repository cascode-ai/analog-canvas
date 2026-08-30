import {
  createRoutePath,
  deriveStableId,
  routeEnd,
  type Point,
  type RouteBranch,
  type RouteEndpoint,
  type SchematicDocument,
  type SegmentMode,
} from "@icm/model";
import {
  endpointKey,
  pointOnSegment,
  resolveDocumentRoutingGeometry,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import { normalizeRouteGeometry, strongerMode } from "./route-geometry-edit.js";
import { rebuildRoutePathWithRemap } from "./route-leg-mutation.js";
import {
  captureNetLabelRouteAnchors,
  captureRouteMarkerAnchors,
} from "./transaction-route-annotations.js";
import {
  remapNetLabelsAfterSplit,
  remapRouteMarkersAfterSplit,
} from "./transaction-route-annotation-follow.js";
import { retargetConnectivityEvidenceOwner } from "./transaction-connectivity.js";

const EPSILON = 1e-9;

interface AtomicEdge {
  key: string;
  from: Point;
  to: Point;
  mode: SegmentMode;
  sourceRouteIds: Set<string>;
}

interface Trace {
  key: string;
  points: Point[];
  modes: SegmentMode[];
  edgeKeys: string[];
  sourceRouteIds: Set<string>;
}

export interface ConductorTopologyNormalizationResult {
  changed: boolean;
  changedRouteIds: ReadonlySet<string>;
  changedObjectIds: ReadonlySet<string>;
}

/**
 * Resolve the Base Nets whose conductor geometry can have changed in one
 * transaction. Object identity, not an Edit-kind allow-list, is the contract:
 * new edit producers automatically participate when they report changed
 * Route/Junction/Net IDs or a transformed endpoint owner. A non-geometric
 * Instance property edit deliberately cannot pull its connected Net into the
 * normalization scope.
 */
export function affectedConductorNetIds(
  before: SchematicDocument,
  after: SchematicDocument,
  changedObjectIds: ReadonlySet<string>,
  changedRouteIds: ReadonlySet<string> = new Set(),
  changedEndpointOwnerIds: ReadonlySet<string> = new Set(),
): Set<string> {
  const changedIds = new Set([...changedObjectIds, ...changedRouteIds]);
  const changedJunctionIds = new Set(
    [before, after].flatMap((document) =>
      document.junctions.flatMap((junction) =>
        changedIds.has(junction.id) ? [junction.id] : [],
      ),
    ),
  );
  const netIds = new Set<string>();
  for (const document of [before, after]) {
    for (const net of document.nets) {
      if (
        changedIds.has(net.id) ||
        net.terminals.some((terminal) =>
          changedEndpointOwnerIds.has(terminal.instanceId),
        )
      ) {
        netIds.add(net.id);
      }
    }
    for (const junction of document.junctions) {
      if (changedJunctionIds.has(junction.id)) netIds.add(junction.netId);
    }
    for (const route of document.routes) {
      if (
        changedIds.has(route.id) ||
        [route.start, routeEnd(route)].some((endpoint) =>
          endpoint.kind === "terminal"
            ? changedEndpointOwnerIds.has(endpoint.instanceId)
            : changedJunctionIds.has(endpoint.junctionId),
        )
      ) {
        netIds.add(route.netId);
      }
    }
  }
  return netIds;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function parsePoint(key: string): Point {
  const [x, y] = key.split(",").map(Number);
  return { x: x!, y: y! };
}

function comparePoint(left: Point, right: Point): number {
  return left.x - right.x || left.y - right.y;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function endpointPairKey(left: Point, right: Point): string {
  return comparePoint(left, right) <= 0
    ? `${pointKey(left)}|${pointKey(right)}`
    : `${pointKey(right)}|${pointKey(left)}`;
}

function segmentParameter(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  return lengthSquared === 0
    ? 0
    : ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
}

function pointOnClosedSegment(point: Point, from: Point, to: Point): boolean {
  return pointOnSegment(point, from, to, { epsilon: EPSILON });
}

function collinearContinuation(
  point: Point,
  incident: readonly AtomicEdge[],
): boolean {
  if (incident.length !== 2) return false;
  const other = (edge: AtomicEdge) =>
    samePoint(edge.from, point) ? edge.to : edge.from;
  const first = other(incident[0]!);
  const second = other(incident[1]!);
  const firstVector = { x: first.x - point.x, y: first.y - point.y };
  const secondVector = { x: second.x - point.x, y: second.y - point.y };
  return (
    Math.abs(firstVector.x * secondVector.y - firstVector.y * secondVector.x) <=
      EPSILON &&
    firstVector.x * secondVector.x + firstVector.y * secondVector.y < 0
  );
}

function routePresentation(route: RouteBranch): string {
  return route.presentation ?? "wire";
}

function routeCanNormalize(route: RouteBranch): boolean {
  return (
    routePresentation(route) === "wire" &&
    !route.legs.some((leg) => leg.mode === "locked")
  );
}

function endpointAtRouteSide(
  route: RouteBranch,
  point: Point,
  routePoints: readonly Point[],
): RouteEndpoint | null {
  if (samePoint(point, routePoints[0]!)) return route.start;
  if (samePoint(point, routePoints.at(-1)!)) return routeEnd(route);
  return null;
}

function protectedObjectIds(document: SchematicDocument): Set<string> {
  return new Set([
    ...document.annotations.flatMap((annotation) =>
      annotation.anchor.kind === "object" ? [annotation.anchor.objectId] : [],
    ),
    ...document.layoutGroups.flatMap((group) => group.objectIds),
    ...document.constraints.flatMap((constraint) => constraint.objectIds),
  ]);
}

function allocateId(
  occupied: Set<string>,
  kind: "route" | "junction",
  ...parts: string[]
): string {
  let suffix = 0;
  for (;;) {
    const id = deriveStableId(
      kind === "route" ? "route-canonical" : "junction-canonical",
      ...parts,
      ...(suffix === 0 ? [] : [String(suffix)]),
    );
    if (!occupied.has(id)) {
      occupied.add(id);
      return id;
    }
    suffix += 1;
  }
}

function replaceReferences(
  objectIds: string[],
  routeProducts: ReadonlyMap<string, ReadonlySet<string>>,
  removedJunctionIds: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      objectIds.flatMap((objectId) => {
        const replacements = routeProducts.get(objectId);
        if (replacements) return [...replacements];
        return removedJunctionIds.has(objectId) ? [] : [objectId];
      }),
    ),
  ];
}

/**
 * Canonicalize ordinary same-Net conductor geometry.
 *
 * A Route is an authored path between electrical endpoints, not permanent
 * evidence that every historical split must survive. This pass unions
 * collinear coverage, materializes true branch vertices, and removes
 * unowned degree-two collinear Junctions. It never merges different Base Nets
 * and never touches power rails or locked geometry.
 */
export function normalizeSameNetConductorTopology(
  document: SchematicDocument,
  resolver: SymbolResolver,
  netIds?: ReadonlySet<string>,
  options: { preserveJunctionIds?: ReadonlySet<string> } = {},
): ConductorTopologyNormalizationResult {
  const changedRouteIds = new Set<string>();
  const changedObjectIds = new Set<string>();
  let changed = false;
  const occupiedIds = new Set([
    ...document.instances.map((instance) => instance.id),
    ...document.nets.map((net) => net.id),
    ...document.routes.map((route) => route.id),
    ...document.junctions.map((junction) => junction.id),
    ...document.annotations.map((annotation) => annotation.id),
    ...document.connectivityEvidence.map((evidence) => evidence.id),
  ]);
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);

  for (const net of [...document.nets].sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  )) {
    if (netIds && !netIds.has(net.id)) continue;
    const routes = document.routes
      .filter((route) => route.netId === net.id && routeCanNormalize(route))
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
    if (routes.length < 2) continue;

    const routePoints = new Map(
      routes.flatMap((route) => {
        const geometry = routingGeometry.routes.get(route.id);
        return geometry ? [[route.id, geometry.centerline] as const] : [];
      }),
    );
    if (routePoints.size !== routes.length) continue;

    const candidatePoints = new Map<string, Point>();
    for (const points of routePoints.values()) {
      for (const point of points) candidatePoints.set(pointKey(point), point);
    }

    const atomicEdges = new Map<string, AtomicEdge>();
    let duplicateCoverage = false;
    let introducedInteriorVertex = false;
    for (const route of routes) {
      const geometry = routingGeometry.routes.get(route.id)!;
      for (const segment of geometry.segments) {
        const breakpoints = [...candidatePoints.values()]
          .filter((point) =>
            pointOnClosedSegment(point, segment.from, segment.to),
          )
          .sort(
            (left, right) =>
              segmentParameter(left, segment.from, segment.to) -
              segmentParameter(right, segment.from, segment.to),
          );
        if (breakpoints.length > 2) introducedInteriorVertex = true;
        for (let index = 1; index < breakpoints.length; index += 1) {
          const from = breakpoints[index - 1]!;
          const to = breakpoints[index]!;
          if (samePoint(from, to)) continue;
          const key = endpointPairKey(from, to);
          const existing = atomicEdges.get(key);
          if (existing) {
            duplicateCoverage = true;
            existing.mode = strongerMode(existing.mode, segment.mode);
            existing.sourceRouteIds.add(route.id);
          } else {
            atomicEdges.set(key, {
              key,
              from: { ...from },
              to: { ...to },
              mode: segment.mode,
              sourceRouteIds: new Set([route.id]),
            });
          }
        }
      }
    }

    const incidentByPoint = new Map<string, AtomicEdge[]>();
    for (const edge of atomicEdges.values()) {
      for (const point of [edge.from, edge.to]) {
        const key = pointKey(point);
        const incident = incidentByPoint.get(key) ?? [];
        incident.push(edge);
        incidentByPoint.set(key, incident);
      }
    }

    const protectedIds = protectedObjectIds(document);
    const junctions = document.junctions.filter(
      (junction) => junction.netId === net.id,
    );
    const junctionsByPoint = new Map<string, typeof junctions>();
    for (const junction of junctions) {
      const key = pointKey(junction.position);
      const atPoint = junctionsByPoint.get(key) ?? [];
      atPoint.push(junction);
      junctionsByPoint.set(key, atPoint);
    }
    const collapsibleJunctionIds = new Set<string>();
    for (const junction of junctions) {
      if (
        (junction.role ?? "branch") !== "branch" ||
        protectedIds.has(junction.id) ||
        options.preserveJunctionIds?.has(junction.id)
      ) {
        continue;
      }
      const incident = incidentByPoint.get(pointKey(junction.position)) ?? [];
      if (collinearContinuation(junction.position, incident)) {
        collapsibleJunctionIds.add(junction.id);
      }
    }
    if (
      !duplicateCoverage &&
      !introducedInteriorVertex &&
      collapsibleJunctionIds.size === 0
    ) {
      continue;
    }

    const endpointsByPoint = new Map<string, RouteEndpoint[]>();
    for (const route of routes) {
      const points = routePoints.get(route.id)!;
      for (const point of [points[0]!, points.at(-1)!]) {
        const endpoint = endpointAtRouteSide(route, point, points);
        if (!endpoint) continue;
        const key = pointKey(point);
        const endpoints = endpointsByPoint.get(key) ?? [];
        if (
          !endpoints.some(
            (candidate) => endpointKey(candidate) === endpointKey(endpoint),
          )
        ) {
          endpoints.push(structuredClone(endpoint));
          endpointsByPoint.set(key, endpoints);
        }
      }
    }

    const anchors = new Set<string>();
    for (const [key, incident] of incidentByPoint) {
      const endpoints = endpointsByPoint.get(key) ?? [];
      const hasTerminal = endpoints.some(
        (endpoint) => endpoint.kind === "terminal",
      );
      const hasPreservedJunction = endpoints.some(
        (endpoint) =>
          endpoint.kind === "junction" &&
          !collapsibleJunctionIds.has(endpoint.junctionId),
      );
      if (incident.length !== 2 || hasTerminal || hasPreservedJunction) {
        anchors.add(key);
      }
    }

    const endpointForAnchor = new Map<string, RouteEndpoint>();
    const createdJunctionIds = new Set<string>();
    for (const key of [...anchors].sort()) {
      const endpoints = [...(endpointsByPoint.get(key) ?? [])].sort(
        (left, right) => {
          if (left.kind !== right.kind)
            return left.kind === "terminal" ? -1 : 1;
          return endpointKey(left).localeCompare(endpointKey(right), "en");
        },
      );
      const terminal = endpoints.find(
        (endpoint) => endpoint.kind === "terminal",
      );
      const preservedJunction = endpoints.find(
        (endpoint) =>
          endpoint.kind === "junction" &&
          !collapsibleJunctionIds.has(endpoint.junctionId),
      );
      const chosen = terminal ?? preservedJunction;
      if (chosen) {
        endpointForAnchor.set(key, structuredClone(chosen));
        continue;
      }
      const position = parsePoint(key);
      const junctionId = allocateId(
        occupiedIds,
        "junction",
        document.id,
        net.id,
        key,
      );
      document.junctions.push({
        id: junctionId,
        netId: net.id,
        position,
        role: "branch",
      });
      createdJunctionIds.add(junctionId);
      endpointForAnchor.set(key, { kind: "junction", junctionId });
      changedObjectIds.add(junctionId);
    }

    const traces: Trace[] = [];
    const usedEdges = new Set<string>();
    for (const startKey of [...anchors].sort()) {
      const startEdges = [...(incidentByPoint.get(startKey) ?? [])].sort(
        (left, right) => left.key.localeCompare(right.key, "en"),
      );
      for (const startEdge of startEdges) {
        if (usedEdges.has(startEdge.key)) continue;
        const points = [parsePoint(startKey)];
        const modes: SegmentMode[] = [];
        const edgeKeys: string[] = [];
        const sourceRouteIds = new Set<string>();
        let currentKey = startKey;
        let edge: AtomicEdge | undefined = startEdge;
        while (edge) {
          usedEdges.add(edge.key);
          edgeKeys.push(edge.key);
          modes.push(edge.mode);
          for (const routeId of edge.sourceRouteIds)
            sourceRouteIds.add(routeId);
          const fromKey = pointKey(edge.from);
          const nextPoint = fromKey === currentKey ? edge.to : edge.from;
          const nextKey = pointKey(nextPoint);
          points.push({ ...nextPoint });
          if (anchors.has(nextKey)) {
            const normalized = normalizeRouteGeometry(points, modes);
            traces.push({
              key: `${startKey}|${nextKey}|${traces.length}`,
              points: normalized.points,
              modes: normalized.segmentModes,
              edgeKeys,
              sourceRouteIds,
            });
            break;
          }
          const nextEdges = (incidentByPoint.get(nextKey) ?? []).filter(
            (candidate) => !usedEdges.has(candidate.key),
          );
          currentKey = nextKey;
          edge = nextEdges[0];
        }
      }
    }
    if (usedEdges.size !== atomicEdges.size || traces.length === 0) {
      // A detached closed loop has no stable Route endpoint representation.
      // Leave that Net untouched rather than manufacturing arbitrary anchors.
      document.junctions = document.junctions.filter(
        (junction) => !createdJunctionIds.has(junction.id),
      );
      for (const id of createdJunctionIds) changedObjectIds.delete(id);
      continue;
    }

    const sourceRoutes = new Map(routes.map((route) => [route.id, route]));
    const usedRouteIds = new Set<string>();
    const routeProducts = new Map<string, Set<string>>();
    const rebuiltRoutes: RouteBranch[] = [];
    for (const trace of traces.sort((left, right) =>
      left.key.localeCompare(right.key, "en"),
    )) {
      const rankedSources = [...trace.sourceRouteIds]
        .map((routeId) => ({
          routeId,
          count: trace.edgeKeys.filter((edgeKey) =>
            atomicEdges.get(edgeKey)?.sourceRouteIds.has(routeId),
          ).length,
        }))
        .sort(
          (left, right) =>
            right.count - left.count ||
            left.routeId.localeCompare(right.routeId, "en"),
        );
      const retainedSourceId = rankedSources.find(
        ({ routeId }) => !usedRouteIds.has(routeId),
      )?.routeId;
      const source = retainedSourceId
        ? sourceRoutes.get(retainedSourceId)
        : undefined;
      const start = endpointForAnchor.get(pointKey(trace.points[0]!));
      const end = endpointForAnchor.get(pointKey(trace.points.at(-1)!));
      if (!start || !end || endpointKey(start) === endpointKey(end)) continue;
      const routeId = source
        ? source.id
        : allocateId(
            occupiedIds,
            "route",
            document.id,
            net.id,
            pointKey(trace.points[0]!),
            pointKey(trace.points.at(-1)!),
          );
      const metadataSource =
        source ?? sourceRoutes.get([...trace.sourceRouteIds].sort()[0]!);
      if (!metadataSource) continue;
      const rebuilt = source
        ? rebuildRoutePathWithRemap(
            source,
            start,
            end,
            trace.points.slice(1, -1),
            trace.modes,
            `canonical-${document.revision}`,
          ).route
        : createRoutePath({
            id: routeId,
            netId: net.id,
            start,
            end,
            bends: trace.points.slice(1, -1),
            modes: trace.modes,
            ...(metadataSource.presentation
              ? { presentation: metadataSource.presentation }
              : {}),
            ...(metadataSource.styleOverride
              ? { styleOverride: structuredClone(metadataSource.styleOverride) }
              : {}),
          });
      rebuiltRoutes.push(rebuilt);
      usedRouteIds.add(routeId);
      for (const sourceRouteId of trace.sourceRouteIds) {
        const products = routeProducts.get(sourceRouteId) ?? new Set<string>();
        products.add(rebuilt.id);
        routeProducts.set(sourceRouteId, products);
      }
      changedRouteIds.add(rebuilt.id);
      changedObjectIds.add(rebuilt.id);
    }

    const oldRouteIds = new Set(routes.map((route) => route.id));
    const markerAnchors = captureRouteMarkerAnchors(
      document,
      resolver,
      oldRouteIds,
    );
    const labelAnchors = captureNetLabelRouteAnchors(
      document,
      resolver,
      oldRouteIds,
    );
    document.routes = [
      ...document.routes.filter((route) => !oldRouteIds.has(route.id)),
      ...rebuiltRoutes,
    ];
    const referencedJunctionIds = new Set(
      document.routes.flatMap((route) =>
        [route.start, routeEnd(route)].flatMap((endpoint) =>
          endpoint.kind === "junction" ? [endpoint.junctionId] : [],
        ),
      ),
    );
    const removedJunctionIds = new Set(
      junctions
        .filter(
          (junction) =>
            !referencedJunctionIds.has(junction.id) &&
            !protectedIds.has(junction.id),
        )
        .map((junction) => junction.id),
    );
    document.junctions = document.junctions.filter(
      (junction) => !removedJunctionIds.has(junction.id),
    );
    for (const routeId of oldRouteIds) {
      changedRouteIds.add(routeId);
      changedObjectIds.add(routeId);
    }
    for (const junctionId of removedJunctionIds) {
      changedObjectIds.add(junctionId);
    }

    const productIds = rebuiltRoutes.map((route) => route.id);
    remapRouteMarkersAfterSplit(
      document,
      resolver,
      markerAnchors,
      productIds,
      changedObjectIds,
    );
    remapNetLabelsAfterSplit(
      document,
      resolver,
      labelAnchors,
      productIds,
      changedObjectIds,
    );
    for (const [sourceRouteId, products] of routeProducts) {
      if (products.has(sourceRouteId)) continue;
      const replacementRouteId = [...products].sort((left, right) =>
        left.localeCompare(right, "en"),
      )[0];
      if (replacementRouteId) {
        retargetConnectivityEvidenceOwner(
          document,
          sourceRouteId,
          replacementRouteId,
          changedObjectIds,
        );
      }
    }
    for (const group of document.layoutGroups) {
      const next = replaceReferences(
        group.objectIds,
        routeProducts,
        removedJunctionIds,
      );
      if (next.join("\0") !== group.objectIds.join("\0")) {
        group.objectIds = next;
        changedObjectIds.add(group.id);
      }
    }
    for (const constraint of document.constraints) {
      const next = replaceReferences(
        constraint.objectIds,
        routeProducts,
        removedJunctionIds,
      );
      if (next.join("\0") !== constraint.objectIds.join("\0")) {
        constraint.objectIds = next;
        changedObjectIds.add(constraint.id);
      }
    }
    changed = true;
  }

  return { changed, changedRouteIds, changedObjectIds };
}
