import {
  buildDocumentSpatialIndex,
  type ResolvedDocumentLogicalNets,
  type DocumentSpatialIndex,
  type ResolvedDocumentRoutingGeometry,
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
} from "@icm/derived";
import { transformPoint } from "@icm/model";
import type { Instance, Point, SchematicDocument } from "@icm/model";
import {
  variantHidesPin,
  variantPinAt,
  type SymbolResolver,
} from "@icm/symbols";

/**
 * A pin that came close to a wire without touching it.
 *
 * Placement connects only on exact contact — geometry never guesses a
 * connection (a Crossing is not a Junction). That rule is right, and it is
 * also silent: a part dropped one grid short of a wire looks connected at a
 * glance and behaves as if it is not. This reports the near miss so the
 * editor can say so, and changes nothing about what actually connects.
 */
export interface PlacementNearMiss {
  pinName: string;
  netId: string;
  /**
   * What to call the wire out loud. A named net says its name; an unnamed one
   * has only a generated id, which tells a reader nothing, so it stays "a
   * wire" rather than putting `net-split-d0a1fbbd…` in front of a person.
   */
  netLabel: string;
  /** Whole grid squares between the pin and the wire, 1 or 2. */
  gridsAway: number;
}

/** How far off still counts as "you probably meant to touch this". */
const NEAR_MISS_MAX_GRIDS = 2;

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0)
    return Math.hypot(point.x - from.x, point.y - from.y);
  // Project onto the segment and clamp, so a pin beside a wire's middle and a
  // pin past its end are both measured to the nearest point actually drawn.
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared,
    ),
  );
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

function* allSegments(geometry: ResolvedDocumentRoutingGeometry) {
  for (const route of geometry.routes.values()) {
    for (const segment of route.segments)
      yield { routeId: route.routeId, from: segment.from, to: segment.to };
  }
}

/**
 * Pins of a just-placed Instance that sit within a couple of grid squares of
 * a wire they did not connect to, nearest first.
 *
 * Contact itself is not re-derived here: the caller already knows whether the
 * placement connected, and a pin that touched a wire is at distance zero and
 * is excluded by the lower bound.
 */
export function findPlacementNearMisses(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instance: Instance,
  prepared?: {
    geometry: ResolvedDocumentRoutingGeometry;
    spatialIndex: DocumentSpatialIndex;
    logicalNets: ResolvedDocumentLogicalNets;
  },
): readonly PlacementNearMiss[] {
  const grid = document.presentation.grid;
  if (grid <= 0 || !instance.placement) return [];
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) return [];
  const geometry =
    prepared?.geometry ?? resolveDocumentRoutingGeometry(document, resolver);
  const spatial =
    prepared?.spatialIndex ?? buildDocumentSpatialIndex(document, geometry);
  const logicalNets =
    prepared?.logicalNets ?? resolveDocumentLogicalNets(document);
  const radius = grid * NEAR_MISS_MAX_GRIDS;

  const misses: PlacementNearMiss[] = [];
  for (const pin of resolved.definition.pins) {
    // The hint names pins a person can point at. A variant-hidden or
    // implicit pin is not drawn, so "pin B is 1 grid from a wire" would
    // describe something invisible — same visibility rule as placement
    // contact resolution.
    if (
      variantHidesPin(resolved.variant, pin.name) ||
      pin.presentation.visibility === "implicit"
    ) {
      continue;
    }
    const at = transformPoint(
      variantPinAt(resolved.variant, pin),
      instance.placement.position,
      instance.placement,
    );
    let nearest: { routeId: string; distance: number } | null = null;
    // The index preserves document order. The original geometry traversal used
    // stable English Route ID order first, then the order of the Route's legs.
    const padding =
      4 * Number.EPSILON * Math.max(Math.abs(at.x), Math.abs(at.y), radius);
    const reach = radius + padding;
    const candidates =
      spatial.hasInexactDistanceBounds ||
      !Number.isFinite(at.x * at.x + at.y * at.y + reach * reach)
        ? allSegments(geometry)
        : spatial.routeSegments.queryBounds({
            x: at.x - reach,
            y: at.y - reach,
            width: 2 * reach,
            height: 2 * reach,
          });
    for (const segment of candidates) {
      const distance = distanceToSegment(at, segment.from, segment.to);
      if (
        nearest === null ||
        distance < nearest.distance ||
        (distance === nearest.distance &&
          segment.routeId.localeCompare(nearest.routeId, "en") < 0)
      ) {
        nearest = { routeId: segment.routeId, distance };
      }
    }
    if (!nearest) continue;
    // Zero is contact, which the placement already handled; beyond the bound
    // the part was simply put somewhere else and saying anything is noise.
    if (nearest.distance <= 0) continue;
    const gridsAway = nearest.distance / grid;
    if (gridsAway > NEAR_MISS_MAX_GRIDS) continue;
    // Only whole-grid gaps read as "one square short". A pin resting mid-square
    // is off the grid entirely, which is a different mistake.
    if (!Number.isInteger(gridsAway)) continue;
    const netId = geometry.routes.get(nearest.routeId)!.netId;
    misses.push({
      pinName: pin.name,
      netId,
      netLabel: logicalNets.byBaseNetId.get(netId)?.name ?? "a wire",
      gridsAway,
    });
  }
  return misses.sort((left, right) => left.gridsAway - right.gridsAway);
}

/** The sentence the status bar shows, or null when nothing came close. */
export function describePlacementNearMiss(
  misses: readonly PlacementNearMiss[],
  instanceId: string,
): string | null {
  const nearest = misses[0];
  if (!nearest) return null;
  const squares =
    nearest.gridsAway === 1 ? "1 grid" : `${nearest.gridsAway} grids`;
  return `${instanceId} pin ${nearest.pinName} is ${squares} from ${nearest.netLabel} — not connected`;
}
