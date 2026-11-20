import type { SchematicEdit } from "@icm/edit-engine";
import type { GridRect, Instance, SchematicDocument } from "@icm/model";
import { instanceGroupDisplay, type SchematicStyleProfile } from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import { missingDefaultInstanceDisplayAnnotations } from "../instance-display/default-instance-display";

const HORIZONTAL_PITCH = 180;
const VERTICAL_PITCH = 140;
const VIEW_MARGIN = 80;

/**
 * Produces a conservative, deterministic first drawing for every retained
 * Instance. This is deliberately a placement shelf, not an analog-recognition
 * auto-layout: it never creates, deletes, or reconnects anything.
 */
export function planPlaceAllUnplacedInstances(
  document: SchematicDocument,
  viewBox: GridRect,
  onlyIds?: ReadonlySet<string>,
): SchematicEdit[] {
  const hidden = onlyIds ? undefined : instanceGroupDisplay(document)?.hidden;
  const byId = onlyIds
    ? new Map(document.instances.map((instance) => [instance.id, instance]))
    : undefined;
  const candidates = onlyIds
    ? [...onlyIds].map((id) => byId!.get(id))
    : document.instances;
  const unplaced = candidates.filter(
    (instance): instance is Instance =>
      instance?.placement === null && !hidden?.has(instance.id),
  );
  if (unplaced.length === 0) return [];

  const grid = document.presentation.grid;
  const pitchX = snapUp(HORIZONTAL_PITCH, grid);
  const pitchY = snapUp(VERTICAL_PITCH, grid);
  const startX = snapUp(viewBox.x + VIEW_MARGIN, grid);
  const placedBottom = document.instances.reduce(
    (bottom, instance) =>
      instance.placement === null
        ? bottom
        : Math.max(bottom, instance.placement.position.y + pitchY),
    Number.NEGATIVE_INFINITY,
  );
  const startY = Math.max(
    snapUp(viewBox.y + VIEW_MARGIN, grid),
    Number.isFinite(placedBottom) ? snapUp(placedBottom, grid) : 0,
  );
  const columns = Math.max(
    1,
    Math.floor((viewBox.width - VIEW_MARGIN * 2) / pitchX) + 1,
  );

  return unplaced.map((instance, index): SchematicEdit => ({
    kind: "place_instance",
    instanceId: instance.id,
    placement: {
      position: {
        x: startX + (index % columns) * pitchX,
        y: startY + Math.floor(index / columns) * pitchY,
      },
      rotation: 0,
      mirror: "none",
    },
  }));
}

function snapUp(value: number, grid: number): number {
  return Math.ceil(value / grid) * grid;
}

export function retainedPlacementDisplayEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  styleProfile: SchematicStyleProfile,
  edits: readonly SchematicEdit[],
): SchematicEdit[] {
  return edits.flatMap((edit) => {
    if (edit.kind !== "place_instance") return [];
    const instance = document.instances.find(
      ({ id }) => id === edit.instanceId,
    );
    if (!instance) return [];
    return missingDefaultInstanceDisplayAnnotations(
      document,
      { ...instance, placement: edit.placement },
      resolver,
      styleProfile,
    ).map((annotation) => ({
      kind: "upsert_schematic_annotation",
      annotation,
    }));
  });
}
