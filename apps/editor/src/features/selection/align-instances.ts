import type { SchematicDocument } from "@icm/model";
import type { SchematicEdit } from "@icm/edit-engine";
import type { SymbolResolver } from "@icm/symbols";

import { instanceHitBox } from "../wiring/route-interaction-geometry";

export type EdgeAlignmentMode =
  "left" | "h-center" | "right" | "top" | "v-center" | "bottom";

export const EDGE_ALIGNMENT_MODES: readonly {
  mode: EdgeAlignmentMode;
  label: string;
}[] = [
  { mode: "left", label: "Align left" },
  { mode: "h-center", label: "Align horizontal center" },
  { mode: "right", label: "Align right" },
  { mode: "top", label: "Align top" },
  { mode: "v-center", label: "Align vertical center" },
  { mode: "bottom", label: "Align bottom" },
];

/**
 * Bounding-box edge alignment as per-instance moves. `align_instances`
 * equalizes placement anchors, which only aligns edges for identically
 * sized symbols; edges need a per-instance delta, and expressing each as
 * a `move_instance` keeps the engine's route-follow and direct-contact
 * reconciliation on the exact same path an ordinary drag uses. Deltas are
 * rounded to the Document grid so pins stay on grid.
 */
export function proposeEdgeAlignmentEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  mode: EdgeAlignmentMode,
): SchematicEdit[] {
  const grid = document.presentation.grid;
  const boxed = instanceIds.flatMap((instanceId) => {
    const instance = document.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance?.placement) return [];
    const box = instanceHitBox(instance, resolver);
    return box ? [{ instance, box }] : [];
  });
  if (boxed.length < 2) return [];

  const measure = (box: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    switch (mode) {
      case "left":
        return box.x;
      case "h-center":
        return box.x + box.width / 2;
      case "right":
        return box.x + box.width;
      case "top":
        return box.y;
      case "v-center":
        return box.y + box.height / 2;
      case "bottom":
        return box.y + box.height;
    }
  };
  const measures = boxed.map(({ box }) => measure(box));
  const target =
    mode === "left" || mode === "top"
      ? Math.min(...measures)
      : mode === "right" || mode === "bottom"
        ? Math.max(...measures)
        : measures.reduce((sum, value) => sum + value, 0) / measures.length;
  const horizontal = mode === "left" || mode === "h-center" || mode === "right";

  return boxed.flatMap(({ instance, box }): SchematicEdit[] => {
    const delta = Math.round((target - measure(box)) / grid) * grid;
    if (delta === 0) return [];
    const position = instance.placement!.position;
    return [
      {
        kind: "move_instance",
        instanceId: instance.id,
        position: horizontal
          ? { x: position.x + delta, y: position.y }
          : { x: position.x, y: position.y + delta },
      },
    ];
  });
}
