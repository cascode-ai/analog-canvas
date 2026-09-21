import { useCallback, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { EditorTool } from "../../interaction/interaction-state";
import { ToolIcon } from "./tool-icon";
import type { InsertLaunch } from "../component-insert/insert-launch";
import { AnnotationMenu } from "./annotation-menu";

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
  styleProfileId: string;
  onStartInsert: (launch: InsertLaunch) => void;
  documentSettingsOpen: boolean;
  undo: ToolbarCommand;
  redo: ToolbarCommand;
  simulation?: { open: boolean; onToggle: () => void };
  onToggleExamples: () => void;
  onToggleLibrary: () => void;
  onToggleNetlist: () => void;
  onToggleProjectCode: () => void;
  onActivateTool: (tool: EditorTool) => void;
  onAddText: () => void;
  onOpenDocumentSettings: () => void;
}

function ImmediatePanelButton({
  testId,
  label,
  tooltip,
  shortcut,
  pressed,
  controls,
  disabled,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  tooltip: string;
  shortcut?: string;
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
  const keepTooltipInViewport = useCallback(
    (tooltipElement: HTMLSpanElement | null): void => {
      if (!tooltipElement || typeof window === "undefined") return;
      const margin = 8;
      const halfWidth = tooltipElement.getBoundingClientRect().width / 2;
      const minimumLeft = margin + halfWidth;
      const maximumLeft = Math.max(
        minimumLeft,
        window.innerWidth - margin - halfWidth,
      );
      setPosition((current) => {
        if (!current) return current;
        const left = Math.min(maximumLeft, Math.max(minimumLeft, current.left));
        return left === current.left ? current : { ...current, left };
      });
    },
    [],
  );
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
        aria-keyshortcuts={shortcut}
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
              ref={keepTooltipInViewport}
              id={tooltipId}
              role="tooltip"
              className="instant-toolbar-tooltip"
              style={position}
            >
              {tooltip}
              {shortcut ? ` (${shortcut})` : ""}
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
  styleProfileId,
  onStartInsert,
  documentSettingsOpen,
  undo,
  redo,
  onToggleExamples,
  onToggleLibrary,
  onToggleNetlist,
  onToggleProjectCode,
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
      <div className="draw-toolbar-panels" role="group" aria-label="Panels">
        <ImmediatePanelButton
          testId="examples-toggle"
          label="Circuit gallery"
          shortcut="G"
          tooltip={
            examplesOpen
              ? "Hide the circuit gallery"
              : "Show the circuit gallery"
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
          shortcut="B"
          tooltip={
            libraryPanelOpen
              ? "Hide component library"
              : "Show component library"
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
          shortcut="N"
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
      </div>
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
      <AnnotationMenu
        styleProfileId={styleProfileId}
        onStartInsert={onStartInsert}
      />
      <span className="toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-document-style"
        aria-pressed={documentSettingsOpen}
        title="Properties: Ports, canvas, and selected objects"
        onClick={onOpenDocumentSettings}
      >
        <ToolIcon name="style" />
        <span>Properties</span>
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
