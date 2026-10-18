import type { SchematicDocument } from "@icm/model";

export type VisualSelectionKind =
  "instance" | "route" | "junction" | "annotation" | "drafting";

export interface VisualSelection {
  instanceIds: string[];
  routeIds: string[];
  junctionIds: string[];
  annotationIds: string[];
  draftingIds: string[];
}

export const EMPTY_VISUAL_SELECTION: VisualSelection = {
  instanceIds: [],
  routeIds: [],
  junctionIds: [],
  annotationIds: [],
  draftingIds: [],
};

const propertyByKind: Record<VisualSelectionKind, keyof VisualSelection> = {
  instance: "instanceIds",
  route: "routeIds",
  junction: "junctionIds",
  annotation: "annotationIds",
  drafting: "draftingIds",
};

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * The editor-only common selection contract. It intentionally contains IDs,
 * not persisted objects: model schemas keep their own semantic responsibilities.
 */
export function normalizeVisualSelection(
  selection: VisualSelection,
): VisualSelection {
  return {
    instanceIds: unique(selection.instanceIds),
    routeIds: unique(selection.routeIds),
    junctionIds: unique(selection.junctionIds),
    annotationIds: unique(selection.annotationIds),
    draftingIds: unique(selection.draftingIds),
  };
}

export function replaceVisualSelectionKind(
  selection: VisualSelection,
  kind: VisualSelectionKind,
  ids: readonly string[],
): VisualSelection {
  return normalizeVisualSelection({
    ...selection,
    [propertyByKind[kind]]: [...ids],
  });
}

export function clearVisualSelectionKinds(
  selection: VisualSelection,
  kinds: readonly VisualSelectionKind[],
): VisualSelection {
  let next = selection;
  for (const kind of kinds) {
    next = replaceVisualSelectionKind(next, kind, []);
  }
  return next;
}

export function hasVisualSelection(selection: VisualSelection): boolean {
  return Object.values(selection).some((ids) => ids.length > 0);
}

/**
 * Removes IDs whose persisted objects no longer exist after a committed edit.
 * Selection is transient editor state, so it must never outlive its model
 * object or leak a second removal into the next atomic transaction.
 */
export function pruneVisualSelection(
  selection: VisualSelection,
  document: SchematicDocument,
): VisualSelection {
  const instanceIds = new Set(document.instances.map((item) => item.id));
  const routeIds = new Set(document.routes.map((item) => item.id));
  const junctionIds = new Set(document.junctions.map((item) => item.id));
  const annotationIds = new Set(document.annotations.map((item) => item.id));
  const draftingIds = new Set(
    (document.drafting?.objects ?? []).map((item) => item.id),
  );
  const next: VisualSelection = {
    instanceIds: selection.instanceIds.filter((id) => instanceIds.has(id)),
    routeIds: selection.routeIds.filter((id) => routeIds.has(id)),
    junctionIds: selection.junctionIds.filter((id) => junctionIds.has(id)),
    annotationIds: selection.annotationIds.filter((id) =>
      annotationIds.has(id),
    ),
    draftingIds: selection.draftingIds.filter((id) => draftingIds.has(id)),
  };
  const unchanged = (Object.keys(next) as (keyof VisualSelection)[]).every(
    (key) =>
      next[key].length === selection[key].length &&
      next[key].every((id, index) => id === selection[key][index]),
  );
  return unchanged ? selection : next;
}

/** Both selections at once, each object once, `base`'s first. */
export function unionSelections(
  base: VisualSelection,
  added: VisualSelection,
): VisualSelection {
  const merge = (left: readonly string[], right: readonly string[]) => [
    ...new Set([...left, ...right]),
  ];
  return {
    instanceIds: merge(base.instanceIds, added.instanceIds),
    routeIds: merge(base.routeIds, added.routeIds),
    junctionIds: merge(base.junctionIds, added.junctionIds),
    annotationIds: merge(base.annotationIds, added.annotationIds),
    draftingIds: merge(base.draftingIds, added.draftingIds),
  };
}
