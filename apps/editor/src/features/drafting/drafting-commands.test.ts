import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import { createDraftingCommands } from "./drafting-commands";
import { ARROW_PRESETS } from "./arrow-presets";
import type { DraftingObject } from "@icm/model";

describe("drafting commands", () => {
  it("restyles the editable arrow selection in one transaction, preserving locked peers", () => {
    const document = createEmptyDocument("cell", "Cell");
    const arrow = (id: string): Extract<DraftingObject, { kind: "arrow" }> => ({
      id,
      kind: "arrow",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      from: { kind: "free", position: { x: 0, y: 0 } },
      to: { kind: "free", position: { x: 100, y: 0 } },
    });
    const primary = arrow("a");
    const peer = arrow("b");
    document.drafting = {
      objects: [primary, peer, { ...arrow("locked"), locked: true }],
    };
    const transact = vi.fn(() => ({ ok: true }));
    const commands = createDraftingCommands({
      document,
      annotationGrid: 1,
      resolver: new InMemorySymbolResolver(builtInSymbols),
      viewBox: { x: 0, y: 0, width: 400, height: 300 },
      selection: {
        instanceIds: [],
        routeIds: [],
        junctionIds: [],
        annotationIds: [],
        draftingIds: ["a", "b", "locked"],
      },
      selectedDrafting: primary,
      inspectorSegment: null,
      selectedRoute: undefined,
      selectedRouteSegmentIndex: null,
      routeGeometryRecords: [],
      transact,
      setStatus: vi.fn(),
      nextId: () => "unused",
      beginTextEditing: vi.fn(),
      selectAnnotation: vi.fn(),
    });
    const outline = ARROW_PRESETS.find((p) => p.id === "outline-end")!;
    commands.setArrowPreset(outline);
    expect(transact).toHaveBeenCalledWith([
      expect.objectContaining({
        object: expect.objectContaining({ id: "a", outline: { width: 30 } }),
      }),
      expect.objectContaining({
        object: expect.objectContaining({ id: "b", outline: { width: 30 } }),
      }),
    ]);
    transact.mockClear();
    peer.curveControls = [{ x: 50, y: 30 }];
    commands.setArrowPreset(outline);
    expect(transact).not.toHaveBeenCalled();
    commands.setArrowPreset(ARROW_PRESETS.find((p) => p.id === "filled-both")!);
    expect(transact).toHaveBeenCalledTimes(1);
    expect(transact).toHaveBeenCalledWith([
      expect.objectContaining({ object: expect.objectContaining({ id: "a" }) }),
      expect.objectContaining({
        object: expect.objectContaining({
          id: "b",
          curveControls: peer.curveControls,
        }),
      }),
    ]);
  });
  it("adds centered drafting text and starts its editor", () => {
    const document = createEmptyDocument("cell", "Cell");
    const transact = vi.fn(() => ({ ok: true }));
    const setStatus = vi.fn();
    const beginTextEditing = vi.fn();
    const commands = createDraftingCommands({
      document,
      annotationGrid: 10,
      resolver: new InMemorySymbolResolver(builtInSymbols),
      viewBox: { x: 0, y: 0, width: 400, height: 300 },
      selection: {
        instanceIds: [],
        routeIds: [],
        junctionIds: [],
        annotationIds: [],
        draftingIds: [],
      },
      selectedDrafting: undefined,
      inspectorSegment: null,
      selectedRoute: undefined,
      selectedRouteSegmentIndex: null,
      routeGeometryRecords: [],
      transact,
      setStatus,
      nextId: () => "note-1",
      beginTextEditing,
      selectAnnotation: vi.fn(),
    });

    commands.addPlainText();

    expect(transact).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: "upsert_drafting_object",
        object: expect.objectContaining({
          id: "note-1",
          kind: "text",
          anchor: { kind: "free", position: { x: 200, y: 280 } },
        }),
      }),
    ]);
    expect(setStatus).toHaveBeenCalledWith("Added drafting text note-1");
    expect(beginTextEditing).toHaveBeenCalledWith(
      expect.objectContaining({ id: "note-1", kind: "text" }),
    );
  });
});
