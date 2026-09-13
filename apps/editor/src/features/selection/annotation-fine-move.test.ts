/** Selection movement keeps labels on their fine placement grid. */
import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import type { SchematicEdit, RoutingOperationIntent } from "@icm/edit-engine";
import { describe, expect, it } from "vitest";

import { createSelectionMoveController } from "./selection-move-controller";
import { planSelectionMove } from "./selection-move-plan";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("annotation group movement", () => {
  it("a grid-aligned group move keeps the annotation's fine offset", () => {
    const document = createEmptyDocument("doc", "Fine");
    document.nets.push({ id: "net-a", terminals: [] });
    document.annotations.push({
      id: "note",
      kind: "route-marker",
      markerKind: "current",
      netId: "net-a",
      // Legal under the 1-unit annotation pitch (since schema 30).
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

  it("moves multiple object-anchored labels by one shared delta", () => {
    const document = createEmptyDocument("doc", "Anchored labels");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 300, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.annotations.push(
      ...["R1", "R2"].map((instanceId) => ({
        id: `label-${instanceId}`,
        kind: "instance-label" as const,
        binding: { kind: "instance-reference" as const, instanceId },
        anchor: {
          kind: "object" as const,
          objectId: instanceId,
          localOffset: { x: 10, y: -20 },
          fallbackPosition: {
            x: instanceId === "R1" ? 110 : 310,
            y: 80,
          },
        },
        alignment: "start" as const,
        rotation: 0 as const,
        locked: false,
      })),
    );
    const captured: SchematicEdit[][] = [];
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [],
      routeGeometryRecords: [],
      contactComponents: [],
      transactConnectivity: (_intent, edits) => {
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
      annotationIds: ["label-R1", "label-R2"],
      draftingIds: [],
    });

    controller.completeVisualSelectionMove(movePlan, { x: 10, y: 20 });

    const anchors = captured
      .flat()
      .filter((edit) => edit.kind === "upsert_schematic_annotation")
      .map((edit) => edit.annotation.anchor);
    expect(anchors).toEqual([
      expect.objectContaining({
        kind: "object",
        localOffset: { x: 20, y: 0 },
        fallbackPosition: { x: 120, y: 100 },
      }),
      expect.objectContaining({
        kind: "object",
        localOffset: { x: 20, y: 0 },
        fallbackPosition: { x: 320, y: 100 },
      }),
    ]);
  });
});
