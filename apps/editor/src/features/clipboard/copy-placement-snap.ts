import { placementWireSources } from "@icm/edit-engine";
import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

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
} from "../../snap/engine";

/** Cache the same oriented geometry the copy ghost renders, outside pointer moves. */
export function copyPlacementAnchors(
  preview: SchematicDocument,
  resolver: SymbolResolver,
): SnapAnchor[] {
  return buildInstanceAnchors(
    preview,
    resolver,
    preview.instances.flatMap((instance) =>
      placementWireSources(preview, resolver, instance),
    ),
    new Set(preview.instances.map((instance) => instance.id)),
  );
}

export function snapPendingCopyPlacement(options: {
  movingAnchors: readonly SnapAnchor[];
  sceneSnapTargetIndex: SceneSnapTargetIndex;
  anchor: Point;
  position: Point;
  grid: number;
  tolerance: number;
}) {
  const primary = options.movingAnchors[0];
  if (!primary)
    return {
      point: {
        x: snapCoordinate(options.position.x, options.grid),
        y: snapCoordinate(options.position.y, options.grid),
      },
      guides: [],
    };
  const snap = resolveTranslationSnap({
    rawDelta: {
      x: options.position.x - options.anchor.x,
      y: options.position.y - options.anchor.y,
    },
    movingAnchors: options.movingAnchors,
    // Originals remain stationary and are useful alignment targets for a copy.
    targetAnchors: sceneSnapTargetsExcluding(options.sceneSnapTargetIndex),
    primaryAnchorId: primary.id,
    grid: options.grid,
    tolerance: options.tolerance,
    profile: SNAP_PROFILES.instanceMove,
  });
  return {
    point: {
      x: options.anchor.x + snap.delta.x,
      y: options.anchor.y + snap.delta.y,
    },
    guides: snap.guides,
  };
}
