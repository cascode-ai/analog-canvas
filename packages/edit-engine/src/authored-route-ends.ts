import { routeEndpoints } from "@icm/model";
import type { Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import { endpointKey, resolveDocumentRoutingGeometry } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import type { EditTransaction } from "./edit-schema.js";

/** An end a Route geometry edit states and the transaction must keep. */
export interface KeptRouteEnd {
  readonly routeId: string;
  readonly endpoint: RouteEndpoint;
  /** Where a kept Junction stood once the edits were applied. */
  readonly position?: Point;
  /**
   * The Route follows a part whose pins this transaction moves: the engine
   * lays the stretch, so its ends are kept but never refused.
   */
  readonly stretch: boolean;
}

/**
 * The ends of every existing ordinary Wire whose path this transaction states
 * (`set_route_path`, `route_orthogonal`): every terminal, and every Junction
 * that branches (three or more wire arms) once the edits are applied. A
 * Junction with one or two arms is a loose end or a corner that a
 * continuation may fold away; a Junction the transaction moves or creates is
 * the caller's to place; a new Route is the wire planner's to lay.
 */
export function captureKeptRouteEnds(
  before: SchematicDocument,
  draft: SchematicDocument,
  transaction: EditTransaction,
  movedInstanceIds: ReadonlySet<string>,
  movedJunctionIds: ReadonlySet<string>,
): KeptRouteEnd[] {
  const existingRouteIds = new Set(before.routes.map(({ id }) => id));
  const existingJunctionIds = new Set(before.junctions.map(({ id }) => id));
  const arms = new Map<string, number>();
  for (const route of draft.routes) {
    for (const endpoint of routeEndpoints(route)) {
      if (endpoint.kind !== "junction") continue;
      arms.set(endpoint.junctionId, (arms.get(endpoint.junctionId) ?? 0) + 1);
    }
  }
  const kept: KeptRouteEnd[] = [];
  for (const edit of transaction.edits) {
    const stated =
      edit.kind === "set_route_path"
        ? { routeId: edit.route.id, ends: routeEndpoints(edit.route) }
        : edit.kind === "route_orthogonal"
          ? { routeId: edit.routeId, ends: [edit.from, edit.to] }
          : null;
    if (!stated || !existingRouteIds.has(stated.routeId)) continue;
    // Only ordinary Wires enter conductor normalization; rails, bulk ties,
    // buses and locked geometry keep their ends by other rules.
    const route = draft.routes.find(({ id }) => id === stated.routeId);
    if (
      !route ||
      route.members ||
      (route.presentation ?? "wire") !== "wire" ||
      route.legs.some((leg) => leg.mode === "locked")
    )
      continue;
    const stretch = stated.ends.some(
      (endpoint) =>
        endpoint.kind === "terminal" &&
        movedInstanceIds.has(endpoint.instanceId),
    );
    for (const endpoint of stated.ends) {
      if (endpoint.kind === "terminal") {
        kept.push({ routeId: stated.routeId, endpoint, stretch });
        continue;
      }
      const junction = draft.junctions.find(
        ({ id }) => id === endpoint.junctionId,
      );
      if (
        !junction ||
        junction.members ||
        movedJunctionIds.has(junction.id) ||
        !existingJunctionIds.has(junction.id) ||
        (arms.get(junction.id) ?? 0) < 3
      )
        continue;
      kept.push({
        routeId: stated.routeId,
        endpoint,
        position: { ...junction.position },
        stretch,
      });
    }
  }
  return kept;
}

/** Two segments share a stretch of positive length. */
function runsAlong(a: Point, b: Point, c: Point, d: Point): boolean {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const lengthSquared = r.x ** 2 + r.y ** 2;
  if (lengthSquared === 0) return false;
  const across = (point: Point) =>
    r.x * (point.y - a.y) - r.y * (point.x - a.x);
  if (across(c) !== 0 || across(d) !== 0) return false;
  const along = (point: Point) =>
    ((point.x - a.x) * r.x + (point.y - a.y) * r.y) / lengthSquared;
  const [t0, t1] = [along(c), along(d)];
  return Math.min(1, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) > 1e-9;
}

/**
 * The first kept end of an edit the caller authored that the edit would
 * displace, read before conductor normalization: its Junction is gone or
 * stands elsewhere, no piece of the edited Route (itself, or what a physical
 * contact split it into) ends on it any more, or the piece that does arrives
 * along another wire of its Net into a branch Junction. Normalization would fold that overlap into
 * one conductor and the edited wire would end on whatever lies first along
 * it, so the edit is refused instead.
 */
export function findDisplacedRouteEnd(
  draft: SchematicDocument,
  resolver: SymbolResolver,
  kept: readonly KeptRouteEnd[],
  splitProducts: ReadonlyMap<string, ReadonlySet<string>>,
): KeptRouteEnd | null {
  const authored = kept.filter(({ stretch }) => !stretch);
  if (authored.length === 0) return null;
  const geometry = resolveDocumentRoutingGeometry(draft, resolver);
  for (const end of authored) {
    if (end.endpoint.kind === "junction") {
      const { junctionId } = end.endpoint;
      const junction = draft.junctions.find(({ id }) => id === junctionId);
      if (
        !junction ||
        junction.position.x !== end.position?.x ||
        junction.position.y !== end.position.y
      )
        return end;
    }
    const pieces = new Set<string>();
    const pending = [end.routeId];
    while (pending.length > 0) {
      const routeId = pending.pop()!;
      if (pieces.has(routeId)) continue;
      pieces.add(routeId);
      pending.push(...(splitProducts.get(routeId) ?? []));
    }
    const key = endpointKey(end.endpoint);
    const arriving = draft.routes.find(
      (route) =>
        pieces.has(route.id) &&
        routeEndpoints(route).some(
          (candidate) => endpointKey(candidate) === key,
        ),
    );
    if (!arriving) return end;
    // A wire that reaches a pin along another wire of its own Net still ends
    // on that pin once the two are folded together (an ordinary segment
    // drag); only a branch Junction can be folded away.
    if (end.endpoint.kind !== "junction") continue;
    const points = geometry.routes.get(arriving.id)?.centerline;
    if (!points || points.length < 2) continue;
    const atStart = endpointKey(arriving.start) === key;
    const [from, to] = atStart
      ? [points[0]!, points[1]!]
      : [points.at(-1)!, points.at(-2)!];
    const overlapped = draft.routes.some((other) => {
      if (pieces.has(other.id) || other.netId !== arriving.netId) return false;
      const otherPoints = geometry.routes.get(other.id)?.centerline ?? [];
      return otherPoints.some(
        (point, index) =>
          index > 0 && runsAlong(from, to, otherPoints[index - 1]!, point),
      );
    });
    if (overlapped) return end;
  }
  return null;
}

export function displacedRouteEndMessage(end: KeptRouteEnd): string {
  if (end.endpoint.kind === "junction")
    return `Route ${end.routeId} would no longer end on Junction ${end.endpoint.junctionId}: its new path runs along another wire into the Junction, which would move or rebuild it. End the path where it meets that wire, or move the Junction first`;
  return `Route ${end.routeId} would no longer end on ${end.endpoint.instanceId}.${end.endpoint.pinName}: its new path no longer reaches that pin. End the path on the pin`;
}
