import { describe, expect, it } from "vitest";

import { resolveEditorShortcut, stepBoundedScale } from "./editor-shortcuts";
import type {
  EditorShortcutContext,
  EditorShortcutKey,
} from "./editor-shortcuts";

const baseContext: EditorShortcutContext = {
  isTyping: false,
  interactionMode: "idle",
  hasRoutedMarkerSelection: false,
  hasRotatableSelection: false,
  hasDraftingSelection: false,
  hasInspectableSelection: false,
  hasRouteSelection: false,
  hasHighlightableNet: false,
  wireReadyToFinish: false,
  draftingReadyToFinish: false,
  helpOpen: false,
  canvasDragActive: false,
  hasClearableDraftingSelection: false,
  hasRemovableWireWaypoint: false,
};

function key(
  value: string,
  modifiers: Partial<Omit<EditorShortcutKey, "key">> = {},
): EditorShortcutKey {
  return {
    key: value,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

function resolve(
  value: string,
  context: Partial<EditorShortcutContext> = {},
  modifiers: Partial<Omit<EditorShortcutKey, "key">> = {},
) {
  return resolveEditorShortcut(key(value, modifiers), {
    ...baseContext,
    ...context,
  });
}

describe("editor shortcut contract", () => {
  it("maps history and file chord shortcuts without stealing copy/paste chords", () => {
    expect(resolve("u")).toEqual({ kind: "undo" });
    expect(resolve("u", {}, { shiftKey: true })).toEqual({ kind: "redo" });
    expect(resolve("z", {}, { ctrlKey: true })).toEqual({ kind: "undo" });
    expect(resolve("z", {}, { ctrlKey: true, shiftKey: true })).toEqual({
      kind: "redo",
    });
    expect(resolve("s", {}, { ctrlKey: true })).toEqual({ kind: "save" });
    expect(resolve("s", {}, { metaKey: true })).toBeNull();
    expect(resolve("c", {}, { ctrlKey: true })).toBeNull();
    expect(resolve("v", {}, { ctrlKey: true })).toBeNull();
  });

  it("blocks browser refresh chords even while an editor field owns focus", () => {
    for (const modifiers of [
      { ctrlKey: true },
      { ctrlKey: true, shiftKey: true },
      { metaKey: true },
    ]) {
      expect(resolve("r", { isTyping: true }, modifiers)).toEqual({
        kind: "block-browser-refresh",
      });
    }
    expect(resolve("F5", { isTyping: true })).toEqual({
      kind: "block-browser-refresh",
    });
  });

  it("resolves R rotation and the two agreed mirror shortcuts", () => {
    expect(resolve("r")).toEqual({
      kind: "activate-tool",
      tool: "rectangle",
    });
    expect(resolve("r", { hasRotatableSelection: true })).toEqual({
      kind: "rotate",
      deltaDegrees: 90,
    });
    expect(
      resolve("r", { hasRotatableSelection: true }, { shiftKey: true }),
    ).toEqual({
      kind: "mirror",
      direction: "left-right",
    });
    expect(
      resolve("v", { hasRotatableSelection: true }, { shiftKey: true }),
    ).toEqual({
      kind: "mirror",
      direction: "top-bottom",
    });
  });

  it("opens insertion with I and gives placement rotation priority", () => {
    expect(resolve("i")).toEqual({ kind: "open-component-insert" });
    expect(
      resolve("r", {
        interactionMode: "placing-component",
        hasRotatableSelection: true,
      }),
    ).toEqual({ kind: "rotate-placement", deltaDegrees: 90 });
    expect(resolve("r", { interactionMode: "copy-placement" })).toEqual({
      kind: "rotate-copy-placement",
      deltaDegrees: 90,
    });
    expect(
      resolve(
        "r",
        { interactionMode: "placing-component" },
        { shiftKey: true },
      ),
    ).toEqual({ kind: "mirror-placement", direction: "left-right" });
    expect(
      resolve(
        "v",
        { interactionMode: "placing-component" },
        { shiftKey: true },
      ),
    ).toEqual({ kind: "mirror-placement", direction: "top-bottom" });
    expect(
      resolve("r", { interactionMode: "copy-placement" }, { shiftKey: true }),
    ).toEqual({ kind: "mirror-copy-placement", direction: "left-right" });
    expect(
      resolve("v", { interactionMode: "copy-placement" }, { shiftKey: true }),
    ).toEqual({ kind: "mirror-copy-placement", direction: "top-bottom" });
  });

  it("maps creation, fit, and marker commands", () => {
    expect(resolve("w")).toEqual({ kind: "activate-tool", tool: "wire" });
    expect(resolve("a")).toEqual({ kind: "activate-tool", tool: "arrow" });
    expect(resolve("k")).toEqual({
      kind: "activate-tool",
      tool: "construction-line",
    });
    expect(resolve("p")).toBeNull();
    expect(resolve("l")).toEqual({ kind: "net-label-selection-required" });
    expect(resolve("l", { hasRouteSelection: true })).toEqual({
      kind: "edit-net-label",
    });
    expect(
      resolve("l", { hasRouteSelection: true, interactionMode: "wire" }),
    ).toEqual({
      kind: "blocked-interaction-command",
      command: "Net Label",
    });
    expect(resolve("h")).toBeNull();
    expect(resolve("h", { hasHighlightableNet: true })).toEqual({
      kind: "toggle-net-highlight",
    });
    expect(resolve("q")).toEqual({ kind: "property-selection-required" });
    expect(resolve("q", { hasInspectableSelection: true })).toEqual({
      kind: "open-properties",
    });
    expect(resolve("g")).toBeNull();
    expect(resolve("t")).toEqual({ kind: "add-text" });
    expect(resolve("f")).toEqual({ kind: "fit-view" });
    expect(resolve("f", {}, { shiftKey: true })).toBeNull();
    expect(resolve("Home")).toEqual({ kind: "fit-view" });
    expect(resolve("x", { hasRoutedMarkerSelection: true })).toEqual({
      kind: "reverse-current-marker",
    });
    expect(resolve("x")).toBeNull();
  });

  it("gives Ctrl+A selection precedence over the plain Arrow shortcut", () => {
    expect(resolve("a", {}, { ctrlKey: true })).toEqual({
      kind: "select-all",
    });
  });

  it("resolves style steps only for a drafting selection", () => {
    expect(resolve("]")).toBeNull();
    expect(resolve("]", { hasDraftingSelection: true })).toEqual({
      kind: "step-drafting-style",
      target: "stroke",
      increase: true,
    });
    expect(
      resolve("[", { hasDraftingSelection: true }, { shiftKey: true }),
    ).toEqual({
      kind: "step-drafting-style",
      target: "arrow-head",
      increase: false,
    });
    expect(stepBoundedScale(1, [0.75, 1, 1.5, 2] as const, true)).toBe(1.5);
    expect(stepBoundedScale(2, [0.75, 1, 1.5, 2] as const, true)).toBe(2);
  });

  it("finishes wire before drafting when both contexts are presented", () => {
    expect(
      resolve("Enter", {
        wireReadyToFinish: true,
        draftingReadyToFinish: true,
      }),
    ).toEqual({ kind: "finish-wire" });
    expect(resolve("Enter", { draftingReadyToFinish: true })).toEqual({
      kind: "finish-drafting",
    });
  });

  it("encodes contextual Escape priority in one place", () => {
    expect(
      resolve("Escape", {
        helpOpen: true,
        canvasDragActive: true,
        interactionMode: "wire",
        hasClearableDraftingSelection: true,
      }),
    ).toEqual({ kind: "close-help" });
    expect(
      resolve("Escape", {
        canvasDragActive: true,
        interactionMode: "wire",
      }),
    ).toEqual({ kind: "cancel-canvas-drag" });
    expect(resolve("Escape", { interactionMode: "wire" })).toEqual({
      kind: "cancel-interaction",
    });
    expect(resolve("Escape", { hasClearableDraftingSelection: true })).toEqual({
      kind: "clear-drafting-selection",
    });
    expect(resolve("Escape")).toEqual({ kind: "cancel-passive" });
  });

  it("removes a pending wire bend before deleting selection", () => {
    expect(resolve("Delete", { hasRemovableWireWaypoint: true })).toEqual({
      kind: "remove-wire-waypoint",
    });
    expect(resolve("Backspace")).toEqual({ kind: "delete-selection" });
  });

  it("arbitrates competing commands while one interaction owns the canvas", () => {
    const active = { interactionMode: "drawing" as const };
    expect(resolve("c", active)).toEqual({
      kind: "blocked-interaction-command",
      command: "Copy",
    });
    expect(resolve("c", { interactionMode: "copy-placement" })).toEqual({
      kind: "copy",
    });
    expect(resolve("q", active)).toEqual({
      kind: "blocked-interaction-command",
      command: "Properties",
    });
    expect(resolve("Delete", active)).toEqual({
      kind: "blocked-interaction-command",
      command: "Delete",
    });
    expect(
      resolve("Delete", {
        interactionMode: "wire",
        hasInspectableSelection: true,
      }),
    ).toEqual({ kind: "delete-selection" });
    expect(resolve("i", active)).toEqual({ kind: "open-component-insert" });
    expect(resolve("w", active)).toEqual({
      kind: "activate-tool",
      tool: "wire",
    });
    expect(resolve("f", active)).toEqual({ kind: "fit-view" });
  });

  it("does not rotate a stale selection underneath another active tool", () => {
    expect(
      resolve("r", {
        interactionMode: "drawing",
        hasRotatableSelection: true,
      }),
    ).toEqual({ kind: "activate-tool", tool: "rectangle" });
    expect(
      resolve("r", {
        interactionMode: "placing-component",
        hasRotatableSelection: true,
      }),
    ).toEqual({ kind: "rotate-placement", deltaDegrees: 90 });
  });

  it("suppresses every global shortcut while typing", () => {
    for (const value of ["i", "r", "Escape", "Delete", "Enter"]) {
      expect(resolve(value, { isTyping: true })).toBeNull();
    }
    expect(resolve("s", { isTyping: true }, { ctrlKey: true })).toBeNull();
  });
});
