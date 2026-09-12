import { resolveEndpointConnection, resolveRouteGeometry } from "@icm/derived";
import {
  routeEnd,
  type Point,
  type RouteBranch,
  type SchematicDocument,
  type SegmentMode,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { normalizeRouteGeometry, strongerMode } from "./route-geometry-edit.js";

/**
 * A shortened boundary must not retrace the terminal's artwork lead. Fold
 * that local elbow onto the contact's perpendicular instead. No fixed escape
 * length, symbol-specific rule, moved terminal, or global reroute is needed.
 * A perpendicular departure is valid and deliberately remains unchanged.
 */
export function tidyRouteTerminalApproaches(
  document: SchematicDocument,
  resolver: SymbolResolver,
  route: RouteBranch,
  input: readonly Point[],
  inputModes: readonly SegmentMode[],
): { points: Point[]; segmentModes: SegmentMode[] } {
  let points = input.map((point) => ({ ...point }));
  let modes = [...inputModes];
  if (modes.some((mode) => mode === "locked" || mode === "trunk"))
    return { points, segmentModes: modes };
  const original = resolveRouteGeometry(document, resolver, route)?.centerline;
  for (const [endpoint, reverse] of [
    [route.start, false],
    [routeEnd(route), true],
  ] as const) {
    if (endpoint.kind !== "terminal") continue;
    const connection = resolveEndpointConnection(document, resolver, endpoint);
    if (!connection?.outward) continue;
    const originalEnd = reverse ? original?.at(-1) : original?.[0];
    const originalNeighbor = reverse ? original?.at(-2) : original?.[1];
    // Explicit slanted-line repair is a different authoring intent: retain
    // its dragged crossbar rather than replacing it with an unrelated L.
    if (
      originalEnd &&
      originalNeighbor &&
      originalEnd.x !== originalNeighbor.x &&
      originalEnd.y !== originalNeighbor.y
    )
      continue;
    if (reverse) {
      points.reverse();
      modes.reverse();
    }
    const [a, b, c] = points;
    const outward = connection.outward;
    // Only persist an elbow at an actual grid contact. Offset artwork leads
    // remain owned by EndpointConnection, not rounded or copied into bends.
    const gridContact =
      a && a.x === connection.gridLanding.x && a.y === connection.gridLanding.y;
    const horizontal = outward.x !== 0 && outward.y === 0;
    const vertical = outward.y !== 0 && outward.x === 0;
    const backwards =
      a && b && (b.x - a.x) * outward.x + (b.y - a.y) * outward.y < 0;
    const elbow =
      a &&
      b &&
      c &&
      ((horizontal && a.y === b.y && b.x === c.x && b.y !== c.y) ||
        (vertical && a.x === b.x && b.y === c.y && b.x !== c.x));
    if (gridContact && backwards && elbow && a && c) {
      points[1] = horizontal ? { x: a.x, y: c.y } : { x: c.x, y: a.y };
      if (points.length > 3) {
        points.splice(2, 1);
        modes.splice(0, 2, strongerMode(modes[0]!, modes[1]!));
      }
      const normalized = normalizeRouteGeometry(points, modes);
      points = normalized.points;
      modes = normalized.segmentModes;
    }
    if (reverse) {
      points.reverse();
      modes.reverse();
    }
  }
  return { points, segmentModes: modes };
}
