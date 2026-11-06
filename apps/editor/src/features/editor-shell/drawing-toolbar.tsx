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
  communityEnabled?: boolean;
  leftPanelMode: "examples" | "library" | "hierarchy";
  libraryPanelOpen: boolean;
  projectPanel: "netlist" | "project-code" | null;
  leftPanelsDisabled?: boolean;
  tool: EditorTool;
  styleProfileId: string;
  onStartInsert: (launch: InsertLaunch) => void;
  documentSettingsOpen: boolean;
  undo: ToolbarCommand;
  redo: ToolbarCommand;
  onToggleExamples: () => void;
  onToggleLibrary: () => void;
  /** The Cell tree shares the Library's place; absent, no toggle is shown. */
  onToggleHierarchy?: () => void;
  onToggleNetlist: () => void;
  onToggleProjectCode: () => void;
  onActivateTool: (tool: EditorTool) => void;
  onAddText: () => void;
  onOpenDocumentSettings: () => void;
  /** Every label back to the default size and look, in one undoable step. */
  resetLabels?: ToolbarCommand;
}

/** A toolbar button whose tooltip shows at once; icon-only tools rely on it. */
function ToolbarButton({
  testId,
  label,
  tooltip,
  shortcut,
  pressed,
  controls,
  disabled,
  iconOnly = false,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  tooltip: string;
  shortcut?: string;
  /** Toggles report their state; plain commands such as Undo leave it out. */
  pressed?: boolean;
  controls?: string;
  disabled?: boolean;
  iconOnly?: boolean;
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
      // The measured box and CSS translate can round to opposite subpixels in
      // Chromium. Keep a fractional guard so the rendered edge stays inside
      // the promised viewport margin after both calculations are applied.
      const transformRoundingGuard = 0.5;
      const halfWidth = tooltipElement.getBoundingClientRect().width / 2;
      const minimumLeft = margin + halfWidth + transformRoundingGuard;
      const maximumLeft = Math.max(
        minimumLeft,
        window.innerWidth - margin - halfWidth - transformRoundingGuard,
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
        className={iconOnly ? "draw-tool draw-tool-icon" : "draw-tool"}
        aria-label={label}
        aria-describedby={position ? tooltipId : undefined}
        aria-pressed={pressed}
        aria-expanded={controls ? pressed : undefined}
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
  communityEnabled = true,
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
  onToggleHierarchy,
  onToggleNetlist,
  onToggleProjectCode,
  onActivateTool,
  onAddText,
  onOpenDocumentSettings,
  resetLabels,
}: DrawingToolbarProps) {
  const examplesOpen = leftPanelMode === "examples" && libraryPanelOpen;
  const libraryOpen = leftPanelMode === "library" && libraryPanelOpen;
  const hierarchyOpen = leftPanelMode === "hierarchy" && libraryPanelOpen;

  return (
    <div
      className="toolbar-row draw-toolbar"
      aria-label="Drawing tools"
      data-testid="draw-toolbar"
    >
      <div className="draw-toolbar-panels" role="group" aria-label="Panels">
        {communityEnabled ? (
          <ToolbarButton
            testId="examples-toggle"
            label="Insert from Gallery"
            shortcut="G"
            tooltip={
              examplesOpen
                ? "Hide Insert from Gallery"
                : "Insert a circuit from the Gallery"
            }
            pressed={examplesOpen}
            controls="examples-panel"
            disabled={leftPanelsDisabled}
            onClick={onToggleExamples}
          >
            <ToolIcon name="examples" />
            <span>Insert</span>
          </ToolbarButton>
        ) : null}
        <ToolbarButton
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
        </ToolbarButton>
        {onToggleHierarchy ? (
          <ToolbarButton
            testId="hierarchy-toggle"
            label="Hierarchy"
            tooltip={
              hierarchyOpen
                ? "Hide the Cell hierarchy"
                : "Show the Cell hierarchy"
            }
            pressed={hierarchyOpen}
            controls="hierarchy-panel"
            disabled={leftPanelsDisabled}
            onClick={onToggleHierarchy}
          >
            <ToolIcon name="hierarchy" />
            <span>Hierarchy</span>
          </ToolbarButton>
        ) : null}
        <ToolbarButton
          testId="netlist-panel-toggle"
          label="Netlist"
          shortcut="N"
          tooltip={projectPanel === "netlist" ? "Hide Netlist" : "Show Netlist"}
          pressed={projectPanel === "netlist"}
          onClick={onToggleNetlist}
        >
          <ToolIcon name="netlist" />
          <span>Netlist</span>
        </ToolbarButton>
        <ToolbarButton
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
        </ToolbarButton>
      </div>
      <span className="draw-toolbar-divider" aria-hidden="true" />
      {/* Familiar tools are icons; their names and keys show on hover. */}
      <ToolbarButton
        testId="draw-tool-undo"
        label="Undo"
        tooltip="Undo"
        shortcut="Ctrl+Z"
        iconOnly
        disabled={!undo.enabled}
        onClick={undo.execute}
      >
        <ToolIcon name="undo" />
      </ToolbarButton>
      <ToolbarButton
        testId="draw-tool-redo"
        label="Redo"
        tooltip="Redo"
        shortcut="Ctrl+Shift+Z"
        iconOnly
        disabled={!redo.enabled}
        onClick={redo.execute}
      >
        <ToolIcon name="redo" />
      </ToolbarButton>
      <span className="draw-toolbar-divider" aria-hidden="true" />
      <ToolbarButton
        testId="draw-tool-wire"
        label="Wire"
        tooltip="Wire"
        shortcut="W"
        iconOnly
        pressed={tool === "wire"}
        onClick={() => onActivateTool("wire")}
      >
        <ToolIcon name="wire" />
      </ToolbarButton>
      <ToolbarButton
        testId="draw-tool-no-connect"
        label="No Connect"
        tooltip="No Connect: mark intentionally unused pins"
        iconOnly
        pressed={tool === "no-connect"}
        onClick={() => onActivateTool("no-connect")}
      >
        <ToolIcon name="no-connect" />
      </ToolbarButton>
      <ToolbarButton
        testId="draw-tool-text"
        label="Text"
        tooltip="Text"
        shortcut="T"
        iconOnly
        onClick={onAddText}
      >
        <ToolIcon name="text" />
      </ToolbarButton>
      <AnnotationMenu
        styleProfileId={styleProfileId}
        onStartInsert={onStartInsert}
      />
      <span className="toolbar-divider" aria-hidden="true" />
      {/* These icons say too little alone, so their names stay beside them. */}
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
      {resetLabels ? (
        <button
          type="button"
          className="draw-tool"
          data-testid="draw-tool-reset-labels"
          title="Reset labels: every label to the default size and look (italic first letter, upright subscript)"
          disabled={!resetLabels.enabled}
          onClick={resetLabels.execute}
        >
          <ToolIcon name="reset-labels" />
          <span>Reset labels</span>
        </button>
      ) : null}
    </div>
  );
}
