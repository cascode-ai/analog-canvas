import type { Point, Rotation, SchematicDocument } from "@icm/model";
import { isFrozenSnapshot } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  buildInstanceAnchors,
  sceneSnapTargetsForCalculation,
  type SceneSnapTargetIndex,
} from "../../snap/candidates";
import {
  resolveTranslationSnap,
  SNAP_PROFILES,
  snapCoordinate,
  type SnapResult,
} from "../../snap/engine";
import { prepareMoveRouteTargets } from "../selection/move-route-targets";
import type { RouteGeometryRecord } from "../wiring/route-interaction-geometry";
import { placementWireSources } from "./placement-connectivity";

export interface PendingComponentPlacementSnap {
  position: Point;
  snap: SnapResult;
}

const routeProjections = new WeakMap<
  readonly RouteGeometryRecord[],
  {
    sources: readonly (readonly [
      RouteGeometryRecord["route"],
      RouteGeometryRecord["geometry"],
    ])[];
    project: ReturnType<typeof prepareMoveRouteTargets>;
  }
>();

function placementRouteProjection(records: readonly RouteGeometryRecord[]) {
  const immutable = records.every(
    ({ route, geometry }) =>
      isFrozenSnapshot(route) && isFrozenSnapshot(geometry),
  );
  const cached = immutable ? routeProjections.get(records) : undefined;
  if (
    cached?.sources.length === records.length &&
    records.every(
      ({ route, geometry }, at) =>
        route === cached.sources[at]![0] && geometry === cached.sources[at]![1],
    )
  )
    return cached.project;
  const project = prepareMoveRouteTargets(records, "placement-route");
  if (immutable)
    routeProjections.set(records, {
      sources: records.map(({ route, geometry }) => [route, geometry] as const),
      project,
    });
  return project;
}

/**
 * Resolve a new component through the same electrical-anchor snap used by an
 * existing Instance move. The returned position is still only geometry;
 * placement-connectivity remains the one writer that commits exact contact.
 */
export function snapPendingComponentPlacement(options: {
  document: SchematicDocument;
  resolver: SymbolResolver;
  routeGeometryRecords: readonly RouteGeometryRecord[];
  sceneSnapTargetIndex: SceneSnapTargetIndex;
  symbolId: string;
  symbolVariantId?: string;
  position: Point;
  rotation: Rotation;
  mirror: NonNullable<
    SchematicDocument["instances"][number]["placement"]
  >["mirror"];
  tolerance: number;
}): PendingComponentPlacementSnap {
  let instanceId = "pending-component-placement";
  while (options.document.instances.some((item) => item.id === instanceId)) {
    instanceId = `_${instanceId}`;
  }
  const basePosition = {
    x: snapCoordinate(options.position.x, options.document.presentation.grid),
    y: snapCoordinate(options.position.y, options.document.presentation.grid),
  };
  const rawDelta = {
    x: options.position.x - basePosition.x,
    y: options.position.y - basePosition.y,
  };
  const instance = {
    id: instanceId,
    symbolId: options.symbolId,
    ...(options.symbolVariantId
      ? { symbolVariantId: options.symbolVariantId }
      : {}),
    placement: {
      position: basePosition,
      rotation: options.rotation,
      mirror: options.mirror,
    },
  };
  // These readers never write model facts. The pending Instance is the only
  // addition, so retain the source rather than cloning the canvas per pointer.
  const projected = isFrozenSnapshot(options.document)
    ? {
        ...options.document,
        instances: [...options.document.instances, instance],
      }
    : structuredClone(options.document);
  if (!isFrozenSnapshot(options.document)) projected.instances.push(instance);
  const sources = placementWireSources(projected, options.resolver, instance);
  const movingAnchors = buildInstanceAnchors(
    projected,
    options.resolver,
    sources,
    new Set([instanceId]),
  );
  const projectRoute = placementRouteProjection(options.routeGeometryRecords);
  const routeTargets = movingAnchors.flatMap((moving) =>
    projectRoute(moving, rawDelta, options.tolerance),
  );
  const snap = resolveTranslationSnap({
    rawDelta,
    movingAnchors,
    targetAnchors: sceneSnapTargetsForCalculation(options.sceneSnapTargetIndex),
    additionalTargetAnchors: routeTargets,
    primaryAnchorId: `instance:${instanceId}:origin`,
    grid: options.document.presentation.grid,
    tolerance: options.tolerance,
    profile: SNAP_PROFILES.instancePlacement,
  });
  return {
    position: {
      x: basePosition.x + snap.delta.x,
      y: basePosition.y + snap.delta.y,
    },
    snap,
  };
}
