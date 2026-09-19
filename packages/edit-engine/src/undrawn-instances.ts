import type { Instance, SchematicDocument } from "@icm/model";

import type { SchematicEdit } from "./edit-schema.js";

type Placement = NonNullable<Instance["placement"]>;

const SHELF_MARGIN = 80;
const SHELF_PITCH_X = 180;
const SHELF_PITCH_Y = 140;
const SHELF_MAX_COLUMNS = 8;

export interface UndrawnInstancePlacement {
  readonly instanceId: string;
  readonly placement: Placement;
}

/**
 * Draws every Instance a Document still holds off-sheet.
 *
 * A schematic is what it shows. An Instance that keeps its reference, its Net
 * terminals and its netlist data while no symbol reaches the canvas is a device
 * nobody can see, select, or check, and it still reaches the exported netlist.
 * Legacy Documents are repaired by laying those Instances out on a
 * deterministic shelf below the existing drawing — never by discarding their
 * electrical facts. Placement is presentation, so this pass adds geometry only.
 */
export function planUndrawnInstancePlacements(
  document: SchematicDocument,
): UndrawnInstancePlacement[] {
  const undrawn = document.instances.filter(
    (instance) => instance.placement === null,
  );
  if (undrawn.length === 0) return [];

  const grid = document.presentation.grid;
  const pitchX = snapUp(SHELF_PITCH_X, grid);
  const pitchY = snapUp(SHELF_PITCH_Y, grid);
  const drawn = document.instances.flatMap((instance) =>
    instance.placement ? [instance.placement.position] : [],
  );
  const startX = snapUp(
    drawn.length > 0
      ? Math.min(...drawn.map((point) => point.x))
      : SHELF_MARGIN,
    grid,
  );
  const startY = snapUp(
    drawn.length > 0
      ? Math.max(...drawn.map((point) => point.y)) + pitchY
      : SHELF_MARGIN,
    grid,
  );
  const columns = Math.min(
    SHELF_MAX_COLUMNS,
    Math.max(1, Math.ceil(Math.sqrt(undrawn.length))),
  );

  return undrawn.map((instance, index) => ({
    instanceId: instance.id,
    placement: {
      position: {
        x: startX + (index % columns) * pitchX,
        y: startY + Math.floor(index / columns) * pitchY,
      },
      rotation: 0 as const,
      mirror: "none" as const,
    },
  }));
}

/** The same repair as a transaction, for callers that edit through the engine. */
export function planUndrawnInstanceDrawing(
  document: SchematicDocument,
): SchematicEdit[] {
  return planUndrawnInstancePlacements(document).map(
    ({ instanceId, placement }): SchematicEdit => ({
      kind: "place_instance",
      instanceId,
      placement,
    }),
  );
}

function snapUp(value: number, grid: number): number {
  return Math.ceil(value / grid) * grid;
}
