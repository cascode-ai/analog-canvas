import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import {
  constrainDraftingAngle,
  createDraftingCreateController,
} from "./drafting-create-controller";

describe("drafting create controller", () => {
  it("locks constrained points to 45-degree increments", () => {
    expect(constrainDraftingAngle({ x: 0, y: 0 }, { x: 31, y: 18 })).toEqual({
      x: 25,
      y: 25,
    });
  });

  it("finishes an arrow through one transaction and clears the session", () => {
    const transact = vi.fn(() => ({ ok: true }));
    const clear = vi.fn();
    const setTool = vi.fn();
    const controller = createDraftingCreateController({
      document: createEmptyDocument("cell", "Cell"),
      annotationGrid: 10,
      resolver: new InMemorySymbolResolver(builtInSymbols),
      visibleEndpoints: [],
      routeGeometryRecords: [],
      tool: "arrow",
      source: { x: 10, y: 20 },
      hover: { x: 90, y: 20 },
      waypoints: [],
      setSource: vi.fn(),
      setHover: vi.fn(),
      setWaypoints: vi.fn(),
      setSnapPoint: vi.fn(),
      clear,
      setTool,
      transact,
      setStatus: vi.fn(),
      nextId: () => "arrow-1",
    });

    controller.finish();

    expect(transact).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: "upsert_drafting_object",
        object: expect.objectContaining({ id: "arrow-1", kind: "arrow" }),
      }),
    ]);
    expect(setTool).toHaveBeenCalledWith("pointer");
    expect(clear).toHaveBeenCalledOnce();
  });

  it("creates a circle from its center and radius point", () => {
    const transact = vi.fn(() => ({ ok: true }));
    const controller = createDraftingCreateController({
      document: createEmptyDocument("cell", "Cell"),
      annotationGrid: 10,
      resolver: new InMemorySymbolResolver(builtInSymbols),
      visibleEndpoints: [],
      routeGeometryRecords: [],
      tool: "circle",
      source: { x: 20, y: 20 },
      hover: { x: 50, y: 60 },
      waypoints: [],
      setSource: vi.fn(),
      setHover: vi.fn(),
      setWaypoints: vi.fn(),
      setSnapPoint: vi.fn(),
      clear: vi.fn(),
      setTool: vi.fn(),
      transact,
      setStatus: vi.fn(),
      nextId: () => "circle-1",
    });

    controller.finish();

    expect(transact).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: "upsert_drafting_object",
        object: expect.objectContaining({
          id: "circle-1",
          kind: "circle",
          center: { x: 20, y: 20 },
          radius: 50,
          lineStyle: "solid",
        }),
      }),
    ]);
  });
});
