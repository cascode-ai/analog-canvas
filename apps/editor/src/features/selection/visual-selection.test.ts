import { createRoutePath } from "@icm/model";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "@icm/model";

import {
  EMPTY_VISUAL_SELECTION,
  clearVisualSelectionKinds,
  hasVisualSelection,
  normalizeVisualSelection,
  pruneVisualSelection,
  replaceVisualSelectionKind,
  unionSelections,
} from "./visual-selection";
import type { VisualSelection } from "./visual-selection";

describe("VisualSelection", () => {
  it("normalizes each visual object kind independently", () => {
    expect(
      normalizeVisualSelection({
        instanceIds: ["M1", "M1"],
        routeIds: ["r1", "r1"],
        junctionIds: ["j1"],
        annotationIds: ["a1", "a1"],
        draftingIds: ["note-1"],
      }),
    ).toEqual({
      instanceIds: ["M1"],
      routeIds: ["r1"],
      junctionIds: ["j1"],
      annotationIds: ["a1"],
      draftingIds: ["note-1"],
    });
  });

  it("replaces and clears only the requested object kinds", () => {
    const selected = replaceVisualSelectionKind(
      {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["M1"],
        annotationIds: ["label-M1"],
      },
      "route",
      ["r1", "r1"],
    );
    expect(selected).toEqual({
      instanceIds: ["M1"],
      routeIds: ["r1"],
      junctionIds: [],
      annotationIds: ["label-M1"],
      draftingIds: [],
    });
    expect(
      clearVisualSelectionKinds(selected, ["route", "annotation"]),
    ).toEqual({ ...EMPTY_VISUAL_SELECTION, instanceIds: ["M1"] });
    expect(hasVisualSelection(EMPTY_VISUAL_SELECTION)).toBe(false);
    expect(hasVisualSelection(selected)).toBe(true);
  });

  it("prunes transient IDs after their model objects are removed", () => {
    const document = createEmptyDocument("main", "Main");
    document.routes.push(
      createRoutePath({
        id: "route-1",
        netId: "net-1",
        start: { kind: "junction", junctionId: "junction-1" },
        end: { kind: "junction", junctionId: "junction-2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.annotations.push({
      id: "label-1",
      kind: "net-label",
      content: { runs: [{ kind: "text", value: "SIGNAL" }] },
      netId: "net-1",
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const selected: VisualSelection = {
      ...EMPTY_VISUAL_SELECTION,
      routeIds: ["route-1"],
      annotationIds: ["label-1", "label-deleted"],
    };

    const pruned = pruneVisualSelection(selected, document);
    expect(pruned).toEqual({
      ...EMPTY_VISUAL_SELECTION,
      routeIds: ["route-1"],
      annotationIds: ["label-1"],
    });
    expect(pruneVisualSelection(pruned, document)).toBe(pruned);
  });
});

describe("a Shift or Ctrl/Cmd box adds to the selection (2026-10-18)", () => {
  it("keeps what was selected and adds each boxed object once", () => {
    const base = {
      instanceIds: ["R1", "R2"],
      routeIds: ["w1"],
      junctionIds: [],
      annotationIds: [],
      draftingIds: [],
    };
    const boxed = {
      instanceIds: ["R2", "R3"],
      routeIds: [],
      junctionIds: ["j1"],
      annotationIds: ["label-1"],
      draftingIds: [],
    };
    expect(unionSelections(base, boxed)).toEqual({
      instanceIds: ["R1", "R2", "R3"],
      routeIds: ["w1"],
      junctionIds: ["j1"],
      annotationIds: ["label-1"],
      draftingIds: [],
    });
  });
});
