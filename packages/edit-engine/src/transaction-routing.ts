import type {
  Annotation,
  Point,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import {
  derivePowerRailComponent,
  endpointBelongsToNet,
  polylineSatisfiesConstraint,
  endpointKey,
  netEndpoints,
  pointOnSegment as pointOnGenericSegment,
  resolveDocumentLogicalNets,
  resolveEndpointOutwardDirection,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";
import { resolveRouteEditPath } from "./route-operations.js";

export function pointOnSegment(point: Point, from: Point, to: Point): boolean {
  return pointOnGenericSegment(point, from, to, { interior: true });
}

export function routeIsProtected(route: RouteBranch): boolean {
  return route.segmentModes.includes("locked");
}

export function endpointOwnerNetId(
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

export function netEndpointGroups(
  document: SchematicDocument,
  netId: string,
): string[][] {
  const net = document.nets.find((candidate) => candidate.id === netId);
  if (!net) return [];
  const keys = netEndpoints(document, net).map(endpointKey);
  const parent = new Map(keys.map((key) => [key, key]));
  const find = (key: string): string => {
    const current = parent.get(key);
    if (!current) throw new Error(`Unknown Net endpoint ${key}`);
    if (current === key) return key;
    const root = find(current);
    parent.set(key, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const [first, second] = [leftRoot, rightRoot].sort((a, b) =>
      a.localeCompare(b, "en"),
    );
    parent.set(second!, first!);
  };
  for (const route of document.routes.filter(
    (candidate) => candidate.netId === netId,
  )) {
    union(endpointKey(route.from), endpointKey(route.to));
  }
  const grouped = new Map<string, string[]>();
  for (const key of keys) {
    const root = find(key);
    const group = grouped.get(root) ?? [];
    group.push(key);
    grouped.set(root, group);
  }
  return [...grouped.values()]
    .map((group) =>
      group.sort((left, right) => left.localeCompare(right, "en")),
    )
    .sort((left, right) => left[0]!.localeCompare(right[0]!, "en"));
}

export function validateConnectableEndpoint(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
  resolver: SymbolResolver | undefined,
): string | null {
  switch (endpoint.kind) {
    case "terminal": {
      const instance = document.instances.find(
        (candidate) => candidate.id === endpoint.instanceId,
      );
      if (!instance) return `Instance does not exist: ${endpoint.instanceId}`;
      if (!resolver) return "Terminal edits require a Symbol Resolver";
      const symbol = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      if (
        !symbol?.definition.pins.some((pin) => pin.name === endpoint.pinName)
      ) {
        return `Symbol pin does not exist: ${endpoint.instanceId}.${endpoint.pinName}`;
      }
      return null;
    }
    case "junction":
      return document.junctions.some(
        (junction) => junction.id === endpoint.junctionId,
      )
        ? null
        : `Junction does not exist: ${endpoint.junctionId}`;
  }
}

export function validateNetLabelBinding(
  document: SchematicDocument,
  annotation: Annotation,
): string | null {
  if (annotation.kind !== "net-label") return null;
  if (!annotation.netId) {
    return `Net Label requires a Net identity: ${annotation.id}`;
  }
  return document.nets.some((net) => net.id === annotation.netId)
    ? null
    : `Net Label identity is not a Net: ${annotation.netId}`;
}

export function addEndpointToNet(
  document: SchematicDocument,
  netId: string,
  endpoint: RouteEndpoint,
): void {
  const net = document.nets.find((candidate) => candidate.id === netId)!;
  if (endpoint.kind === "terminal") {
    if (
      !net.terminals.some(
        (terminal) =>
          terminal.instanceId === endpoint.instanceId &&
          terminal.pinName === endpoint.pinName,
      )
    ) {
      net.terminals.push({
        instanceId: endpoint.instanceId,
        pinName: endpoint.pinName,
      });
    }
  }
}

export function replaceLayoutReference(
  objectIds: string[],
  sourceId: string,
  targetId: string,
): string[] {
  return [...new Set(objectIds.map((id) => (id === sourceId ? targetId : id)))];
}

export function lockedLayoutOwner(
  document: SchematicDocument,
  objectId: string,
): string | null {
  return (
    [...document.layoutGroups, ...document.constraints].find(
      (item) => item.locked && item.objectIds.includes(objectId),
    )?.id ?? null
  );
}

export function routeFromEdit(
  edit: Extract<SchematicEdit, { kind: "set_route_points" }>,
): RouteBranch {
  return {
    id: edit.routeId,
    netId: edit.netId,
    from: structuredClone(edit.from),
    to: structuredClone(edit.to),
    waypoints: structuredClone(edit.waypoints),
    segmentModes: [...edit.segmentModes],
    ...(edit.presentation ? { presentation: edit.presentation } : {}),
  };
}

export function validateRoute(
  document: SchematicDocument,
  route: RouteBranch,
  resolver: SymbolResolver,
): string | null {
  if (route.segmentModes.length !== route.waypoints.length + 1) {
    return `Route ${route.id} requires one segment mode per geometric segment`;
  }
  const net = document.nets.find((candidate) => candidate.id === route.netId);
  if (!net) return `Route net does not exist: ${route.netId}`;
  if (
    route.presentation === "power-rail" &&
    !resolveDocumentLogicalNets(document).byBaseNetId.get(net.id)?.name
  ) {
    return `Power rail ${route.id} must belong to a named Net`;
  }
  if (!endpointBelongsToNet(document, net, route.from)) {
    return `Route from endpoint is not a member of ${route.netId}`;
  }
  if (!endpointBelongsToNet(document, net, route.to)) {
    return `Route to endpoint is not a member of ${route.netId}`;
  }
  const polyline = resolveRouteEditPath(document, resolver, route);
  if (!polyline) return `Route ${route.id} has an unresolved endpoint`;
  // Segment heading is geometry, not topology (ADR 0028), and ADR 0039 grants
  // the arbitrary-angle policy that ADR 0028 anticipated. Validation therefore
  // rejects only degenerate geometry; which headings a command may author is
  // the edit engine's transient policy, not a rule about legal Routes.
  if (!polylineSatisfiesConstraint(polyline.points, "any-angle")) {
    return `Route ${route.id} must contain only non-zero segments`;
  }
  if (
    route.presentation === "power-rail" &&
    !(
      polyline.points
        .slice(1)
        .every(
          (point, index) =>
            polyline.points[index]!.y === point.y &&
            polyline.points[index]!.x !== point.x,
        ) ||
      polyline.points
        .slice(1)
        .every(
          (point, index) =>
            polyline.points[index]!.x === point.x &&
            polyline.points[index]!.y !== point.y,
        )
    )
  ) {
    return `Power rail ${route.id} must be straight and axis-aligned`;
  }
  if (route.presentation === "power-rail") {
    // A rail is one straight conductor, so the whole connected run has to be
    // collinear — not merely each stored Route. Without this, extending a
    // rail perpendicular to itself produced a bent rail out of two
    // individually straight halves.
    const component = derivePowerRailComponent(document, route.id);
    const positions = (component?.junctionIds ?? []).flatMap((junctionId) => {
      const junction = document.junctions.find(
        (candidate) => candidate.id === junctionId,
      );
      return junction ? [junction.position] : [];
    });
    if (
      positions.length > 2 &&
      !positions.every((position) => position.y === positions[0]!.y) &&
      !positions.every((position) => position.x === positions[0]!.x)
    ) {
      return `Power rail ${route.id} must stay one straight run without a bend`;
    }
  }
  for (const [endpoint, point, adjacent, mode] of [
    [
      route.from,
      polyline.points[0]!,
      polyline.points[1]!,
      route.segmentModes[0],
    ],
    [
      route.to,
      polyline.points.at(-1)!,
      polyline.points.at(-2)!,
      route.segmentModes.at(-1),
    ],
  ] as const) {
    if (endpoint.kind !== "terminal" || mode !== "escape") continue;
    const outward = resolveEndpointOutwardDirection(
      document,
      resolver,
      endpoint,
    );
    if (!outward) return `Route ${route.id} has an unresolved pin direction`;
    const departure = { x: adjacent.x - point.x, y: adjacent.y - point.y };
    if (departure.x * outward.x + departure.y * outward.y <= 0) {
      return `Route ${route.id} escape segment must leave ${endpoint.instanceId}.${endpoint.pinName} outward`;
    }
  }
  return null;
}

export function sameResolvedRoutePoints(
  left: readonly Point[] | null,
  right: readonly Point[] | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.length === right.length &&
    left.every(
      (point, index) =>
        point.x === right[index]!.x && point.y === right[index]!.y,
    )
  );
}
