import type { SchematicEdit } from "@icm/edit-engine";
import type { EditorCommandRouter } from "../../commands/editor-command";
import { annotationOwningInstanceId } from "@icm/derived";
import type { DrawingObjectEntry, SchematicDocument } from "@icm/model";

import type { ContextMenuAction } from "./canvas-context-menu";
import type { VisualSelection } from "./visual-selection";
import { unionSelections } from "./visual-selection";
import type { SelectionPolicy } from "./selection-filter";

type ReorderEdit = Extract<SchematicEdit, { kind: "reorder_drawing_objects" }>;
export type DrawingReorderPosition = Exclude<
  ReorderEdit["position"],
  { kind: "insert" }
>;

export const DRAWING_ORDER_ACTIONS = [
  { label: "Bring to front", kind: "front", key: "Home", icon: "⇈" },
  { label: "Move up one layer", kind: "forward", key: "ArrowUp", icon: "↑" },
  {
    label: "Move down one layer",
    kind: "backward",
    key: "ArrowDown",
    icon: "↓",
  },
  { label: "Send to back", kind: "back", key: "End", icon: "⇊" },
] as const;

export interface DrawingDragRevision {
  sessionId: string;
  documentId: string;
  revision: number;
  structureRevision: number;
}

function expandDrawingGroups(
  document: SchematicDocument,
  seeds: readonly string[],
): Set<string> {
  const ids = new Set(seeds);
  if (!ids.size || !document.layoutGroups.length) return ids;
  const groupsByMember = new Map<string, SchematicDocument["layoutGroups"]>();
  for (const group of document.layoutGroups) {
    for (const id of group.objectIds) {
      const groups = groupsByMember.get(id);
      if (groups) groups.push(group);
      else groupsByMember.set(id, [group]);
    }
  }
  const visited = new Set<string>();
  // A group can overlap another group through a member. Visit each group once.
  for (const id of ids) {
    for (const group of groupsByMember.get(id) ?? []) {
      if (visited.has(group.id)) continue;
      visited.add(group.id);
      for (const member of group.objectIds) ids.add(member);
    }
  }
  return ids;
}

export function selectedDrawingObjectIds(
  document: SchematicDocument,
  selection: VisualSelection,
): string[] {
  const ids = expandDrawingGroups(document, [
    ...selection.instanceIds,
    ...selection.draftingIds,
    ...selection.annotationIds,
  ]);
  if (!ids.size) return [];
  return [
    ...document.instances.flatMap(({ id, placement }) =>
      placement && ids.has(id) ? [id] : [],
    ),
    ...document.annotations.flatMap(({ id }) => (ids.has(id) ? [id] : [])),
    ...(document.drafting?.objects ?? []).flatMap(({ id }) =>
      ids.has(id) ? [id] : [],
    ),
  ];
}

export function selectionForDrawingLayer(
  document: SchematicDocument,
  selectionPolicy: SelectionPolicy,
  entry: DrawingObjectEntry,
  current: VisualSelection,
  additive: boolean,
): VisualSelection {
  const ids = expandDrawingGroups(document, [entry.id]);
  const next = selectionPolicy.retainSelection({
    instanceIds: document.instances
      .filter(({ id, placement }) => placement && ids.has(id))
      .map(({ id }) => id),
    annotationIds: document.annotations
      .filter(({ id }) => ids.has(id))
      .map(({ id }) => id),
    draftingIds: (document.drafting?.objects ?? [])
      .filter(({ id }) => ids.has(id))
      .map(({ id }) => id),
    routeIds: [],
    junctionIds: [],
  });
  if (!additive) return next;
  const keys = ["instanceIds", "annotationIds", "draftingIds"] as const;
  if (!keys.every((key) => next[key].every((id) => current[key].includes(id))))
    return unionSelections(current, next);
  return {
    ...current,
    instanceIds: current.instanceIds.filter(
      (id) => !next.instanceIds.includes(id),
    ),
    annotationIds: current.annotationIds.filter(
      (id) => !next.annotationIds.includes(id),
    ),
    draftingIds: current.draftingIds.filter(
      (id) => !next.draftingIds.includes(id),
    ),
  };
}

/** A source Instance's annotations will be gathered by the transaction. */
export function drawingDragIncludes(
  document: SchematicDocument,
  objectIds: readonly string[],
  target: DrawingObjectEntry,
): boolean {
  if (objectIds.includes(target.id)) return true;
  if (target.kind !== "annotation") return false;
  const annotation = document.annotations.find(({ id }) => id === target.id);
  const owner = annotation && annotationOwningInstanceId(annotation);
  return Boolean(owner && objectIds.includes(owner));
}

export function drawingOrderActions(
  commands: EditorCommandRouter,
): ContextMenuAction[] {
  return DRAWING_ORDER_ACTIONS.map(({ label, kind }) => {
    const command = { id: "selection.reorder", position: { kind } } as const;
    return {
      label,
      enabled: commands.state(command).enabled,
      execute: () => commands.execute(command),
    };
  });
}
