import {
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
} from "@icm/derived";
import { transformPoint } from "@icm/model";
import type { Instance, Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

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
): readonly PlacementNearMiss[] {
  const grid = document.presentation.grid;
  if (grid <= 0 || !instance.placement) return [];
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) return [];
  const geometry = resolveDocumentRoutingGeometry(document, resolver);
  const logicalNets = resolveDocumentLogicalNets(document);

  const misses: PlacementNearMiss[] = [];
  for (const pin of resolved.definition.pins) {
    const at = transformPoint(
      pin.at,
      instance.placement.position,
      instance.placement,
    );
    let nearest: { netId: string; distance: number } | null = null;
    for (const route of geometry.routes.values()) {
      for (const segment of route.segments) {
        const distance = distanceToSegment(at, segment.from, segment.to);
        if (nearest === null || distance < nearest.distance) {
          nearest = { netId: route.netId, distance };
        }
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
    misses.push({
      pinName: pin.name,
      netId: nearest.netId,
      netLabel: logicalNets.byBaseNetId.get(nearest.netId)?.name ?? "a wire",
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
