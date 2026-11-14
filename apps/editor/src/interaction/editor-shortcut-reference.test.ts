import { describe, expect, it } from "vitest";

import { EDITOR_SHORTCUT_REFERENCE } from "./editor-shortcut-reference";

describe("editor shortcut reference", () => {
  it("lists every command chord Canvas Hints shows, in reading order", () => {
    expect(
      EDITOR_SHORTCUT_REFERENCE.map(
        ({ keys, action }) => `${keys.join("+")}: ${action}`,
      ),
    ).toEqual([
      "Ctrl/Cmd+F: Find in circuit",
      "Ctrl/Cmd+Shift+F: Choose selectable objects",
      "F: Fit view",
      "Home: Fit view",
      "Arrow keys: Pan view",
      "Alt+Shift+Home: Bring to front",
      "Alt+Shift+↑: Move up one layer",
      "Alt+Shift+↓: Move down one layer",
      "Alt+Shift+End: Send to back",
      "G: Toggle Gallery",
      "B: Toggle Component Library",
      "N: Toggle Netlist",
      "I: Insert component",
      "P: Place Cell Pin",
      "W: Draw wire",
      "F3: Wire options",
      "/: Cycle wire corner shape",
      "T: Add text",
      "O: Display settings",
      "C: Copy circuit selection",
      "V: Paste circuit selection",
      "Ctrl/Cmd+C: Copy circuit selection across tabs",
      "Ctrl/Cmd+V: Paste circuit selection",
      "M: Move selection",
      "Shift+M: Move without wires",
      "R: Rotate selection / next object",
      "Shift+R: Mirror left / right",
      "Ctrl/Cmd+R: Mirror top / bottom",
      "Q: Toggle Properties",
      "L: Create and place Net Label",
      "H: Toggle Net highlight",
      "E: Edit Component Definition / enter selected Cell",
      "Shift+E: Return to parent Cell",
      "[: Decrease selected line width",
      "]: Increase selected line width",
      "Enter: Finish wire or drawing",
      "Delete: Delete / remove last wire bend",
      "Backspace: Delete / remove last wire bend",
      "Esc: Cancel active tool",
      "Ctrl/Cmd+A: Select all",
      "Ctrl/Cmd+D: Clear selection",
      "U: Undo",
      "Ctrl/Cmd+Z: Undo",
      "Shift+U: Redo",
      "Ctrl/Cmd+Shift+Z: Redo",
      "Ctrl/Cmd+Y: Redo",
      "Ctrl/Cmd+S: Save project",
      "Ctrl/Cmd+O: Open project",
    ]);
  });
});
