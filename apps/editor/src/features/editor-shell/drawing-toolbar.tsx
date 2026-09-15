import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { EditorTool } from "../../interaction/interaction-state";
import { ToolIcon } from "./tool-icon";
import {
  ArrowStylePicker,
  ArrowStyleIcon,
} from "../drafting/arrow-style-picker";
import {
  DEFAULT_ARROW_PRESET,
  type ArrowPreset,
} from "../drafting/arrow-presets";

interface ToolbarCommand {
  enabled: boolean;
  execute: () => void;
}

export interface DrawingToolbarProps {
  leftPanelMode: "examples" | "library";
  libraryPanelOpen: boolean;
  projectPanel: "netlist" | "project-code" | null;
  leftPanelsDisabled?: boolean;
  tool: EditorTool;
  arrowPreset?: ArrowPreset;
  onArrowPresetChange?: (preset: ArrowPreset) => void;
  documentSettingsOpen: boolean;
  undo: ToolbarCommand;
  redo: ToolbarCommand;
  simulation?: { open: boolean; onToggle: () => void };
  onToggleExamples: () => void;
  onToggleLibrary: () => void;
  onToggleNetlist: () => void;
  onToggleProjectCode: () => void;
  onInsert: () => void;
  onActivateTool: (tool: EditorTool) => void;
  onAddText: () => void;
  onOpenDocumentSettings: () => void;
}

function ImmediatePanelButton({
  testId,
  label,
  tooltip,
  pressed,
  controls,
  disabled,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  tooltip: string;
  pressed: boolean;
  controls?: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  const tooltipId = useId();
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const show = (target: HTMLElement): void => {
    const bounds = target.getBoundingClientRect();
    setPosition({
      left: bounds.left + bounds.width / 2,
      top: bounds.bottom + 6,
    });
  };
  return (
    <>
      <button
        type="button"
        className="draw-tool"
        aria-label={label}
        aria-describedby={position ? tooltipId : undefined}
        aria-pressed={pressed}
        aria-expanded={pressed}
        aria-controls={controls}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
        onPointerEnter={(event) => show(event.currentTarget)}
        onPointerLeave={() => setPosition(null)}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={() => setPosition(null)}
      >
        {children}
      </button>
      {position && typeof document !== "undefined"
        ? createPortal(
            <span
              id={tooltipId}
              role="tooltip"
              className="instant-toolbar-tooltip"
              style={position}
            >
              {tooltip}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

export function DrawingToolbar({
  leftPanelMode,
  libraryPanelOpen,
  projectPanel,
  leftPanelsDisabled = false,
  tool,
  arrowPreset = DEFAULT_ARROW_PRESET,
  onArrowPresetChange,
  documentSettingsOpen,
  undo,
  redo,
  onToggleExamples,
  onToggleLibrary,
  onToggleNetlist,
  onToggleProjectCode,
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
      <ImmediatePanelButton
        testId="examples-toggle"
        label="Circuit gallery"
        tooltip={
          examplesOpen ? "Hide the circuit gallery" : "Show the circuit gallery"
        }
        pressed={examplesOpen}
        controls="examples-panel"
        disabled={leftPanelsDisabled}
        onClick={onToggleExamples}
      >
        <ToolIcon name="examples" />
        <span>Gallery</span>
      </ImmediatePanelButton>
      <ImmediatePanelButton
        testId="library-toggle"
        label="Component library"
        tooltip={
          libraryPanelOpen ? "Hide component library" : "Show component library"
        }
        pressed={libraryOpen}
        controls="shapes-library-panel"
        disabled={leftPanelsDisabled}
        onClick={onToggleLibrary}
      >
        <ToolIcon name="library" />
        <span>Library</span>
      </ImmediatePanelButton>
      <ImmediatePanelButton
        testId="netlist-panel-toggle"
        label="Netlist"
        tooltip={projectPanel === "netlist" ? "Hide Netlist" : "Show Netlist"}
        pressed={projectPanel === "netlist"}
        onClick={onToggleNetlist}
      >
        <ToolIcon name="netlist" />
        <span>Netlist</span>
      </ImmediatePanelButton>
      <ImmediatePanelButton
        testId="project-code-toggle"
        label="Project Code"
        tooltip={
          projectPanel === "project-code"
            ? "Hide Project Code"
            : "Show Project Code"
        }
        pressed={projectPanel === "project-code"}
        onClick={onToggleProjectCode}
      >
        <ToolIcon name="project-code" />
        <span>Project Code</span>
      </ImmediatePanelButton>
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
      <div className="arrow-split-tool">
        <button
          type="button"
          className="draw-tool"
          data-testid="draw-tool-arrow"
          aria-pressed={tool === "arrow"}
          title="Arrow"
          onClick={() => onActivateTool("arrow")}
        >
          <ArrowStyleIcon preset={arrowPreset} />
          <span>Arrow</span>
        </button>
        <ArrowStylePicker
          label="New arrow style"
          value={arrowPreset}
          onChange={(preset) => {
            onActivateTool("arrow");
            onArrowPresetChange?.(preset);
          }}
        />
      </div>
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
        title="Circle"
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
