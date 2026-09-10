/**
 * User-facing index of every editor command chord owned by
 * `resolveEditorShortcut`. Browser-safety interceptions such as blocking F5
 * while work is unsaved are deliberately absent: they protect the document,
 * but they are not commands a user can invoke.
 *
 * Keep this beside the resolver so adding a keyboard command and documenting
 * it are one change. Quick Start renders the complete list rather than a
 * separately curated subset.
 */
export const EDITOR_SHORTCUT_REFERENCE = [
  { keys: ["Ctrl/Cmd", "F"], action: "Selection filter" },
  { keys: ["Ctrl/Cmd", "Shift", "F"], action: "Search circuit" },
  { keys: ["F"], action: "Fit view" },
  { keys: ["Home"], action: "Fit view" },
  { keys: ["Arrow keys"], action: "Pan view" },
  { keys: ["I"], action: "Insert component" },
  { keys: ["P"], action: "Place Cell Pin" },
  { keys: ["W"], action: "Draw wire" },
  { keys: ["F3"], action: "Wire options" },
  { keys: ["T"], action: "Add text" },
  { keys: ["A"], action: "Draw arrow" },
  { keys: ["K"], action: "Draw construction line" },
  { keys: ["O"], action: "Draw circle" },
  { keys: ["C"], action: "Copy and place selection" },
  { keys: ["M"], action: "Move selection" },
  { keys: ["Shift", "M"], action: "Move without wires" },
  { keys: ["R"], action: "Rotate selection / next object" },
  { keys: ["Shift", "R"], action: "Mirror left / right" },
  { keys: ["Ctrl/Cmd", "R"], action: "Mirror top / bottom" },
  { keys: ["Q"], action: "Toggle Properties" },
  { keys: ["L"], action: "Edit Net Label" },
  { keys: ["H"], action: "Toggle Net highlight" },
  { keys: ["X"], action: "Reverse current marker" },
  { keys: ["E"], action: "Enter selected Cell" },
  { keys: ["Shift", "E"], action: "Return to parent Cell" },
  { keys: ["["], action: "Decrease selected line width" },
  { keys: ["]"], action: "Increase selected line width" },
  { keys: ["Enter"], action: "Finish wire or drawing" },
  { keys: ["Delete"], action: "Delete / remove last wire bend" },
  { keys: ["Backspace"], action: "Delete / remove last wire bend" },
  { keys: ["Esc"], action: "Cancel active tool" },
  { keys: ["Ctrl/Cmd", "A"], action: "Select all" },
  { keys: ["Ctrl/Cmd", "D"], action: "Clear selection" },
  { keys: ["U"], action: "Undo" },
  { keys: ["Ctrl/Cmd", "Z"], action: "Undo" },
  { keys: ["Shift", "U"], action: "Redo" },
  { keys: ["Ctrl/Cmd", "Shift", "Z"], action: "Redo" },
  { keys: ["Ctrl/Cmd", "Y"], action: "Redo" },
  { keys: ["Ctrl/Cmd", "S"], action: "Save project" },
  { keys: ["Ctrl/Cmd", "O"], action: "Open project" },
] as const;
