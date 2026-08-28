import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import { createDraftingCommands } from "./drafting-commands";

describe("drafting commands", () => {
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
