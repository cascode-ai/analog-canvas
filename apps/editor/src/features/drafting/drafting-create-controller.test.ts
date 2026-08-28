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

  it("applies the persistent draw-angle mode without Shift", () => {
    const base = {
      document: createEmptyDocument("cell", "Cell"),
      annotationGrid: 1,
      resolver: new InMemorySymbolResolver(builtInSymbols),
      visibleEndpoints: [],
      routeGeometryRecords: [],
      tool: "construction-line" as const,
      source: { x: 0, y: 0 },
      hover: null,
      waypoints: [],
      setSource: vi.fn(),
      setHover: vi.fn(),
      setWaypoints: vi.fn(),
      setSnapPoint: vi.fn(),
      clear: vi.fn(),
      setTool: vi.fn(),
      transact: vi.fn(() => ({ ok: true })),
      setStatus: vi.fn(),
      nextId: () => "line-1",
    };
    const at = (angleMode: "free" | "45" | "orthogonal") =>
      createDraftingCreateController({ ...base, angleMode }).snapPoint(
        { x: 40, y: 9 },
        true,
        false,
        { x: 0, y: 0 },
      ).point;
    // Free keeps the raw direction; 45 locks to the diagonal family;
    // orthogonal locks to the nearest axis.
    expect(at("free")).toEqual({ x: 40, y: 9 });
    expect(at("orthogonal")).toEqual({ x: 41, y: 0 });
    const diag = at("45");
    expect(diag.y).toBe(0);
    // Shift still forces the 45-degree family even in free mode.
    expect(
      createDraftingCreateController({ ...base, angleMode: "free" }).snapPoint(
        { x: 30, y: 28 },
        true,
        true,
        { x: 0, y: 0 },
      ).point,
    ).toEqual({ x: 29, y: 29 });
  });

  it("finishes an arrow through one transaction and clears the session", () => {
    const transact = vi.fn(() => ({ ok: true }));
    const clear = vi.fn();
    const setTool = vi.fn();
    const controller = createDraftingCreateController({
      document: createEmptyDocument("cell", "Cell"),
      angleMode: "free",
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
      angleMode: "free",
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
