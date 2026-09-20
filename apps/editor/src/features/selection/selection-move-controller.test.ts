import { createEmptyDocument, createRoutePath } from "@icm/model";
import { resolveRouteGeometry } from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";
import { createSelectionMoveController } from "./selection-move-controller";
import { planSelectionMove } from "./selection-move-plan";
import { EMPTY_VISUAL_SELECTION } from "./visual-selection";

describe("prepared instance movement", () => {
  it("shows the new branch while dragging a VDD pin off the middle of a wire", () => {
    const document = createEmptyDocument("tap", "Tap");
    document.instances.push({
      id: "VDD",
      symbolId: "vdd-port",
      placement: { position: { x: 100, y: 80 }, rotation: 0, mirror: "none" },
    });
    document.nets.push({
      id: "supply",
      terminals: [{ instanceId: "VDD", pinName: "P" }],
    });
    document.junctions.push(
      { id: "a", netId: "supply", position: { x: 0, y: 100 } },
      { id: "b", netId: "supply", position: { x: 200, y: 100 } },
    );
    document.routes.push(
      createRoutePath({
        id: "wire",
        netId: "supply",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const resolver = new InMemorySymbolResolver(builtInSymbols);
    const setStatus = vi.fn();
    const controller = createSelectionMoveController({
      document,
      resolver,
      visibleEndpoints: [],
      routeGeometryRecords: [],
      contactComponents: [],
      transactConnectivity: vi.fn(),
      setStatus,
      nextRoutingSuffix: () => 1,
    });
    const preview = {
      instanceIds: ["VDD"],
      primaryInstanceId: "VDD",
      originalPositions: { VDD: { x: 100, y: 80 } },
      pointerStart: { x: 100, y: 80 },
      movePlan: planSelectionMove(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["VDD"],
      }),
    };
    const moved = controller.resolveInstanceMove(
      preview,
      { x: 100, y: 20 },
      4,
      true,
    );
    expect(moved.preparationError).toBeUndefined();
    const prepared = moved.prepared!;
    expect(prepared.visualRoutePoints).toBeUndefined(); // Topology changed, so render the complete projected document.
    const paths = prepared.previewDocument.routes.map(
      (r) =>
        resolveRouteGeometry(prepared.previewDocument, resolver, r)!.centerline,
    );
    expect(paths).toContainEqual([
      { x: 100, y: 40 },
      { x: 100, y: 100 },
    ]);
    const committed = executeTransaction(
      document,
      {
        transactionId: "release",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: prepared.plan.edits,
      },
      { symbolResolver: resolver },
    );
    if (!committed.ok) throw new Error(committed.error.message);
    expect(
      committed.document.routes.map(
        (r) =>
          resolveRouteGeometry(committed.document, resolver, r)!.centerline,
      ),
    ).toEqual(paths);
    expect(setStatus).not.toHaveBeenCalled();
  });
  it("accepts a return to the gesture origin as a no-op, without an error or commit", () => {
    const document = createEmptyDocument("move", "Move");
    document.instances.push({
      id: "R",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    const transactConnectivity = vi.fn();
    const setStatus = vi.fn();
    const controller = createSelectionMoveController({
      document,
      resolver: new InMemorySymbolResolver(builtInSymbols),
      visibleEndpoints: [],
      routeGeometryRecords: [],
      contactComponents: [],
      transactConnectivity,
      setStatus,
      nextRoutingSuffix: () => 1,
    });
    const preview = {
      instanceIds: ["R"],
      primaryInstanceId: "R",
      originalPositions: { R: { x: 100, y: 100 } },
      pointerStart: { x: 100, y: 100 },
      movePlan: planSelectionMove(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R"],
      }),
    };
    const away = controller.resolveInstanceMove(
      preview,
      { x: 140, y: 100 },
      4,
      true,
    );
    expect(away.preparationError).toBeUndefined();
    expect(
      away.prepared?.previewDocument.instances[0]!.placement!.position.x,
    ).toBe(140);
    // Ordinary pointer frames project the typed plan without executing a
    // whole-Document transaction. Release owns validation and the revision.
    expect(away.prepared?.previewDocument.revision).toBe(document.revision);
    expect(away.prepared?.visualRoutePoints).toBeDefined();
    const restored = controller.resolveInstanceMove(
      preview,
      { x: 100, y: 100 },
      4,
      true,
    );
    expect(restored.preparationError).toBeUndefined();
    expect(restored.prepared?.previewDocument).toEqual(document);
    controller.completeInstanceMove(preview, { x: 100, y: 100 }, 4, true);
    expect(transactConnectivity).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });
});
