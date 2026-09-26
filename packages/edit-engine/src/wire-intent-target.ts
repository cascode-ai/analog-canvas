import {
  endpointKey,
  nearestRouteSegment,
  pointOnSegment,
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "@icm/derived";
import {
  foldNetName,
  routeEnd,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { WireIntentAnchor } from "./routing-planner.js";

/** Resolve geometry selectors on the current planning draft, never a client Snapshot. */
export function resolveWireIntentTarget(
  document: SchematicDocument,
  resolver: SymbolResolver,
  anchor: WireIntentAnchor,
  other: WireIntentAnchor,
): Exclude<WireIntentAnchor, { kind: "net" | "wire-at" }> | string {
  if (anchor.kind !== "wire-at" && anchor.kind !== "net") return anchor;
  const logical = resolveDocumentLogicalNets(document);
  const requested = anchor.net;
  let allowed: Set<string> | undefined;
  if (requested) {
    const nets = [...logical.byBaseNetId].filter(
      ([id, net]) =>
        id === requested ||
        net.id === requested ||
        foldNetName(net.name ?? "") === foldNetName(requested),
    );
    if (!nets.length) return `Net target does not exist: ${requested}`;
    allowed = new Set(nets.map(([id]) => id));
  }
  if (anchor.kind === "wire-at" && anchor.member) {
    const member = anchor.member;
    const owner = document.nets.find((net) =>
      net.terminals.some(
        (pin) =>
          pin.instanceId === member.instanceId &&
          pin.pinName === member.pinName,
      ),
    );
    if (!owner || (allowed && !allowed.has(owner.id)))
      return "wire-at member does not belong to the requested Net";
    allowed = new Set(
      logical.byBaseNetId.get(owner.id)?.baseNetIds ?? [owner.id],
    );
  }
  const allRecords = document.routes.flatMap((route) => {
    const geometry = resolveRouteGeometry(document, resolver, route);
    return geometry ? [{ route, geometry }] : [];
  });
  const records = allRecords.filter(
    ({ route }) => !allowed || allowed.has(route.netId),
  );
  const equal = (a: Point | undefined, b: Point) => a?.x === b.x && a.y === b.y;
  let point: Point;
  if (anchor.kind === "net") {
    const near =
      other.kind === "endpoint"
        ? resolveEndpointConnection(document, resolver, other.endpoint)
            ?.gridLanding
        : other.kind !== "net"
          ? other.point
          : undefined;
    if (!near)
      return "A Net target needs a geometric endpoint on the other side; use wire-at for an exact tap";
    const hits = records
      .flatMap(({ geometry }) => {
        const hit = nearestRouteSegment(geometry, near);
        return hit ? [hit] : [];
      })
      .sort((a, b) => a.distanceSquared - b.distanceSquared);
    if (!hits.length) {
      const junction = document.junctions
        .filter((j) => allowed?.has(j.netId))
        .sort(
          (a, b) =>
            (near.x - a.position.x) ** 2 +
            (near.y - a.position.y) ** 2 -
            ((near.x - b.position.x) ** 2 + (near.y - b.position.y) ** 2),
        )[0];
      return junction
        ? {
            kind: "endpoint",
            endpoint: { kind: "junction", junctionId: junction.id },
          }
        : "Net has no route or Junction geometry; connect pin-to-pin first";
    }
    point = {
      x: Math.round(hits[0]!.point.x),
      y: Math.round(hits[0]!.point.y),
    };
  } else point = anchor.point;
  const matches = records.flatMap(({ route, geometry }) =>
    geometry.segments
      .filter((segment) => pointOnSegment(point, segment.from, segment.to))
      .map((segment) => ({ route, geometry, segment })),
  );
  if (!matches.length)
    return `No wire at (${point.x}, ${point.y}) for this target`;
  const netIds = new Set(matches.map(({ route }) => route.netId));
  if (netIds.size > 1)
    return `Ambiguous wire crossing at (${point.x}, ${point.y}); choose a tap away from the crossing (${[...netIds].join(", ")})`;
  // A Net qualifier selects the intended conductor; it cannot make a physical
  // Junction isolated from another conductor crossing the same point.
  if (
    allRecords.some(
      ({ route, geometry }) =>
        !netIds.has(route.netId) &&
        geometry.segments.some((segment) =>
          pointOnSegment(point, segment.from, segment.to),
        ),
    )
  )
    return `Tap at (${point.x}, ${point.y}) would join a different Net; choose a point away from the crossing`;
  const endpoints = matches.flatMap(({ route, geometry }) =>
    [
      { endpoint: route.start, point: geometry.centerline[0] },
      { endpoint: routeEnd(route), point: geometry.centerline.at(-1) },
    ]
      .filter((candidate) => equal(candidate.point, point))
      .map(({ endpoint }) => endpoint),
  );
  const uniqueEndpoints = new Map(
    endpoints.map((endpoint) => [endpointKey(endpoint), endpoint]),
  );
  if (uniqueEndpoints.size > 1)
    return `Multiple distinct wire endpoints at (${point.x}, ${point.y}); select an explicit endpoint`;
  const endpoint = uniqueEndpoints.values().next().value;
  if (endpoint) return { kind: "endpoint", endpoint };
  if (new Set(matches.map(({ route }) => route.id)).size > 1)
    return `Multiple wire interiors at (${point.x}, ${point.y}); select an explicit route-segment`;
  const match = matches[0]!;
  return {
    kind: "route-segment",
    routeId: match.route.id,
    legId: match.segment.address.legId,
    point,
  };
}
