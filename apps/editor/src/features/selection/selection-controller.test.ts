import { describe, expect, it } from "vitest";

import { selectionReducer } from "./selection-controller";
import { EMPTY_VISUAL_SELECTION } from "./visual-selection";

const mixedSelection = {
  instanceIds: ["M1"],
  routeIds: ["route-1"],
  junctionIds: ["junction-1"],
  annotationIds: ["annotation-1"],
  draftingIds: ["drawing-1"],
};

describe("selectionReducer", () => {
  it("selects one object kind atomically", () => {
    expect(
      selectionReducer(mixedSelection, {
        type: "select-only",
        kind: "route",
        ids: ["route-2"],
      }),
    ).toEqual({ ...EMPTY_VISUAL_SELECTION, routeIds: ["route-2"] });
  });

  it("toggles additive instance selection while preserving mixed marquee kinds", () => {
    const added = selectionReducer(mixedSelection, {
      type: "select-object",
      kind: "instance",
      id: "M2",
      additive: true,
    });
    expect(added).toEqual({
      ...mixedSelection,
      instanceIds: ["M1", "M2"],
    });
    expect(
      selectionReducer(added, {
        type: "select-object",
        kind: "instance",
        id: "M1",
        additive: true,
      }).instanceIds,
    ).toEqual(["M2"]);
  });

  it("toggles annotations and drafting objects without clearing mixed selection", () => {
    const withoutAnnotation = selectionReducer(mixedSelection, {
      type: "select-object",
      kind: "annotation",
      id: "annotation-1",
      additive: true,
    });
    expect(withoutAnnotation.annotationIds).toEqual([]);
    expect(withoutAnnotation.instanceIds).toEqual(["M1"]);

    const withDrafting = selectionReducer(withoutAnnotation, {
      type: "select-object",
      kind: "drafting",
      id: "drawing-2",
      additive: true,
    });
    expect(withDrafting.draftingIds).toEqual(["drawing-1", "drawing-2"]);
    expect(withDrafting.routeIds).toEqual(["route-1"]);
  });

  it("preserves and normalizes intentional mixed selection", () => {
    expect(
      selectionReducer(EMPTY_VISUAL_SELECTION, {
        type: "replace",
        selection: {
          ...mixedSelection,
          instanceIds: ["M1", "M1"],
          routeIds: ["route-1", "route-1"],
        },
      }),
    ).toEqual(mixedSelection);
  });

  it("can replace or clear selected kinds without disturbing the rest", () => {
    const replaced = selectionReducer(mixedSelection, {
      type: "replace-kind",
      kind: "annotation",
      ids: ["annotation-2"],
    });
    expect(replaced.annotationIds).toEqual(["annotation-2"]);
    expect(replaced.routeIds).toEqual(["route-1"]);
    expect(
      selectionReducer(replaced, {
        type: "clear-kinds",
        kinds: ["route", "annotation", "drafting"],
      }),
    ).toEqual({
      ...EMPTY_VISUAL_SELECTION,
      instanceIds: ["M1"],
      junctionIds: ["junction-1"],
    });
  });

  it("resets every selected kind", () => {
    expect(selectionReducer(mixedSelection, { type: "reset" })).toEqual(
      EMPTY_VISUAL_SELECTION,
    );
  });
});
