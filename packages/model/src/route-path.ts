import type {
  GridPoint,
  RouteBranch,
  RouteEndpoint,
  RoutePresentation,
  RouteStyleOverride,
  SegmentMode,
  StableId,
} from "./schema.js";
import { deriveStableId } from "./ids.js";

export interface NewRoutePath {
  readonly id: StableId;
  readonly netId: StableId;
  readonly start: RouteEndpoint;
  readonly end: RouteEndpoint;
  readonly bends: readonly GridPoint[];
  readonly modes: readonly SegmentMode[];
  readonly presentation?: RoutePresentation;
  readonly styleOverride?: RouteStyleOverride;
}

/**
 * The Leg and Bend IDs `createRoutePath` allocates for a Route of `legCount`
 * legs. They derive from the Route ID, but split Routes keep their original
 * children, so a freed Route ID's children may still exist elsewhere. Callers
 * choosing a new Route ID check these against the Document as well.
 */
export function createdRouteChildIds(
  routeId: string,
  legCount: number,
): string[] {
  return Array.from({ length: legCount }, (_, index) => [
    deriveStableId("route-leg", routeId, String(index)),
    ...(index < legCount - 1
      ? [deriveStableId("route-bend", routeId, String(index))]
      : []),
  ]).flat();
}

/**
 * Construct a new canonical Route path and allocate deterministic child IDs.
 * Existing Routes must be edited with identity-preserving Route operations,
 * never reconstructed through this creation-only factory.
 */
export function createRoutePath(input: NewRoutePath): RouteBranch {
  if (input.modes.length !== input.bends.length + 1) {
    throw new Error("A new Route requires one mode per geometric leg");
  }
  const childIds = createdRouteChildIds(input.id, input.modes.length);
  return {
    id: input.id,
    netId: input.netId,
    start: input.start,
    legs: input.modes.map((mode, index) => ({
      id: childIds[index * 2]!,
      to:
        index < input.bends.length
          ? {
              kind: "bend" as const,
              bendId: childIds[index * 2 + 1]!,
              position: { ...input.bends[index]! },
            }
          : { kind: "endpoint" as const, endpoint: input.end },
      mode,
    })),
    ...(input.presentation ? { presentation: input.presentation } : {}),
    ...(input.styleOverride
      ? { styleOverride: structuredClone(input.styleOverride) }
      : {}),
  };
}

export function routeEnd(route: RouteBranch): RouteEndpoint {
  const target = route.legs.at(-1)?.to;
  if (target?.kind !== "endpoint") {
    throw new Error(`Route ${route.id} has no final endpoint`);
  }
  return target.endpoint;
}

export function routeEndpoints(
  route: RouteBranch,
): readonly [RouteEndpoint, RouteEndpoint] {
  return [route.start, routeEnd(route)];
}

export function routeBends(route: RouteBranch): GridPoint[] {
  return route.legs.flatMap((leg) =>
    leg.to.kind === "bend" ? [{ ...leg.to.position }] : [],
  );
}

export function routeModes(route: RouteBranch): SegmentMode[] {
  return route.legs.map((leg) => leg.mode);
}
