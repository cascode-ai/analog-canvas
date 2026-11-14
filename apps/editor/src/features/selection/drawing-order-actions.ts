import type { SchematicEdit } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";

import type { ContextMenuAction } from "./canvas-context-menu";
import type { VisualSelection } from "./visual-selection";

type ReorderEdit = Extract<SchematicEdit, { kind: "reorder_drawing_objects" }>;

const DRAWING_ORDER_ACTIONS = [
  { label: "Bring to front", kind: "front" },
  { label: "Move up one layer", kind: "forward" },
  { label: "Move down one layer", kind: "backward" },
  { label: "Send to back", kind: "back" },
] as const;

export function selectedDrawingObjectIds(
  document: SchematicDocument,
  selection: VisualSelection,
): string[] {
  const drawn = new Set(
    document.instances
      .filter((instance) => instance.placement)
      .map((instance) => instance.id),
  );
  return [
    ...selection.instanceIds.filter((id) => drawn.has(id)),
    ...selection.draftingIds,
    ...selection.annotationIds,
  ];
}

export function drawingOrderActions(
  objectIds: string[],
  apply: (edit: ReorderEdit) => void,
): ContextMenuAction[] {
  if (objectIds.length === 0) return [];
  return DRAWING_ORDER_ACTIONS.map(({ label, kind }) => ({
    label,
    enabled: true,
    execute: () =>
      apply({ kind: "reorder_drawing_objects", objectIds, position: { kind } }),
  }));
}
