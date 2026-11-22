import {
  endpointKey,
  nearestRouteSegment,
  pointOnSegment,
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "@icm/derived";
import {
  electricalConnectionGrid,
  foldNetName,
  routeEnd,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { WireIntentAnchor } from "./wire-intent-planner.js";

/**
 * Where a tap at `point` on a conductor's segment lands. A fine-grid tap is
 * kept only when the conductor itself has a fine-grid end; a normal conductor
 * tapped at x=196 still lands at x=200.
 */
export function routeTapLanding(
  segment: { readonly from: Point; readonly to: Point } | undefined,
  point: Point,
  grid: number,
): Point {
  const fineGrid = electricalConnectionGrid(grid);
  const segmentUsesFineGrid =
    segment &&
    [segment.from, segment.to].some(
      (end) => end.x % grid !== 0 || end.y % grid !== 0,
    );
  const tapIsFine =
    segmentUsesFineGrid &&
    (point.x % grid !== 0 || point.y % grid !== 0) &&
    point.x % fineGrid === 0 &&
    point.y % fineGrid === 0;
  const pitch = tapIsFine ? fineGrid : grid;
  return {
    x: Math.round(point.x / pitch) * pitch,
    y: Math.round(point.y / pitch) * pitch,
  };
}

/**
 * What a wire's `side` end looks for the nearest point of a Net from: the
 * via point next to it when the caller gave the path, else the other end. A
 * body wire given a stub out of the channel reaches the Net nearest the
 * stub's end; nearest the body, it doubled back over the stub (#1514).
 */
export function wireTargetReference(
  waypoints: readonly Point[] | undefined,
  side: "from" | "to",
  other: WireIntentAnchor,
): WireIntentAnchor {
  const via = side === "from" ? waypoints?.[0] : waypoints?.at(-1);
  return via ? { kind: "free", point: via } : other;
}

/** How a wire-at refusal begins when no wire is at the point (yet). */
export const NO_WIRE_AT = "No wire at";

/**
 * The tap-grid points nearest `point`: itself when on the grid, else the
 * two or four as near as each other in each coordinate.
 */
function nearestTapPoints(point: Point, pitch: number): Point[] {
  const near = (value: number): number[] => {
    const low = Math.floor(value / pitch) * pitch;
    const high = low + pitch;
    if (value === low) return [low];
    if (value - low < high - value) return [low];
    if (value - low > high - value) return [high];
    return [low, high];
  };
  return near(point.x).flatMap((x) => near(point.y).map((y) => ({ x, y })));
}

/** Whether `point` sits on the Document's tap grid. */
export function onTapGrid(document: SchematicDocument, point: Point): boolean {
  const pitch = electricalConnectionGrid(document.presentation.grid);
  return point.x % pitch === 0 && point.y % pitch === 0;
}

/**
 * Resolve geometry selectors on the current planning draft, never a client
 * Snapshot. A wire-at point off the tap grid taps at the nearest grid point
 * that resolves, so (101, 100) on a wire along y = 100 taps it at (100, 100)
 * or (102, 100), never off the wire at (100, 102).
 */
export function resolveWireIntentTarget(
  document: SchematicDocument,
  resolver: SymbolResolver,
  anchor: WireIntentAnchor,
  other: WireIntentAnchor,
): Exclude<WireIntentAnchor, { kind: "net" | "wire-at" }> | string {
  if (anchor.kind !== "wire-at" || onTapGrid(document, anchor.point))
    return resolveOnGrid(document, resolver, anchor, other);
  const pitch = electricalConnectionGrid(document.presentation.grid);
  const refusals: string[] = [];
  for (const point of nearestTapPoints(anchor.point, pitch)) {
    const resolved = resolveOnGrid(
      document,
      resolver,
      { ...anchor, point },
      other,
    );
    if (typeof resolved !== "string") return resolved;
    refusals.push(resolved);
  }
  return (
    refusals.find((refusal) => !refusal.startsWith(NO_WIRE_AT)) ??
    `${NO_WIRE_AT} (${anchor.point.x}, ${anchor.point.y}) or the nearest point of the ${pitch}-unit tap grid for this target`
  );
}

function resolveOnGrid(
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
          pin.pinName === member.pinName &&
          pin.memberId === member.memberId,
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
    ({ route }) =>
      !allowed ||
      (route.members ?? [route]).some((member) => allowed.has(member.netId)),
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
        return hit
          ? [{ ...hit, segment: geometry.segments[hit.address.segmentIndex] }]
          : [];
      })
      .sort((a, b) => a.distanceSquared - b.distanceSquared);
    if (!hits.length) {
      const junction = document.junctions
        .filter((j) =>
          (j.members ?? [j]).some((member) => allowed?.has(member.netId)),
        )
        .sort(
          (a, b) =>
            (near.x - a.position.x) ** 2 +
            (near.y - a.position.y) ** 2 -
            ((near.x - b.position.x) ** 2 + (near.y - b.position.y) ** 2),
        )[0];
      const members = junction?.members?.filter((member) =>
        allowed?.has(member.netId),
      );
      if (members && members.length !== 1)
        return "Net target matches more than one bus member; select an explicit member";
      return junction
        ? {
            kind: "endpoint",
            endpoint: {
              kind: "junction",
              junctionId: junction.id,
              ...(members ? { memberId: members[0]!.id } : {}),
            },
          }
        : "Net has no route or Junction geometry; connect pin-to-pin first";
    }
    // The nearest conductor is tapped where a pointer there would land.
    point = routeTapLanding(
      hits[0]!.segment,
      { x: Math.round(hits[0]!.point.x), y: Math.round(hits[0]!.point.y) },
      document.presentation.grid,
    );
  } else point = anchor.point;
  const matches = records.flatMap(({ route, geometry }) =>
    geometry.segments
      .filter((segment) => pointOnSegment(point, segment.from, segment.to))
      .map((segment) => ({ route, geometry, segment })),
  );
  if (!matches.length)
    return `${NO_WIRE_AT} (${point.x}, ${point.y}) for this target`;
  const selectedMembers = new Map(
    matches.flatMap(({ route }) => {
      if (!allowed || !route.members) return [];
      const members = route.members.filter((member) =>
        allowed.has(member.netId),
      );
      return members.length === 1 ? [[route.id, members[0]!] as const] : [];
    }),
  );
  if (
    allowed &&
    matches.some(({ route }) => route.members && !selectedMembers.has(route.id))
  )
    return "Net target matches more than one bus member; select an explicit member";
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
      {
        endpoint: route.start,
        point: geometry.centerline[0],
        memberId: selectedMembers.get(route.id)?.startMemberId,
      },
      {
        endpoint: routeEnd(route),
        point: geometry.centerline.at(-1),
        memberId: selectedMembers.get(route.id)?.endMemberId,
      },
    ]
      .filter((candidate) => equal(candidate.point, point))
      .map(({ endpoint, memberId }) =>
        memberId ? { ...endpoint, memberId } : endpoint,
      ),
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
    ...(selectedMembers.has(match.route.id)
      ? { memberId: selectedMembers.get(match.route.id)!.id }
      : {}),
    point,
  };
}
