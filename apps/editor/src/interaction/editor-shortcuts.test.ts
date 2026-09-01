import { describe, expect, it } from "vitest";

import { resolveEditorShortcut, stepBoundedScale } from "./editor-shortcuts";
import type {
  EditorShortcutContext,
  EditorShortcutKey,
} from "./editor-shortcuts";

const baseContext: EditorShortcutContext = {
  isTyping: false,
  hasUnsavedWork: true,
  interactionMode: "idle",
  hasRoutedMarkerSelection: false,
  canRotate: false,
  canMirror: false,
  hasDraftingSelection: false,
  hasInspectableSelection: false,
  hasRouteSelection: false,
  hasHighlightableNet: false,
  hasActiveNetHighlight: false,
  wireReadyToFinish: false,
  draftingReadyToFinish: false,
  hasRemovableWireWaypoint: false,
  propertiesOpen: false,
  hasHierarchyEnterSelection: false,
  canReturnToParent: false,
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

const command = (value: object) => ({ kind: "run-command", command: value });

describe("editor shortcut contract", () => {
  it("maps history and file chords on either command modifier without stealing copy/paste chords", () => {
    expect(resolve("u")).toEqual(command({ id: "history.undo" }));
    expect(resolve("u", {}, { shiftKey: true })).toEqual(
      command({ id: "history.redo" }),
    );
    // macOS presses Cmd where Windows presses Ctrl; a ctrl-only binding
    // leaves these chords to the browser there (Save Page, Open File,
    // history navigation), so meta is bound identically.
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(resolve("z", {}, modifiers)).toEqual(
        command({ id: "history.undo" }),
      );
      expect(resolve("z", {}, { ...modifiers, shiftKey: true })).toEqual(
        command({ id: "history.redo" }),
      );
      expect(resolve("y", {}, modifiers)).toEqual(
        command({ id: "history.redo" }),
      );
      expect(resolve("s", {}, modifiers)).toEqual({ kind: "save" });
      expect(resolve("o", {}, modifiers)).toEqual({ kind: "open" });
      expect(resolve("c", {}, modifiers)).toBeNull();
      expect(resolve("v", {}, modifiers)).toBeNull();
    }
  });

  it("arbitrates browser refresh chords before blocking their defaults", () => {
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
    expect(resolve("r", { canMirror: true }, { ctrlKey: true })).toEqual(
      command({ id: "transform.mirror", direction: "top-bottom" }),
    );
    expect(
      resolve(
        "r",
        { interactionMode: "placing-component", canMirror: true },
        { ctrlKey: true },
      ),
    ).toEqual(command({ id: "transform.mirror", direction: "top-bottom" }));
  });

  it("maps Ctrl+D to idle deselection while always blocking browser bookmarking", () => {
    expect(resolve("d", {}, { ctrlKey: true })).toEqual(
      command({ id: "selection.clear" }),
    );
    expect(
      resolve("d", { interactionMode: "wire" }, { ctrlKey: true }),
    ).toEqual({
      kind: "block-browser-bookmark",
    });
    expect(resolve("d", { isTyping: true }, { ctrlKey: true })).toEqual({
      kind: "block-browser-bookmark",
    });
  });

  it("resolves R rotation and the two agreed mirror shortcuts", () => {
    // R means rotate whether or not something is selected. With nothing
    // selected it arms the turn; it used to reach the rectangle tool, so one
    // key did two unrelated things depending on state.
    expect(resolve("r")).toEqual(command({ id: "transform.rotate-next" }));
    expect(resolve("r", { canRotate: true })).toEqual(
      command({ id: "transform.rotate", deltaDegrees: 90 }),
    );
    expect(resolve("r", { canMirror: true }, { shiftKey: true })).toEqual(
      command({ id: "transform.mirror", direction: "left-right" }),
    );
    expect(resolve("v", { canRotate: true }, { shiftKey: true })).toBeNull();
  });

  it("never reaches the rectangle tool from R", () => {
    for (const context of [
      {},
      { canRotate: true },
      { hasDraftingSelection: true },
      { interactionMode: "placing-component" as const },
    ]) {
      const resolved = resolve("r", context);
      expect(JSON.stringify(resolved)).not.toContain("rectangle");
    }
  });

  it("does not replace a selected non-rotatable drawing with a rectangle", () => {
    expect(resolve("r", { hasDraftingSelection: true })).toEqual({
      kind: "blocked-interaction-command",
      command: "Rotate",
    });
  });

  it("opens insertion with I and gives placement rotation priority", () => {
    expect(resolve("i")).toEqual(command({ id: "insert.open" }));
    expect(
      resolve("r", {
        interactionMode: "placing-component",
        canRotate: true,
      }),
    ).toEqual(command({ id: "transform.rotate", deltaDegrees: 90 }));
    expect(
      resolve("r", {
        interactionMode: "copy-placement",
        canRotate: true,
      }),
    ).toEqual(command({ id: "transform.rotate", deltaDegrees: 90 }));
    expect(
      resolve(
        "r",
        { interactionMode: "placing-component", canMirror: true },
        { shiftKey: true },
      ),
    ).toEqual(command({ id: "transform.mirror", direction: "left-right" }));
    expect(
      resolve(
        "r",
        { interactionMode: "copy-placement", canMirror: true },
        { shiftKey: true },
      ),
    ).toEqual(command({ id: "transform.mirror", direction: "left-right" }));
    expect(
      resolve("v", { interactionMode: "copy-placement" }, { shiftKey: true }),
    ).toBeNull();
  });

  it("maps creation, fit, and marker commands", () => {
    expect(resolve("w")).toEqual(
      command({ id: "tool.activate", tool: "wire" }),
    );
    expect(resolve("a")).toEqual(
      command({ id: "tool.activate", tool: "arrow" }),
    );
    expect(resolve("k")).toEqual(
      command({ id: "tool.activate", tool: "construction-line" }),
    );
    expect(resolve("o")).toEqual(
      command({ id: "tool.activate", tool: "circle" }),
    );
    expect(resolve("p")).toEqual(command({ id: "insert.cell-pin" }));
    expect(resolve("m")).toEqual(command({ id: "selection.move" }));
    // Virtuoso's pairing: M stretches the wires along with the part, Shift+M
    // leaves them where they are. Shift used to fall through to plain Move
    // because `plain` only excludes Ctrl/Meta/Alt.
    expect(resolve("m", {}, { shiftKey: true })).toEqual(
      command({ id: "selection.move", detach: true }),
    );
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
    // A showing highlight keeps H reachable with nothing selected, so a
    // highlight set by a diagnostic can always be toggled off.
    expect(resolve("h", { hasActiveNetHighlight: true })).toEqual({
      kind: "toggle-net-highlight",
    });
    expect(resolve("q")).toEqual(command({ id: "properties.open" }));
    expect(resolve("q", { hasInspectableSelection: true })).toEqual(
      command({ id: "properties.open" }),
    );
    expect(
      resolve("q", { propertiesOpen: true, hasInspectableSelection: true }),
    ).toEqual(command({ id: "properties.close" }));
    expect(resolve("q", { propertiesOpen: true })).toEqual(
      command({ id: "properties.close" }),
    );
    expect(resolve("g")).toBeNull();
    expect(resolve("t")).toEqual(command({ id: "drafting.add-text" }));
    expect(resolve("f")).toEqual(command({ id: "view.fit" }));
    expect(resolve("f", {}, { shiftKey: true })).toBeNull();
    expect(resolve("Home")).toEqual(command({ id: "view.fit" }));
    expect(resolve("x", { hasRoutedMarkerSelection: true })).toEqual({
      kind: "reverse-current-marker",
    });
    expect(resolve("x")).toBeNull();
  });

  it("maps unmodified arrow keys to camera pan commands", () => {
    expect(resolve("ArrowLeft")).toEqual(
      command({ id: "view.pan", direction: "left" }),
    );
    expect(resolve("ArrowRight")).toEqual(
      command({ id: "view.pan", direction: "right" }),
    );
    expect(resolve("ArrowUp", { interactionMode: "wire" })).toEqual(
      command({ id: "view.pan", direction: "up" }),
    );
    expect(resolve("ArrowDown", { interactionMode: "drawing" })).toEqual(
      command({ id: "view.pan", direction: "down" }),
    );
    expect(resolve("ArrowLeft", {}, { shiftKey: true })).toBeNull();
    expect(resolve("ArrowRight", { isTyping: true })).toBeNull();
  });

  it("opens Wire options with F3 only while Wire owns the canvas", () => {
    expect(resolve("F3")).toBeNull();
    expect(resolve("F3", { interactionMode: "wire" })).toEqual({
      kind: "toggle-wire-options",
    });
    expect(
      resolve("F3", { interactionMode: "wire", isTyping: true }),
    ).toBeNull();
  });

  it("enters a selected Cell with E and returns to its parent with Shift+E", () => {
    expect(resolve("e")).toEqual({ kind: "hierarchy-selection-required" });
    expect(resolve("e", { hasHierarchyEnterSelection: true })).toEqual({
      kind: "enter-hierarchy",
    });
    expect(
      resolve("e", { canReturnToParent: true }, { shiftKey: true }),
    ).toEqual({ kind: "return-to-parent" });
    expect(resolve("e", {}, { shiftKey: true })).toBeNull();
  });

  it("gives Ctrl+A and Cmd+A selection precedence over the plain Arrow shortcut", () => {
    expect(resolve("a", {}, { ctrlKey: true })).toEqual(
      command({ id: "selection.select-all" }),
    );
    // macOS sends Cmd+A for select-all; leaving meta unbound hands the chord
    // to the browser's DOM selection and the schematic selection never moves.
    expect(resolve("a", {}, { metaKey: true })).toEqual(
      command({ id: "selection.select-all" }),
    );
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

  it("maps Escape to the one contextual cancel command", () => {
    expect(resolve("Escape", { interactionMode: "wire" })).toEqual(
      command({ id: "editor.cancel" }),
    );
    expect(resolve("Escape")).toEqual(command({ id: "editor.cancel" }));
  });

  it("removes a pending wire bend before deleting selection", () => {
    expect(resolve("Delete", { hasRemovableWireWaypoint: true })).toEqual({
      kind: "remove-wire-waypoint",
    });
    expect(resolve("Backspace")).toEqual(command({ id: "selection.delete" }));
  });

  it("arbitrates competing commands while one interaction owns the canvas", () => {
    const active = { interactionMode: "drawing" as const };
    expect(resolve("c", active)).toEqual({
      kind: "blocked-interaction-command",
      command: "Copy",
    });
    expect(resolve("c", { interactionMode: "copy-placement" })).toEqual(
      command({ id: "selection.copy" }),
    );
    expect(resolve("m", active)).toEqual({
      kind: "blocked-interaction-command",
      command: "Move",
    });
    expect(resolve("m", { interactionMode: "moving-selection" })).toEqual(
      command({ id: "selection.move" }),
    );
    expect(resolve("q", active)).toEqual({
      kind: "blocked-interaction-command",
      command: "Properties",
    });
    expect(resolve("e", active)).toEqual({
      kind: "blocked-interaction-command",
      command: "Enter Cell",
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
    ).toEqual(command({ id: "selection.delete" }));
    expect(resolve("i", active)).toEqual(command({ id: "insert.open" }));
    expect(resolve("w", active)).toEqual(
      command({ id: "tool.activate", tool: "wire" }),
    );
    expect(resolve("f", active)).toEqual(command({ id: "view.fit" }));
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(resolve("a", active, modifiers)).toEqual({
        kind: "blocked-interaction-command",
        command: "Select All",
      });
    }
  });

  it("does not rotate a stale selection underneath another active tool", () => {
    expect(
      resolve("r", {
        interactionMode: "drawing",
        canRotate: false,
      }),
    ).toEqual({
      kind: "blocked-interaction-command",
      command: "Rotate or Mirror",
    });
    expect(
      resolve("r", {
        interactionMode: "placing-component",
        canRotate: true,
      }),
    ).toEqual(command({ id: "transform.rotate", deltaDegrees: 90 }));
  });

  it("routes Move secondary transforms without falling through to Rectangle", () => {
    expect(
      resolve("r", {
        interactionMode: "moving-selection",
        canRotate: true,
      }),
    ).toEqual(command({ id: "transform.rotate", deltaDegrees: 90 }));
    expect(
      resolve(
        "r",
        { interactionMode: "moving-selection", canMirror: true },
        { shiftKey: true },
      ),
    ).toEqual(
      command({
        id: "transform.mirror",
        direction: "left-right",
      }),
    );
    expect(
      resolve("r", {
        interactionMode: "moving-selection",
        canRotate: false,
      }),
    ).toEqual({
      kind: "blocked-interaction-command",
      command: "Rotate or Mirror",
    });
  });

  it("suppresses every global shortcut while typing", () => {
    for (const value of ["i", "r", "Escape", "Delete", "Enter", "q"]) {
      expect(resolve(value, { isTyping: true })).toBeNull();
    }
    expect(resolve("s", { isTyping: true }, { ctrlKey: true })).toBeNull();
    expect(resolve("s", { isTyping: true }, { metaKey: true })).toBeNull();
  });

  it("keeps typing suppressed with the Properties dock open, and Q blocked while interacting", () => {
    expect(resolve("q", { propertiesOpen: true, isTyping: true })).toBeNull();
    expect(
      resolve("q", { propertiesOpen: true, interactionMode: "drawing" }),
    ).toEqual({ kind: "blocked-interaction-command", command: "Properties" });
  });
});

describe("blank-circuit refresh", () => {
  it("lets the browser refresh when nothing is authored", () => {
    const empty = { ...baseContext, hasUnsavedWork: false };
    expect(
      resolveEditorShortcut(
        {
          key: "F5",
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        },
        empty,
      ),
    ).toBeNull();
    expect(
      resolveEditorShortcut(
        {
          key: "r",
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        },
        empty,
      ),
    ).toBeNull();
    expect(
      resolveEditorShortcut(
        {
          key: "F5",
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        },
        baseContext,
      ),
    ).toEqual({ kind: "block-browser-refresh" });
  });
});
