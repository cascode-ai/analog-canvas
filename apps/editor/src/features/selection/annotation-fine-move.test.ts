/**
 * Wire-transform audit batch 4, #11: moving a free annotation with the
 * selection preserves its fine (sub-device-grid) placement — the grid
 * discipline rides on the delta, exactly like the drafting branch.
 */
import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import type { SchematicEdit, RoutingOperationIntent } from "@icm/edit-engine";
import { describe, expect, it } from "vitest";

import { createSelectionMoveController } from "./selection-move-controller";
import { planSelectionMove } from "./selection-move-plan";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("free annotation fine placement (#11)", () => {
  it("a grid-aligned group move keeps the annotation's fine offset", () => {
    const document = createEmptyDocument("doc", "Fine");
    document.nets.push({ id: "net-a", terminals: [] });
    document.annotations.push({
      id: "note",
      kind: "route-marker",
      markerKind: "current",
      netId: "net-a",
      // Legal under the 1-unit annotation pitch (schema 29).
      anchor: { kind: "free", position: { x: 103, y: 57 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const captured: SchematicEdit[][] = [];
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [],
      routeGeometryRecords: [],
      contactComponents: [],
      transactConnectivity: (
        _intent: RoutingOperationIntent,
        edits: readonly SchematicEdit[],
      ) => {
        captured.push([...edits]);
        return { ok: true };
      },
      setStatus: () => {},
      nextRoutingSuffix: () => 1,
    });
    const movePlan = planSelectionMove(document, {
      instanceIds: [],
      routeIds: [],
      junctionIds: [],
      annotationIds: ["note"],
      draftingIds: [],
    });
    controller.completeVisualSelectionMove(movePlan, { x: 10, y: 0 });
    const upsert = captured
      .flat()
      .find((edit) => edit.kind === "upsert_schematic_annotation");
    expect(upsert).toBeDefined();
    if (upsert?.kind !== "upsert_schematic_annotation") throw new Error("kind");
    expect(upsert.annotation.anchor).toEqual({
      kind: "free",
      position: { x: 113, y: 57 },
    });
  });
});
