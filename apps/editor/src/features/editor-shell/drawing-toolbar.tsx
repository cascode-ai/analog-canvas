import type { EditorTool } from "../../interaction/interaction-state";
import { ToolIcon } from "./tool-icon";

interface ToolbarCommand {
  enabled: boolean;
  execute: () => void;
}

export interface DrawingToolbarProps {
  leftPanelMode: "examples" | "library";
  libraryPanelOpen: boolean;
  tool: EditorTool;
  documentSettingsOpen: boolean;
  undo: ToolbarCommand;
  redo: ToolbarCommand;
  simulation?: { open: boolean; onToggle: () => void };
  onToggleExamples: () => void;
  onToggleLibrary: () => void;
  onInsert: () => void;
  onActivateTool: (tool: EditorTool) => void;
  onAddText: () => void;
  onOpenDocumentSettings: () => void;
}

export function DrawingToolbar({
  leftPanelMode,
  libraryPanelOpen,
  tool,
  documentSettingsOpen,
  undo,
  redo,
  onToggleExamples,
  onToggleLibrary,
  onInsert,
  onActivateTool,
  onAddText,
  onOpenDocumentSettings,
  simulation,
}: DrawingToolbarProps) {
  const examplesOpen = leftPanelMode === "examples" && libraryPanelOpen;
  const libraryOpen = leftPanelMode === "library" && libraryPanelOpen;

  return (
    <div
      className="toolbar-row draw-toolbar"
      aria-label="Drawing tools"
      data-testid="draw-toolbar"
    >
      <button
        type="button"
        className="draw-tool examples-toggle"
        title={
          examplesOpen ? "Hide the circuit gallery" : "Show the circuit gallery"
        }
        aria-pressed={examplesOpen}
        aria-controls="examples-panel"
        aria-expanded={examplesOpen}
        data-testid="examples-toggle"
        onClick={onToggleExamples}
      >
        <ToolIcon name="examples" />
        <span>Gallery</span>
      </button>
      <button
        type="button"
        className="draw-tool"
        title={
          libraryPanelOpen ? "Hide component library" : "Show component library"
        }
        aria-pressed={libraryOpen}
        aria-controls="shapes-library-panel"
        aria-expanded={libraryOpen}
        data-testid="library-toggle"
        onClick={onToggleLibrary}
      >
        <ToolIcon name="library" />
        <span>Library</span>
      </button>
      <span className="draw-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-undo"
        title="Undo (Ctrl+Z)"
        onClick={undo.execute}
        disabled={!undo.enabled}
      >
        <ToolIcon name="undo" />
        <span>Undo</span>
      </button>
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-redo"
        title="Redo (Ctrl+Shift+Z)"
        onClick={redo.execute}
        disabled={!redo.enabled}
      >
        <ToolIcon name="redo" />
        <span>Redo</span>
      </button>
      <span className="draw-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-insert"
        title="Insert component (I)"
        onClick={onInsert}
      >
        <ToolIcon name="insert" />
        <span>Insert</span>
      </button>
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-wire"
        aria-pressed={tool === "wire"}
        title="Wire (W)"
        onClick={() => onActivateTool("wire")}
      >
        <ToolIcon name="wire" />
        <span>Wire</span>
      </button>
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-text"
        aria-label="Text"
        title="Text (T)"
        onClick={onAddText}
      >
        <ToolIcon name="text" />
        <span>Text</span>
      </button>
      <span className="toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-arrow"
        aria-pressed={tool === "arrow"}
        title="Arrow (A)"
        onClick={() => onActivateTool("arrow")}
      >
        <ToolIcon name="arrow" />
        <span>Arrow</span>
      </button>
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-line"
        aria-pressed={tool === "construction-line"}
        title="Construction line (K)"
        onClick={() => onActivateTool("construction-line")}
      >
        <ToolIcon name="line" />
        <span>Line</span>
      </button>
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-rectangle"
        aria-pressed={tool === "rectangle"}
        title="Rectangle (R)"
        onClick={() => onActivateTool("rectangle")}
      >
        <ToolIcon name="rectangle" />
        <span>Rect</span>
      </button>
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-circle"
        aria-pressed={tool === "circle"}
        title="Circle (O)"
        onClick={() => onActivateTool("circle")}
      >
        <ToolIcon name="circle" />
        <span>Circle</span>
      </button>
      <span className="toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-document-style"
        aria-pressed={documentSettingsOpen}
        title="Document settings"
        onClick={onOpenDocumentSettings}
      >
        <ToolIcon name="style" />
        <span>Style</span>
      </button>
      {simulation ? (
        <button
          type="button"
          className="draw-tool"
          data-testid="digital-simulation-toggle"
          aria-pressed={simulation.open}
          title="Digital Simulation"
          onClick={simulation.onToggle}
        >
          <ToolIcon name="simulation" />
          <span>Simulation</span>
        </button>
      ) : null}
    </div>
  );
}
