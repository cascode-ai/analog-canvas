import type {
  Annotation,
  Point,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import {
  routeEnd,
  routeElectricalConnections,
  junctionElectricalEndpoints,
} from "@icm/model";
import {
  derivePowerRailComponent,
  deriveDocumentContactEvidence,
  endpointBelongsToNet,
  polylineSatisfiesConstraint,
  endpointKey,
  netEndpoints,
  pointOnSegment as pointOnGenericSegment,
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
} from "@icm/derived";
import type {
  DocumentContactEvidence,
  EndpointObjectLookup,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";
import { resolveRouteEditPath } from "./route-operations.js";
import { signalEndpointMembers } from "./signal-endpoint.js";

export function pointOnSegment(point: Point, from: Point, to: Point): boolean {
  return pointOnGenericSegment(point, from, to, { interior: true });
}

export function routeIsProtected(route: RouteBranch): boolean {
  return route.legs.some((leg) => leg.mode === "locked");
}

export function routeRelatedObjectIds(route: RouteBranch): string[] {
  const end = routeEnd(route);
  return [
    route.id,
    route.netId,
    ...(route.start.kind === "terminal"
      ? [route.start.instanceId]
      : [route.start.junctionId]),
    ...(end.kind === "terminal" ? [end.instanceId] : [end.junctionId]),
  ];
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
              terminal.pinName === endpoint.pinName &&
              terminal.memberId === endpoint.memberId,
          ),
        )?.id ?? null
      );
    case "junction":
      return (
        document.junctions
          .flatMap(junctionElectricalEndpoints)
          .find((item) => endpointKey(item.endpoint) === endpointKey(endpoint))
          ?.netId ?? null
      );
  }
}

export function netEndpointGroups(
  document: SchematicDocument,
  netId: string,
  resolver?: SymbolResolver,
  contactEvidence?: DocumentContactEvidence,
): string[][] {
  const net = document.nets.find((candidate) => candidate.id === netId);
  if (!net) return [];
  const keys = netEndpoints(document, net).map(endpointKey);
  const routes = document.routes.filter((candidate) =>
    routeElectricalConnections(candidate).some((edge) => edge.netId === netId),
  );
  const contacts = resolver
    ? (
        contactEvidence ?? deriveDocumentContactEvidence(document, resolver)
      ).contacts.filter((contact) => contact.netId === netId)
    : [];
  return netEndpointGroupsFromEdges(keys, routes, contacts);
}

export function netEndpointGroupsFromEdges(
  keys: string[],
  routes: readonly RouteBranch[],
  contacts: Iterable<{ readonly endpoints: readonly RouteEndpoint[] }>,
): string[][] {
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
  for (const route of routes) {
    for (const edge of routeElectricalConnections(route)) {
      const from = endpointKey(edge.endpoints[0]);
      const to = endpointKey(edge.endpoints[1]);
      if (parent.has(from) && parent.has(to)) union(from, to);
    }
  }
  // A pin or Junction placed directly on another explicit same-Net endpoint
  // is a real electrical contact even when no Route object exists between the
  // coincident endpoints. Preserve that contact when a different Route is cut.
  // Name claims and other Logical-Net Evidence are intentionally excluded:
  // they express logical identity, not one physical Base-Net component.
  for (const contact of contacts) {
    if (contact.endpoints.length < 2) continue;
    const [first, ...rest] = contact.endpoints.map(endpointKey);
    for (const key of rest) union(first!, key);
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
  lookup?: EndpointObjectLookup,
): string | null {
  switch (endpoint.kind) {
    case "terminal": {
      const instance = lookup
        ? lookup.instancesById.get(endpoint.instanceId)
        : document.instances.find(
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
      const members = signalEndpointMembers(
        document,
        resolver,
        {
          kind: "terminal",
          instanceId: endpoint.instanceId,
          pinName: endpoint.pinName,
        },
        lookup,
      );
      // A Cell Pin's member Nets are established before its formal declaration
      // in the same transaction; the completed Project validates that owner.
      if (
        (instance.symbolId === "port" || instance.symbolId === "port-filled") &&
        !document.netlist?.terminals.some((terminal) =>
          terminal.interfaceInstanceIds.includes(instance.id),
        )
      )
        return null;
      if (
        members
          ? !members.some((member) => member.id === endpoint.memberId)
          : endpoint.memberId !== undefined
      )
        return "Select an existing scalar member of the declared bus endpoint";
      return null;
    }
    case "junction": {
      const junction = lookup
        ? lookup.junctionsById.get(endpoint.junctionId)
        : document.junctions.find((item) => item.id === endpoint.junctionId);
      if (
        junction &&
        (junction.members
          ? !junction.members.some((member) => member.id === endpoint.memberId)
          : endpoint.memberId !== undefined)
      )
        return "Select an existing scalar member of the bus junction";
      return junction
        ? null
        : `Junction does not exist: ${endpoint.junctionId}`;
    }
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
          terminal.pinName === endpoint.pinName &&
          terminal.memberId === endpoint.memberId,
      )
    ) {
      net.terminals.push({
        instanceId: endpoint.instanceId,
        pinName: endpoint.pinName,
        ...(endpoint.memberId ? { memberId: endpoint.memberId } : {}),
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
  edit: Extract<SchematicEdit, { kind: "set_route_path" }>,
): RouteBranch {
  return structuredClone(edit.route);
}

export function validateRoute(
  document: SchematicDocument,
  route: RouteBranch,
  resolver: SymbolResolver,
  resolvedPath?: ReturnType<typeof resolveRouteEditPath>,
  membership: "committed" | "pending" = "committed",
  lookup?: EndpointObjectLookup,
): string | null {
  const net = document.nets.find((candidate) => candidate.id === route.netId);
  if (membership === "committed" && !net)
    return `Route net does not exist: ${route.netId}`;
  if (
    membership === "committed" &&
    route.presentation === "power-rail" &&
    !resolveDocumentLogicalNets(document).byBaseNetId.get(route.netId)?.name
  ) {
    return `Power rail ${route.id} must belong to a named Net`;
  }
  const end = routeEnd(route);
  for (const edge of routeElectricalConnections(route)) {
    const memberNet = document.nets.find(
      (candidate) => candidate.id === edge.netId,
    );
    for (const endpoint of edge.endpoints) {
      const problem = validateConnectableEndpoint(
        document,
        endpoint,
        resolver,
        lookup,
      );
      if (problem) return problem;
      if (
        membership === "committed" &&
        (!memberNet || !endpointBelongsToNet(document, memberNet, endpoint))
      ) {
        return `Route endpoint is not a member of ${edge.netId}`;
      }
    }
  }
  const polyline =
    resolvedPath === undefined
      ? resolveRouteEditPath(document, resolver, route)
      : resolvedPath;
  if (!polyline) return `Route ${route.id} has an unresolved endpoint`;
  // Segment heading is geometry, not topology (ADR 0028), and ADR 0039 grants
  // the arbitrary-angle policy that ADR 0028 anticipated. Validation therefore
  // rejects only degenerate geometry; which headings a command may author is
  // the edit engine's transient policy, not a rule about legal Routes.
  if (!polylineSatisfiesConstraint(polyline.points, "any-angle")) {
    const points = polyline.points
      .map((point) => `(${point.x},${point.y})`)
      .join(" -> ");
    return `Route ${route.id} (${endpointKey(route.start)} -> ${endpointKey(end)}, resolved ${points}) must contain only non-zero segments`;
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
      route.start,
      polyline.points[0]!,
      polyline.points[1]!,
      route.legs[0]?.mode,
    ],
    [
      end,
      polyline.points.at(-1)!,
      polyline.points.at(-2)!,
      route.legs.at(-1)?.mode,
    ],
  ] as const) {
    if (endpoint.kind !== "terminal" || mode !== "escape") continue;
    const connection = resolveEndpointConnection(document, resolver, endpoint);
    const outward = connection?.outward;
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
