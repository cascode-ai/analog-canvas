import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { closestPointOnSegment } from "../../canvas/canvas-geometry";
import {
  buildInstanceAnchors,
  sceneSnapTargetsExcluding,
  type SceneSnapTargetIndex,
} from "../../snap/candidates";
import {
  resolveTranslationSnap,
  SNAP_PROFILES,
  snapCoordinate,
  type SnapAnchor,
  type SnapResult,
} from "../../snap/engine";
import type { RouteGeometryRecord } from "../wiring/route-interaction-geometry";
import { placementWireSources } from "./placement-connectivity";

export interface PendingComponentPlacementSnap {
  position: Point;
  snap: SnapResult;
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
  rotation: 0 | 90 | 180 | 270;
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
  const projected = structuredClone(options.document);
  projected.instances.push(instance);
  const sources = placementWireSources(projected, options.resolver, instance);
  const movingAnchors = buildInstanceAnchors(
    projected,
    options.resolver,
    sources,
    new Set([instanceId]),
  );
  const routeTargets = movingAnchors.flatMap((moving): SnapAnchor[] => {
    if (moving.electrical?.kind !== "endpoint") return [];
    const movedPoint = {
      x: moving.point.x + rawDelta.x,
      y: moving.point.y + rawDelta.y,
    };
    return options.routeGeometryRecords.flatMap(({ route, geometry }) =>
      geometry.centerline.slice(0, -1).flatMap((from, segmentIndex) => {
        const point = closestPointOnSegment(
          movedPoint,
          from,
          geometry.centerline[segmentIndex + 1]!,
        );
        if (
          Math.hypot(point.x - movedPoint.x, point.y - movedPoint.y) >
          options.tolerance
        ) {
          return [];
        }
        return [
          {
            id: `placement-route:${moving.id}:${route.id}:${segmentIndex}`,
            point,
            kind: "route" as const,
            acceptsMovingAnchorId: moving.id,
            electrical: {
              kind: "route" as const,
              routeId: route.id,
              segmentIndex,
              netId: route.netId,
            },
          },
        ];
      }),
    );
  });
  const snap = resolveTranslationSnap({
    rawDelta,
    movingAnchors,
    targetAnchors: [
      ...sceneSnapTargetsExcluding(options.sceneSnapTargetIndex),
      ...routeTargets,
    ],
    primaryAnchorId: `instance:${instanceId}:origin`,
    grid: options.document.presentation.grid,
    tolerance: options.tolerance,
    profile: SNAP_PROFILES.instanceMove,
  });
  return {
    position: {
      x: basePosition.x + snap.delta.x,
      y: basePosition.y + snap.delta.y,
    },
    snap,
  };
}
