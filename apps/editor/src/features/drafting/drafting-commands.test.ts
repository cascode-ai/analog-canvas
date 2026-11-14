import { createEmptyDocument, resolveDrawingOrder } from "@icm/model";
import { executeTransaction } from "@icm/edit-engine";
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
      selection: {
        instanceIds: [],
        routeIds: [],
        junctionIds: [],
        annotationIds: [],
        draftingIds: ["a", "b", "locked"],
      },
      selectedDrafting: primary,
      inspectorSegment: null,
      transact,
      setStatus: vi.fn(),
      beginTextPlacement: vi.fn(),
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
  it("starts text placement without changing the document", () => {
    const document = createEmptyDocument("cell", "Cell");
    const transact = vi.fn(() => ({ ok: true }));
    const setStatus = vi.fn();
    const beginTextPlacement = vi.fn();
    const commands = createDraftingCommands({
      document,
      annotationGrid: 10,
      resolver: new InMemorySymbolResolver(builtInSymbols),
      selection: {
        instanceIds: [],
        routeIds: [],
        junctionIds: [],
        annotationIds: [],
        draftingIds: [],
      },
      selectedDrafting: undefined,
      inspectorSegment: null,
      transact,
      setStatus,
      beginTextPlacement,
    });

    commands.addPlainText();

    expect(beginTextPlacement).toHaveBeenCalledOnce();
    expect(transact).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("moves a shape across the circuit and past existing background peers", () => {
    let document = createEmptyDocument("cell", "Cell");
    const shape: Extract<DraftingObject, { kind: "rectangle" }> = {
      id: "box",
      kind: "rectangle",
      locked: false,
      zIndex: 2,
      anchor: { kind: "free", position: { x: 50, y: 50 } },
      center: { x: 50, y: 50 },
      width: 40,
      height: 20,
      rotation: 0,
      lineStyle: "solid",
    };
    const backgroundPeer: Extract<DraftingObject, { kind: "circle" }> = {
      id: "peer",
      kind: "circle",
      locked: false,
      zIndex: 0,
      layer: "background",
      anchor: { kind: "free", position: { x: 80, y: 50 } },
      center: { x: 80, y: 50 },
      radius: 10,
      lineStyle: "solid",
    };
    document.drafting = { objects: [backgroundPeer, shape] };
    document.instances = [
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    document.layoutGroups = [
      { id: "layout", kind: "custom", objectIds: ["box", "R1"], locked: false },
    ];
    const commands = createDraftingCommands({
      document,
      annotationGrid: 1,
      resolver: new InMemorySymbolResolver(builtInSymbols),
      selection: {
        instanceIds: [],
        routeIds: [],
        junctionIds: [],
        annotationIds: [],
        draftingIds: ["box"],
      },
      selectedDrafting: shape,
      inspectorSegment: null,
      transact(edits) {
        const result = executeTransaction(document, {
          transactionId: `drawing-${document.revision}`,
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "human", id: "test" },
          edits,
        });
        document = result.document;
        return result;
      },
      setStatus: vi.fn(),
      beginTextPlacement: vi.fn(),
    });

    commands.setDraftingStacking("back");
    expect(resolveDrawingOrder(document).slice(0, 2)).toEqual([
      { kind: "instance", id: "R1" },
      { kind: "drafting", id: "box" },
    ]);
    expect(document.drafting?.objects).toEqual([backgroundPeer, shape]);
    commands.setDraftingStacking("front");
    expect(resolveDrawingOrder(document).slice(-2)).toEqual([
      { kind: "instance", id: "R1" },
      { kind: "drafting", id: "box" },
    ]);
  });
});
