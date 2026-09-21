import type { SchematicEdit } from "@icm/edit-engine";
import { createEmptyDocument, DraftingObjectSchema } from "@icm/model";
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
      waypoints: [{ x: 50, y: 60 }],
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
        object: expect.objectContaining({
          id: "arrow-1",
          kind: "arrow",
          waypoints: [{ x: 50, y: 60 }],
        }),
      }),
    ]);
    expect(setTool).toHaveBeenCalledWith("pointer");
    expect(clear).toHaveBeenCalledOnce();
  });

  it("keeps a line arrow active while clicks add visible bends", () => {
    const setWaypoints = vi.fn();
    const transact = vi.fn(() => ({ ok: true }));
    const controller = createDraftingCreateController({
      document: createEmptyDocument("cell", "Cell"),
      angleMode: "free",
      annotationGrid: 5,
      resolver: new InMemorySymbolResolver(builtInSymbols),
      visibleEndpoints: [],
      routeGeometryRecords: [],
      tool: "arrow",
      source: { x: 10, y: 20 },
      hover: { x: 10, y: 20 },
      waypoints: [],
      setSource: vi.fn(),
      setHover: vi.fn(),
      setWaypoints,
      setSnapPoint: vi.fn(),
      clear: vi.fn(),
      setTool: vi.fn(),
      transact,
      setStatus: vi.fn(),
      nextId: () => "arrow-1",
    });

    controller.handleCanvasClick({ x: 43, y: 37 }, false, false, 4);

    expect(setWaypoints).toHaveBeenCalledOnce();
    expect(transact).not.toHaveBeenCalled();
    expect(
      (setWaypoints.mock.calls[0]![0] as (points: never[]) => unknown)([]),
    ).toEqual([{ x: 45, y: 35 }]);
  });

  it.each([
    {
      name: "unrepresentable point",
      target: { x: 205, y: 165 },
      pointer: { x: 205, y: 165 },
      captured: false,
      axes: [],
    },
    {
      name: "representable point",
      target: { x: 210, y: 170 },
      pointer: { x: 210, y: 170 },
      captured: true,
      axes: [],
    },
    {
      name: "unrepresentable axis",
      target: { x: 205, y: 300 },
      pointer: { x: 205, y: 165 },
      captured: false,
      axes: [],
    },
    {
      name: "representable axis",
      target: { x: 300, y: 170 },
      pointer: { x: 205, y: 170 },
      captured: true,
      axes: ["y"],
    },
  ])(
    "only indicates a rectangle snap that the final corner satisfies: $name",
    ({ target, pointer, captured, axes }) => {
      const document = createEmptyDocument("cell", "Cell");
      document.drafting = {
        objects: [
          {
            id: "target-line",
            kind: "construction-line",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: target },
            points: [target, { x: target.x + 20, y: target.y }],
            lineStyle: "solid",
          },
        ],
      };
      const controller = createDraftingCreateController({
        document,
        annotationGrid: 5,
        angleMode: "free",
        resolver: new InMemorySymbolResolver(builtInSymbols),
        visibleEndpoints: [],
        routeGeometryRecords: [],
        tool: "rectangle",
        source: { x: 100, y: 100 },
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
        nextId: () => "rectangle-1",
      });
      const resolved = controller.snapPoint(
        pointer,
        false,
        false,
        { x: 100, y: 100 },
        5,
      );
      expect(resolved.point).toEqual({ x: 210, y: 170 });
      expect(resolved.snap).toEqual(captured ? resolved.point : null);
      expect(resolved.guides.map((guide) => guide.axis)).toEqual(axes);
      for (const guide of resolved.guides)
        expect(guide.coordinate).toBe(resolved.point[guide.axis]);
    },
  );

  // A rectangle is a block outline somebody wires to, so it places on the
  // electrical grid whatever the annotation pitch is: an edge half a cell off
  // leaves a visible stub of wire inside the outline, because the wire can
  // only land on its own grid.
  it.each([
    { annotationGrid: 10, from: { x: 100, y: 100 }, to: { x: 210, y: 170 } },
    { annotationGrid: 10, from: { x: 210, y: 170 }, to: { x: 100, y: 100 } },
    { annotationGrid: 5, from: { x: 100, y: 100 }, to: { x: 205, y: 165 } },
    { annotationGrid: 5, from: { x: 205, y: 165 }, to: { x: 100, y: 100 } },
    { annotationGrid: 1, from: { x: 100, y: 100 }, to: { x: 201, y: 161 } },
  ])(
    "keeps rectangle corners on the electrical grid at annotation pitch $annotationGrid from $from to $to",
    ({ annotationGrid: grid, from, to }) => {
      const transact = vi.fn((_edits: SchematicEdit[]) => ({ ok: true }));
      const document = createEmptyDocument("cell", "Cell");
      const electricalGrid = document.presentation.grid;
      const controller = createDraftingCreateController({
        document,
        angleMode: "free",
        annotationGrid: grid,
        resolver: new InMemorySymbolResolver(builtInSymbols),
        visibleEndpoints: [],
        routeGeometryRecords: [],
        tool: "rectangle",
        source: from,
        hover: to,
        waypoints: [],
        setSource: vi.fn(),
        setHover: vi.fn(),
        setWaypoints: vi.fn(),
        setSnapPoint: vi.fn(),
        clear: vi.fn(),
        setTool: vi.fn(),
        transact,
        setStatus: vi.fn(),
        nextId: () => "rectangle-1",
      });
      // The first corner is snapped by the same rule as the second, so the
      // rectangle's own geometry is what the assertions below read.
      const startCorner = controller.snapPoint(from, false, false).point;
      const previewEnd = controller.snapPoint(to, false, false, from).point;
      // Alt suppresses object capture but must keep the same representable
      // rectangle; the model stores an integer center, even on the fine grid.
      expect(controller.snapPoint(to, true, false, from).point).toEqual(
        previewEnd,
      );
      controller.handleCanvasClick(to, false, false, grid);
      const edit = transact.mock.calls[0]?.[0]?.[0];
      if (edit?.kind !== "upsert_drafting_object")
        throw new Error("Missing edit");
      const object = DraftingObjectSchema.parse(edit.object);
      if (object.kind !== "rectangle") throw new Error("Missing rectangle");
      expect(object.center).toEqual({
        x: (startCorner.x + previewEnd.x) / 2,
        y: (startCorner.y + previewEnd.y) / 2,
      });
      expect(object.width).toBe(Math.abs(previewEnd.x - startCorner.x));
      expect(object.height).toBe(Math.abs(previewEnd.y - startCorner.y));
      expect(object.center.x - object.width / 2).toBe(
        Math.min(startCorner.x, previewEnd.x),
      );
      expect(object.center.y - object.height / 2).toBe(
        Math.min(startCorner.y, previewEnd.y),
      );
      for (const coordinate of [
        object.center.x - object.width / 2,
        object.center.x + object.width / 2,
        object.center.y - object.height / 2,
        object.center.y + object.height / 2,
      ]) {
        expect(coordinate % electricalGrid).toBe(0);
      }
      // Enter completion follows the same geometry as the second click.
      transact.mockClear();
      controller.finish();
      expect(transact).toHaveBeenCalledWith([
        { kind: "upsert_drafting_object", object },
      ]);
    },
  );

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

describe("polyline creation", () => {
  function setup(
    overrides: Partial<
      Parameters<typeof createDraftingCreateController>[0]
    > = {},
  ) {
    const transact = vi.fn((_edits: SchematicEdit[]) => ({ ok: true }));
    const setWaypoints = vi.fn();
    const clear = vi.fn();
    const controller = createDraftingCreateController({
      document: createEmptyDocument("main", "Main"),
      annotationGrid: 1,
      angleMode: "orthogonal",
      resolver: new InMemorySymbolResolver(builtInSymbols),
      visibleEndpoints: [],
      routeGeometryRecords: [],
      tool: "polyline",
      source: { x: 0, y: 0 },
      hover: { x: 80, y: 60 },
      waypoints: [{ x: 0, y: 60 }],
      setSource: vi.fn(),
      setHover: vi.fn(),
      setWaypoints,
      setSnapPoint: vi.fn(),
      clear,
      setTool: vi.fn(),
      transact,
      setStatus: vi.fn(),
      nextId: () => "polyline-1",
      ...overrides,
    });
    return { controller, transact, setWaypoints, clear };
  }
  it.each(["polyline", "arrow", "construction-line"] as const)(
    "constrains each new %s leg from the preceding vertex for preview and commit",
    (tool) => {
      const { controller, setWaypoints } = setup({ tool });
      const preview = controller.snapPoint({ x: 80, y: 65 }, true, false, {
        x: 0,
        y: 0,
      });
      expect(preview.point).toEqual({ x: 80, y: 60 });
      controller.handleCanvasClick({ x: 80, y: 65 }, true, false, 1);
      expect(setWaypoints.mock.calls[0]![0]([{ x: 0, y: 60 }])).toEqual([
        { x: 0, y: 60 },
        preview.point,
      ]);
    },
  );
  it("finishes a solid headless path and ignores repeated clicks on the last vertex", () => {
    const { controller, transact, setWaypoints, clear } = setup();
    controller.handleCanvasClick({ x: 0, y: 60 }, true, false, 1);
    expect(setWaypoints).not.toHaveBeenCalled();
    controller.finish();
    expect(transact).toHaveBeenCalledOnce();
    expect(transact.mock.calls[0]![0][0]).toMatchObject({
      kind: "upsert_drafting_object",
      object: {
        kind: "arrow",
        from: { position: { x: 0, y: 0 } },
        waypoints: [{ x: 0, y: 60 }],
        to: { position: { x: 80, y: 60 } },
        styleOverride: { arrowHead: "none" },
      },
    });
    expect(clear).toHaveBeenCalledOnce();
  });
  it("finishes a polygon by clicking the first vertex", () => {
    const { controller, transact, clear } = setup({
      angleMode: "free",
      waypoints: [
        { x: 0, y: 60 },
        { x: 80, y: 60 },
      ],
    });
    controller.handleCanvasClick({ x: 0, y: 0 }, true, false, 1);
    expect(transact.mock.calls[0]![0][0]).toMatchObject({
      object: {
        from: { position: { x: 0, y: 0 } },
        to: { position: { x: 0, y: 0 } },
        waypoints: [
          { x: 0, y: 60 },
          { x: 80, y: 60 },
        ],
      },
    });
    expect(clear).toHaveBeenCalledOnce();
  });
});
