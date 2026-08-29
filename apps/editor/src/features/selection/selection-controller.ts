import { useReducer } from "react";

import {
  EMPTY_VISUAL_SELECTION,
  clearVisualSelectionKinds,
  normalizeVisualSelection,
  replaceVisualSelectionKind,
} from "./visual-selection";
import type { VisualSelection, VisualSelectionKind } from "./visual-selection";

export type SelectionAction =
  | { type: "replace"; selection: VisualSelection }
  | {
      type: "replace-kind";
      kind: VisualSelectionKind;
      ids: readonly string[];
    }
  | {
      type: "select-only";
      kind: VisualSelectionKind;
      ids: readonly string[];
    }
  | {
      type: "select-objects";
      kind: VisualSelectionKind;
      ids: readonly string[];
      additive: boolean;
    }
  | { type: "clear-kinds"; kinds: readonly VisualSelectionKind[] }
  | { type: "reset" };

export function selectionReducer(
  selection: VisualSelection,
  action: SelectionAction,
): VisualSelection {
  switch (action.type) {
    case "replace":
      return normalizeVisualSelection(action.selection);
    case "replace-kind":
      return replaceVisualSelectionKind(selection, action.kind, action.ids);
    case "select-only":
      return replaceVisualSelectionKind(
        EMPTY_VISUAL_SELECTION,
        action.kind,
        action.ids,
      );
    case "select-objects": {
      if (!action.additive) {
        return replaceVisualSelectionKind(
          EMPTY_VISUAL_SELECTION,
          action.kind,
          action.ids,
        );
      }
      const selectedIds = (() => {
        switch (action.kind) {
          case "instance":
            return selection.instanceIds;
          case "route":
            return selection.routeIds;
          case "junction":
            return selection.junctionIds;
          case "annotation":
            return selection.annotationIds;
          case "drafting":
            return selection.draftingIds;
        }
      })();
      return replaceVisualSelectionKind(
        selection,
        action.kind,
        action.ids.every((id) => selectedIds.includes(id))
          ? selectedIds.filter((id) => !action.ids.includes(id))
          : [...selectedIds, ...action.ids],
      );
    }
    case "clear-kinds":
      return clearVisualSelectionKinds(selection, action.kinds);
    case "reset":
      return EMPTY_VISUAL_SELECTION;
  }
}

export function useSelectionController() {
  const [selection, dispatch] = useReducer(
    selectionReducer,
    EMPTY_VISUAL_SELECTION,
  );

  return {
    selection,
    replace: (next: VisualSelection) =>
      dispatch({ type: "replace", selection: next }),
    replaceKind: (kind: VisualSelectionKind, ids: readonly string[]) =>
      dispatch({ type: "replace-kind", kind, ids }),
    selectOnly: (kind: VisualSelectionKind, ids: readonly string[]) =>
      dispatch({ type: "select-only", kind, ids }),
    selectObjects: (
      kind: VisualSelectionKind,
      ids: readonly string[],
      additive = false,
    ) => dispatch({ type: "select-objects", kind, ids, additive }),
    selectObject: (kind: VisualSelectionKind, id: string, additive = false) =>
      dispatch({ type: "select-objects", kind, ids: [id], additive }),
    selectInstance: (id: string, additive = false) =>
      dispatch({
        type: "select-objects",
        kind: "instance",
        ids: [id],
        additive,
      }),
    clearKinds: (kinds: readonly VisualSelectionKind[]) =>
      dispatch({ type: "clear-kinds", kinds }),
    reset: () => dispatch({ type: "reset" }),
  };
}
