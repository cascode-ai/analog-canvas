import { describe, expect, it, vi } from "vitest";

import type { EditorTool } from "../interaction/interaction-state";
import {
  createEditorCommandRouter,
  type EditorCommandContext,
  type EditorCommandOperations,
} from "./editor-command";

function fixture(overrides: Partial<EditorCommandContext> = {}) {
  const context: EditorCommandContext = {
    interactionMode: "idle",
    activeTool: "pointer",
    hasDeletableSelection: true,
    canCopyVisualSelection: true,
    hasMoveSelection: true,
    hasAlignableSelection: true,
    hasRotatableSelection: true,
    hasMirrorableSelection: true,
    canTransformMove: true,
    hasInspectableSelection: true,
    propertiesOpen: false,
    canUndo: true,
    canRedo: true,
    helpOpen: false,
    canvasDragActive: false,
    hasClearableDraftingSelection: false,
    hasActiveNetHighlight: false,
    hasArmedVerb: false,
    ...overrides,
  };
  const operations: EditorCommandOperations = {
    closeHelp: vi.fn(),
    cancelCanvasDrag: vi.fn(),
    cancelInteraction: vi.fn(),
    clearDraftingSelection: vi.fn(),
    clearNetHighlight: vi.fn(),
    cancelPassive: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
    deleteSelection: vi.fn(),
    beginCopy: vi.fn(),
    copyVisualSelection: vi.fn(),
    beginMove: vi.fn(),
    alignSelection: vi.fn(),
    rotatePlacement: vi.fn(),
    rotateCopy: vi.fn(),
    rotateMove: vi.fn(),
    rotateSelection: vi.fn(),
    armRotate: vi.fn(),
    disarmVerb: vi.fn(),
    mirrorPlacement: vi.fn(),
    mirrorCopy: vi.fn(),
    mirrorMove: vi.fn(),
    mirrorSelection: vi.fn(),
    startInsert: vi.fn(),
    openInsert: vi.fn(),
    placeCellPin: vi.fn(),
    activateTool: vi.fn<(tool: EditorTool) => void>(),
    addText: vi.fn(),
    openProperties: vi.fn(),
    closeProperties: vi.fn(),
    panView: vi.fn(),
    fitView: vi.fn(),
    report: vi.fn(),
  };
  return {
    context,
    operations,
    router: createEditorCommandRouter({
      getContext: () => context,
      operations,
    }),
  };
}

describe("editor command router", () => {
  it("copies visual content without arming circuit copy or mutating history", () => {
    const { router, operations } = fixture();
    router.execute({ id: "selection.copy-image", format: "svg" });
    expect(operations.copyVisualSelection).toHaveBeenCalledWith("svg");
    expect(operations.beginCopy).not.toHaveBeenCalled();
    expect(operations.undo).not.toHaveBeenCalled();
    for (const override of [
      { canCopyVisualSelection: false },
      { canvasDragActive: true },
      { hasArmedVerb: true },
      { interactionMode: "copy-placement" as const },
    ]) {
      const blocked = fixture(override);
      expect(
        blocked.router.execute({ id: "selection.copy-image", format: "png" })
          .status,
      ).toBe("rejected");
      expect(blocked.operations.copyVisualSelection).not.toHaveBeenCalled();
    }
  });
  it("routes every alignment surface through one selection command", () => {
    const { router, operations } = fixture();
    router.execute({ id: "selection.align", mode: "left" });
    expect(operations.alignSelection).toHaveBeenCalledWith("left");

    const unavailable = fixture({ hasAlignableSelection: false });
    expect(
      unavailable.router.state({ id: "selection.align", mode: "top" }),
    ).toMatchObject({ enabled: false });
    expect(
      unavailable.router.execute({ id: "selection.align", mode: "top" }).status,
    ).toBe("rejected");
    expect(unavailable.operations.alignSelection).not.toHaveBeenCalled();
  });

  it("keeps the established Escape priority in one command", () => {
    const help = fixture({
      helpOpen: true,
      canvasDragActive: true,
      interactionMode: "wire",
      hasClearableDraftingSelection: true,
    });
    help.router.execute({ id: "editor.cancel" });
    expect(help.operations.closeHelp).toHaveBeenCalledOnce();
    expect(help.operations.cancelCanvasDrag).not.toHaveBeenCalled();

    const interaction = fixture({ interactionMode: "placing-vdd-rail" });
    interaction.router.execute({ id: "editor.cancel" });
    expect(interaction.operations.cancelInteraction).toHaveBeenCalledWith(
      "placing-vdd-rail",
    );
  });

  it("clears an active Net highlight on Escape once nothing else is pending", () => {
    // Highlight alone: cancel is enabled and clears exactly the highlight.
    const highlightOnly = fixture({ hasActiveNetHighlight: true });
    expect(highlightOnly.router.state({ id: "editor.cancel" }).enabled).toBe(
      true,
    );
    highlightOnly.router.execute({ id: "editor.cancel" });
    expect(highlightOnly.operations.clearNetHighlight).toHaveBeenCalledOnce();
    expect(highlightOnly.operations.cancelPassive).not.toHaveBeenCalled();

    // A drafting selection still outranks the highlight in the Escape order.
    const layered = fixture({
      hasActiveNetHighlight: true,
      hasClearableDraftingSelection: true,
    });
    layered.router.execute({ id: "editor.cancel" });
    expect(layered.operations.clearDraftingSelection).toHaveBeenCalledOnce();
    expect(layered.operations.clearNetHighlight).not.toHaveBeenCalled();
  });

  it("routes one Rotate command to the active domain", () => {
    const selected = fixture();
    selected.router.execute({ id: "transform.rotate" });
    expect(selected.operations.rotateSelection).toHaveBeenCalledWith(90);

    const placement = fixture({ interactionMode: "placing-component" });
    placement.router.execute({ id: "transform.rotate", deltaDegrees: -90 });
    expect(placement.operations.rotatePlacement).toHaveBeenCalledWith(-90);

    const copy = fixture({ interactionMode: "copy-placement" });
    copy.router.execute({ id: "transform.rotate" });
    expect(copy.operations.rotateCopy).toHaveBeenCalledWith(90);

    const move = fixture({ interactionMode: "moving-selection" });
    move.router.execute({ id: "transform.rotate" });
    expect(move.operations.rotateMove).toHaveBeenCalledWith(90);
    expect(move.operations.rotateSelection).not.toHaveBeenCalled();
    move.router.execute({
      id: "transform.mirror",
      direction: "left-right",
    });
    expect(move.operations.mirrorMove).toHaveBeenCalledWith("left-right");
    expect(move.operations.mirrorSelection).not.toHaveBeenCalled();
  });

  it("keeps an unsupported Move transform inside the active session", () => {
    const { router, operations } = fixture({
      interactionMode: "moving-selection",
      canTransformMove: false,
    });
    expect(router.state({ id: "transform.rotate" })).toMatchObject({
      enabled: false,
    });
    expect(router.execute({ id: "transform.rotate" }).status).toBe("rejected");
    expect(operations.rotateMove).not.toHaveBeenCalled();
    expect(operations.rotateSelection).not.toHaveBeenCalled();
  });

  it("keeps Power Rail specialized and rejects generic transforms", () => {
    const { router, operations } = fixture({
      interactionMode: "placing-vdd-rail",
    });
    expect(router.state({ id: "transform.rotate" }).enabled).toBe(false);
    expect(router.execute({ id: "transform.rotate" })).toMatchObject({
      status: "rejected",
    });
    expect(operations.rotateSelection).not.toHaveBeenCalled();
    expect(operations.report).toHaveBeenCalledWith(
      "Rotate is unavailable for the current interaction",
    );
  });

  it("does not claim drafting mirroring when only rotation is implemented", () => {
    const { router, operations } = fixture({
      hasRotatableSelection: true,
      hasMirrorableSelection: false,
    });
    expect(
      router.state({
        id: "transform.mirror",
        direction: "left-right",
      }).enabled,
    ).toBe(false);
    router.execute({ id: "transform.mirror", direction: "left-right" });
    expect(operations.mirrorSelection).not.toHaveBeenCalled();
  });

  it("delegates insertion without flattening its specialized request", () => {
    const { router, operations } = fixture();
    const launch = { kind: "picker", scope: "cells" } as const;
    router.execute({ id: "insert.start", launch });
    expect(operations.startInsert).toHaveBeenCalledWith(launch);
  });

  it("publishes one active state for tool buttons and shortcuts", () => {
    const { router, operations } = fixture({ activeTool: "wire" });
    expect(router.state({ id: "tool.activate", tool: "wire" })).toEqual({
      enabled: true,
      active: true,
    });
    router.execute({ id: "tool.activate", tool: "arrow" });
    expect(operations.activateTool).toHaveBeenCalledWith("arrow");
  });

  it("routes camera panning through the shared command plane", () => {
    const { router, operations } = fixture({ interactionMode: "wire" });
    expect(router.state({ id: "view.pan", direction: "left" })).toEqual({
      enabled: true,
      active: false,
    });
    router.execute({ id: "view.pan", direction: "up" });
    expect(operations.panView).toHaveBeenCalledWith("up");
  });

  it("leaves history and tool re-entry lifecycle to their domain owners", () => {
    const history = fixture({ interactionMode: "moving-selection" });
    history.router.execute({ id: "history.undo" });
    expect(history.operations.cancelInteraction).not.toHaveBeenCalled();
    expect(history.operations.undo).toHaveBeenCalledOnce();

    const tool = fixture({ interactionMode: "copy-placement" });
    tool.router.execute({ id: "tool.activate", tool: "wire" });
    expect(tool.operations.cancelInteraction).not.toHaveBeenCalled();
    expect(tool.operations.activateTool).toHaveBeenCalledWith("wire");
  });

  it("preserves silent shortcut no-ops while publishing disabled menu state", () => {
    const { router, operations } = fixture({
      canUndo: false,
      canRedo: false,
      hasDeletableSelection: false,
      interactionMode: "wire",
    });

    expect(router.state({ id: "history.undo" }).enabled).toBe(false);
    expect(router.execute({ id: "history.undo" }).status).toBe("rejected");
    expect(router.execute({ id: "history.redo" }).status).toBe("rejected");
    expect(router.execute({ id: "selection.delete" }).status).toBe("rejected");
    expect(operations.report).not.toHaveBeenCalled();
  });

  it("lets verb commands execute while idle with nothing selected so they can arm", () => {
    // Cadence-style verb-first: with no selection, C / M / Delete reach their
    // operations, whose owner arms the verb and waits for a target click.
    const { router, operations } = fixture({
      hasDeletableSelection: false,
      hasMoveSelection: false,
    });
    expect(router.execute({ id: "selection.delete" }).status).toBe("executed");
    expect(operations.deleteSelection).toHaveBeenCalled();
    expect(router.execute({ id: "selection.move" }).status).toBe("executed");
    expect(operations.beginMove).toHaveBeenCalled();
    expect(router.execute({ id: "selection.copy" }).status).toBe("executed");
    expect(operations.beginCopy).toHaveBeenCalled();
  });

  it("Escape disarms an armed verb before touching passive state", () => {
    const { router, operations } = fixture({ hasArmedVerb: true });
    expect(router.state({ id: "editor.cancel" }).enabled).toBe(true);
    router.execute({ id: "editor.cancel" });
    expect(operations.disarmVerb).toHaveBeenCalled();
    expect(operations.cancelPassive).not.toHaveBeenCalled();
  });
});
