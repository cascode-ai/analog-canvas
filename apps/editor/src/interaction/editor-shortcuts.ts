import type { InteractionMode } from "./interaction-state";
import type { EditorCommandRequest } from "../commands/editor-command";

export interface EditorShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface EditorShortcutContext {
  isTyping: boolean;
  /** Blank circuits let the browser refresh; there is nothing to protect. */
  hasUnsavedWork: boolean;
  interactionMode: InteractionMode;
  hasRoutedMarkerSelection: boolean;
  canRotate: boolean;
  canMirror: boolean;
  hasDraftingSelection: boolean;
  hasInspectableSelection: boolean;
  hasRouteSelection: boolean;
  hasHighlightableNet: boolean;
  /** A Net highlight is showing; H must stay reachable to clear it. */
  hasActiveNetHighlight: boolean;
  wireReadyToFinish: boolean;
  draftingReadyToFinish: boolean;
  hasRemovableWireWaypoint: boolean;
  propertiesOpen: boolean;
  hasHierarchyEnterSelection: boolean;
  canReturnToParent: boolean;
}

export type EditorShortcutIntent =
  | { kind: "run-command"; command: EditorCommandRequest }
  | { kind: "block-browser-refresh" }
  | { kind: "block-browser-bookmark" }
  | { kind: "save" | "open" }
  | { kind: "reverse-current-marker" }
  | { kind: "edit-net-label" | "net-label-selection-required" }
  | { kind: "toggle-net-highlight" }
  | {
      kind:
        "enter-hierarchy" | "return-to-parent" | "hierarchy-selection-required";
    }
  | {
      kind: "step-drafting-style";
      target: "stroke" | "arrow-head";
      increase: boolean;
    }
  | { kind: "finish-wire" | "finish-drafting" }
  | { kind: "toggle-wire-options" }
  | { kind: "remove-wire-waypoint" }
  | { kind: "blocked-interaction-command"; command: string };

export function stepBoundedScale<T extends number>(
  current: T,
  steps: readonly T[],
  increase: boolean,
): T {
  const index = steps.indexOf(current);
  const next = increase ? index + 1 : index - 1;
  const clamped = Math.max(0, Math.min(steps.length - 1, next < 0 ? 0 : next));
  return steps[clamped]!;
}

export function resolveEditorShortcut(
  event: EditorShortcutKey,
  context: EditorShortcutContext,
): EditorShortcutIntent | null {
  const key = event.key.toLowerCase();
  const commandModifier = event.ctrlKey || event.metaKey;
  if (
    event.key === "F3" &&
    !context.isTyping &&
    context.interactionMode === "wire"
  ) {
    return { kind: "toggle-wire-options" };
  }
  if (event.key === "F5") {
    return context.hasUnsavedWork ? { kind: "block-browser-refresh" } : null;
  }
  if (commandModifier && key === "r") {
    if (context.isTyping) {
      return context.hasUnsavedWork ? { kind: "block-browser-refresh" } : null;
    }
    if (context.canMirror)
      return {
        kind: "run-command",
        command: { id: "transform.mirror", direction: "top-bottom" },
      };
    return context.hasUnsavedWork ? { kind: "block-browser-refresh" } : null;
  }
  if (commandModifier && key === "d") {
    if (context.isTyping) return { kind: "block-browser-bookmark" };
    return context.interactionMode === "idle"
      ? { kind: "run-command", command: { id: "selection.clear" } }
      : { kind: "block-browser-bookmark" };
  }

  if (context.isTyping) return null;

  const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
  const interactionActive = context.interactionMode !== "idle";

  if (plain && key === "u") {
    return {
      kind: "run-command",
      command: { id: event.shiftKey ? "history.redo" : "history.undo" },
    };
  }
  // History and file chords answer to both command modifiers: macOS presses
  // Cmd where Windows presses Ctrl, and an unbound meta chord would fall
  // through to the browser (Save Page, Open File, history navigation).
  if (commandModifier && key === "z") {
    return {
      kind: "run-command",
      command: { id: event.shiftKey ? "history.redo" : "history.undo" },
    };
  }
  if (commandModifier && key === "y") {
    return { kind: "run-command", command: { id: "history.redo" } };
  }
  if (commandModifier && key === "s") return { kind: "save" };
  if (commandModifier && key === "o") return { kind: "open" };

  if (event.key === "Escape") {
    return { kind: "run-command", command: { id: "editor.cancel" } };
  }

  if (interactionActive) {
    if (commandModifier && key === "a") {
      return { kind: "blocked-interaction-command", command: "Select All" };
    }
    if (plain && key === "c") {
      return context.interactionMode === "copy-placement"
        ? { kind: "run-command", command: { id: "selection.copy" } }
        : { kind: "blocked-interaction-command", command: "Copy" };
    }
    if (plain && key === "m") {
      return context.interactionMode === "moving-selection"
        ? { kind: "run-command", command: { id: "selection.move" } }
        : { kind: "blocked-interaction-command", command: "Move" };
    }
    if (plain && key === "i") {
      return { kind: "run-command", command: { id: "insert.open" } };
    }
    if (plain && key === "w") {
      return {
        kind: "run-command",
        command: { id: "tool.activate", tool: "wire" },
      };
    }
    if (plain && key === "a") {
      return {
        kind: "run-command",
        command: { id: "tool.activate", tool: "arrow" },
      };
    }
    if (plain && key === "k") {
      return {
        kind: "run-command",
        command: { id: "tool.activate", tool: "construction-line" },
      };
    }
    if (plain && key === "o") {
      return {
        kind: "run-command",
        command: { id: "tool.activate", tool: "circle" },
      };
    }
    if (plain && event.shiftKey && key === "r" && context.canMirror) {
      return {
        kind: "run-command",
        command: { id: "transform.mirror", direction: "left-right" },
      };
    }
    if (plain && key === "r") {
      if (context.canRotate) {
        return {
          kind: "run-command",
          command: { id: "transform.rotate", deltaDegrees: 90 },
        };
      }
      // An active modal owner never lets R fall through to another primary
      // tool. Unsupported secondary transforms are rejected in place.
      return {
        kind: "blocked-interaction-command",
        command: "Rotate or Mirror",
      };
    }
    if (plain && key === "f" && !event.shiftKey) {
      return { kind: "run-command", command: { id: "view.fit" } };
    }
    if (plain && key === "home") {
      return { kind: "run-command", command: { id: "view.fit" } };
    }
    if (event.key === "Enter" && context.wireReadyToFinish) {
      return { kind: "finish-wire" };
    }
    if (event.key === "Enter" && context.draftingReadyToFinish) {
      return { kind: "finish-drafting" };
    }
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      context.hasRemovableWireWaypoint
    ) {
      return { kind: "remove-wire-waypoint" };
    }
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      context.interactionMode === "wire" &&
      context.hasInspectableSelection
    ) {
      return { kind: "run-command", command: { id: "selection.delete" } };
    }
    const blockedCommands: Record<string, string> = {
      c: "Copy",
      q: "Properties",
      l: "Net Label",
      m: "Move",
      t: "Text",
      h: "Net Highlight",
      x: "Current Marker",
      e: "Enter Cell",
      r: "Rotate or Mirror",
      "[": "Drafting Style",
      "]": "Drafting Style",
      delete: "Delete",
      backspace: "Delete",
    };
    const command = blockedCommands[key];
    return command ? { kind: "blocked-interaction-command", command } : null;
  }

  // Select All answers to both command modifiers: macOS presses Cmd+A, and
  // an unbound meta chord would fall through to the browser's DOM selection.
  if (commandModifier && key === "a") {
    return { kind: "run-command", command: { id: "selection.select-all" } };
  }

  if (plain && key === "e") {
    if (event.shiftKey) {
      return context.canReturnToParent ? { kind: "return-to-parent" } : null;
    }
    return context.hasHierarchyEnterSelection
      ? { kind: "enter-hierarchy" }
      : { kind: "hierarchy-selection-required" };
  }

  if (plain && key === "x" && context.hasRoutedMarkerSelection) {
    return { kind: "reverse-current-marker" };
  }
  if (plain && key === "c") {
    return { kind: "run-command", command: { id: "selection.copy" } };
  }
  if (plain && key === "m") {
    return { kind: "run-command", command: { id: "selection.move" } };
  }
  if (plain && key === "i") {
    return { kind: "run-command", command: { id: "insert.open" } };
  }
  if (plain && key === "p") {
    return { kind: "run-command", command: { id: "insert.cell-pin" } };
  }
  if (plain && key === "r") {
    if (event.shiftKey) {
      return context.canMirror
        ? {
            kind: "run-command",
            command: { id: "transform.mirror", direction: "left-right" },
          }
        : null;
    }
    if (context.canRotate) {
      return {
        kind: "run-command",
        command: { id: "transform.rotate", deltaDegrees: 90 },
      };
    }
    if (context.hasDraftingSelection) {
      return { kind: "blocked-interaction-command", command: "Rotate" };
    }
    // R means rotate, with or without something selected already. It used to
    // reach the rectangle tool when nothing was selected, so the key did two
    // unrelated things depending on state — press it meaning "turn this" and
    // get a rectangle. With nothing selected it now arms the turn and waits
    // for a part to be pointed at.
    return { kind: "run-command", command: { id: "transform.rotate-next" } };
  }
  if (plain && key === "w") {
    return {
      kind: "run-command",
      command: { id: "tool.activate", tool: "wire" },
    };
  }
  if (plain && key === "t") {
    return { kind: "run-command", command: { id: "drafting.add-text" } };
  }
  if (plain && key === "a") {
    return {
      kind: "run-command",
      command: { id: "tool.activate", tool: "arrow" },
    };
  }
  if (plain && key === "l" && context.interactionMode !== "wire") {
    return context.hasRouteSelection
      ? { kind: "edit-net-label" }
      : { kind: "net-label-selection-required" };
  }
  if (
    plain &&
    key === "h" &&
    (context.hasHighlightableNet || context.hasActiveNetHighlight)
  ) {
    return { kind: "toggle-net-highlight" };
  }
  if (plain && key === "k") {
    return {
      kind: "run-command",
      command: { id: "tool.activate", tool: "construction-line" },
    };
  }
  if (plain && key === "o") {
    return {
      kind: "run-command",
      command: { id: "tool.activate", tool: "circle" },
    };
  }
  if (plain && key === "q") {
    return {
      kind: "run-command",
      command: {
        id: context.propertiesOpen ? "properties.close" : "properties.open",
      },
    };
  }
  if (plain && key === "f" && !event.shiftKey) {
    return { kind: "run-command", command: { id: "view.fit" } };
  }
  if (plain && key === "home") {
    return { kind: "run-command", command: { id: "view.fit" } };
  }
  if (
    plain &&
    (event.key === "[" || event.key === "]") &&
    context.hasDraftingSelection
  ) {
    return {
      kind: "step-drafting-style",
      target: event.shiftKey ? "arrow-head" : "stroke",
      increase: event.key === "]",
    };
  }
  if (event.key === "Enter" && context.wireReadyToFinish) {
    return { kind: "finish-wire" };
  }
  if (event.key === "Enter" && context.draftingReadyToFinish) {
    return { kind: "finish-drafting" };
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    return context.hasRemovableWireWaypoint
      ? { kind: "remove-wire-waypoint" }
      : { kind: "run-command", command: { id: "selection.delete" } };
  }
  return null;
}
