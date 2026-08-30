import { createRoutePath, deriveStableId } from "@icm/model";
import type {
  Point,
  RouteBranch,
  RouteEndpoint,
  SegmentMode,
} from "@icm/model";

export interface RouteIdentityRemap {
  readonly retainedLegIds: ReadonlyMap<string, string>;
  readonly retainedBendIds: ReadonlyMap<string, string>;
  readonly removedLegIds: ReadonlySet<string>;
  readonly removedBendIds: ReadonlySet<string>;
  readonly createdLegIds: ReadonlySet<string>;
  readonly createdBendIds: ReadonlySet<string>;
}

export interface RebuiltRoutePath {
  readonly route: RouteBranch;
  readonly identityRemap: RouteIdentityRemap;
}

/**
 * Rebuild one existing path while retaining ordered physical identity.
 *
 * Equal bend counts represent a geometry-only transform and retain identity by
 * order. When the bend count changes, common bend positions partition the old
 * and new paths. Inside each partition, identities are retained from the
 * start side: splitting therefore keeps the original ID on the start-side
 * leg, while merging keeps the first removed span's ID.
 */
export function rebuildRoutePathWithRemap(
  source: RouteBranch,
  start: RouteEndpoint,
  end: RouteEndpoint,
  bends: readonly Point[],
  modes: readonly SegmentMode[],
  identityScope = "edit",
): RebuiltRoutePath {
  const rebuilt = createRoutePath({
    id: source.id,
    netId: source.netId,
    start: structuredClone(start),
    end: structuredClone(end),
    bends,
    modes,
    ...(source.presentation ? { presentation: source.presentation } : {}),
    ...(source.styleOverride
      ? { styleOverride: structuredClone(source.styleOverride) }
      : {}),
  });
  const oldBends = source.legs.flatMap((leg, legIndex) =>
    leg.to.kind === "bend"
      ? [{ legIndex, bendId: leg.to.bendId, position: leg.to.position }]
      : [],
  );
  const newBends = rebuilt.legs.flatMap((leg, legIndex) =>
    leg.to.kind === "bend" ? [{ legIndex, position: leg.to.position }] : [],
  );
  const commonBends =
    oldBends.length === newBends.length
      ? oldBends.map((_, index) => [index, index] as const)
      : longestCommonBendSubsequence(oldBends, newBends);

  const retainedLegIds = new Map<string, string>();
  const retainedBendIds = new Map<string, string>();
  const occupiedLegIds = new Set<string>();
  const occupiedBendIds = new Set<string>();
  const assignedLegIndexes = new Set<number>();
  const assignedBendLegIndexes = new Set<number>();

  for (const [oldBendIndex, newBendIndex] of commonBends) {
    const oldBend = oldBends[oldBendIndex]!;
    const targetLegIndex = newBends[newBendIndex]!.legIndex;
    const target = rebuilt.legs[targetLegIndex]!.to;
    if (target.kind !== "bend") continue;
    target.bendId = oldBend.bendId;
    retainedBendIds.set(oldBend.bendId, target.bendId);
    occupiedBendIds.add(target.bendId);
    assignedBendLegIndexes.add(targetLegIndex);
  }

  const boundaries = [
    [-1, -1] as const,
    ...commonBends,
    [oldBends.length, newBends.length] as const,
  ];
  for (
    let boundaryIndex = 1;
    boundaryIndex < boundaries.length;
    boundaryIndex += 1
  ) {
    const [previousOldBend, previousNewBend] = boundaries[boundaryIndex - 1]!;
    const [nextOldBend, nextNewBend] = boundaries[boundaryIndex]!;
    const oldLegStart = previousOldBend + 1;
    const newLegStart = previousNewBend + 1;
    const retainedCount = Math.min(
      nextOldBend + 1 - oldLegStart,
      nextNewBend + 1 - newLegStart,
    );
    for (let offset = 0; offset < retainedCount; offset += 1) {
      const previous = source.legs[oldLegStart + offset];
      const next = rebuilt.legs[newLegStart + offset];
      if (!previous || !next || occupiedLegIds.has(previous.id)) continue;
      next.id = previous.id;
      retainedLegIds.set(previous.id, next.id);
      occupiedLegIds.add(next.id);
      assignedLegIndexes.add(newLegStart + offset);
    }
  }

  for (const [index, leg] of rebuilt.legs.entries()) {
    if (!assignedLegIndexes.has(index)) {
      leg.id = freshChildId(
        "route-leg",
        source.id,
        identityScope,
        index,
        occupiedLegIds,
      );
      occupiedLegIds.add(leg.id);
    }
    if (leg.to.kind !== "bend" || assignedBendLegIndexes.has(index)) continue;
    leg.to.bendId = freshChildId(
      "route-bend",
      source.id,
      identityScope,
      index,
      occupiedBendIds,
    );
    occupiedBendIds.add(leg.to.bendId);
  }

  const sourceLegIds = new Set(source.legs.map((leg) => leg.id));
  const sourceBendIds = new Set(oldBends.map((bend) => bend.bendId));
  return {
    route: rebuilt,
    identityRemap: {
      retainedLegIds,
      retainedBendIds,
      removedLegIds: difference(sourceLegIds, retainedLegIds.keys()),
      removedBendIds: difference(sourceBendIds, retainedBendIds.keys()),
      createdLegIds: difference(occupiedLegIds, sourceLegIds),
      createdBendIds: difference(occupiedBendIds, sourceBendIds),
    },
  };
}

export function rebuildRoutePath(
  source: RouteBranch,
  start: RouteEndpoint,
  end: RouteEndpoint,
  bends: readonly Point[],
  modes: readonly SegmentMode[],
  identityScope = "edit",
): RouteBranch {
  return rebuildRoutePathWithRemap(
    source,
    start,
    end,
    bends,
    modes,
    identityScope,
  ).route;
}

function longestCommonBendSubsequence(
  oldBends: readonly { position: Point }[],
  newBends: readonly { position: Point }[],
): ReadonlyArray<readonly [number, number]> {
  const lengths = Array.from({ length: oldBends.length + 1 }, () =>
    Array<number>(newBends.length + 1).fill(0),
  );
  for (let oldIndex = oldBends.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newBends.length - 1; newIndex >= 0; newIndex -= 1) {
      lengths[oldIndex]![newIndex] = samePoint(
        oldBends[oldIndex]!.position,
        newBends[newIndex]!.position,
      )
        ? 1 + lengths[oldIndex + 1]![newIndex + 1]!
        : Math.max(
            lengths[oldIndex + 1]![newIndex]!,
            lengths[oldIndex]![newIndex + 1]!,
          );
    }
  }
  const result: Array<readonly [number, number]> = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldBends.length && newIndex < newBends.length) {
    if (samePoint(oldBends[oldIndex]!.position, newBends[newIndex]!.position)) {
      result.push([oldIndex, newIndex]);
      oldIndex += 1;
      newIndex += 1;
    } else if (
      lengths[oldIndex + 1]![newIndex]! >= lengths[oldIndex]![newIndex + 1]!
    ) {
      oldIndex += 1;
    } else {
      newIndex += 1;
    }
  }
  return result;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function difference(
  values: ReadonlySet<string>,
  retained: Iterable<string>,
): ReadonlySet<string> {
  const remaining = new Set(values);
  for (const value of retained) remaining.delete(value);
  return remaining;
}

function freshChildId(
  prefix: "route-leg" | "route-bend",
  routeId: string,
  scope: string,
  index: number,
  occupied: ReadonlySet<string>,
): string {
  let ordinal = 0;
  while (true) {
    const candidate = deriveStableId(
      prefix,
      routeId,
      scope,
      String(index),
      String(ordinal),
    );
    if (!occupied.has(candidate)) return candidate;
    ordinal += 1;
  }
}
