import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { EditorTool } from "../../interaction/interaction-state";
import { ToolIcon } from "./tool-icon";
import type { InsertLaunch } from "../component-insert/insert-launch";
import { AnnotationMenu } from "./annotation-menu";
import type { LeftPanelMode } from "./use-editor-panels";

interface ToolbarCommand {
  enabled: boolean;
  execute: () => void;
}

export interface DrawingToolbarProps {
  communityEnabled?: boolean;
  leftPanelMode: LeftPanelMode;
  libraryPanelOpen: boolean;
  projectPanel: "netlist" | "testbench" | "project-code" | null;
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
  onToggleObjects?: () => void;
  /** Absent (the PowerPoint dialog), no Netlist or Project Code toggle. */
  onToggleNetlist?: () => void;
  /** The Cell's Testbench and Specs, beside the netlist (#2110). */
  onToggleTestbench?: () => void;
  onToggleProjectCode?: () => void;
  onActivateTool: (tool: EditorTool) => void;
  onAddText: () => void;
  onOpenDocumentSettings: () => void;
  /** Every label back to the default size and look, in one undoable step. */
  resetLabels?: ToolbarCommand;
}

/**
 * A toolbar button. `text` is the name shown beside its icon; a narrow window
 * hides it, and it then shows as the tooltip. A button without text has a
 * tooltip only if its icon does not say what it does. A tooltip shows at once
 * on hover or focus.
 */
function ToolbarButton({
  testId,
  label,
  text,
  tooltip = text,
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
  text?: string;
  tooltip?: string;
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
  const textRef = useRef<HTMLSpanElement>(null);
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
    // A name shown on the button already says it.
    if (!tooltip || textRef.current?.offsetWidth) return;
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
        {text ? <span ref={textRef}>{text}</span> : null}
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
  onToggleObjects,
  onToggleNetlist,
  onToggleTestbench,
  onToggleProjectCode,
  onActivateTool,
  onAddText,
  onOpenDocumentSettings,
  resetLabels,
}: DrawingToolbarProps) {
  const examplesOpen = leftPanelMode === "examples" && libraryPanelOpen;
  const libraryOpen = leftPanelMode === "library" && libraryPanelOpen;
  const hierarchyOpen = leftPanelMode === "hierarchy" && libraryPanelOpen;
  const objectsOpen = leftPanelMode === "objects" && libraryPanelOpen;

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
            text="Insert"
            shortcut="G"
            pressed={examplesOpen}
            controls="examples-panel"
            disabled={leftPanelsDisabled}
            onClick={onToggleExamples}
          >
            <ToolIcon name="examples" />
          </ToolbarButton>
        ) : null}
        <ToolbarButton
          testId="library-toggle"
          label="Component library"
          text="Library"
          shortcut="B"
          pressed={libraryOpen}
          controls="shapes-library-panel"
          disabled={leftPanelsDisabled}
          onClick={onToggleLibrary}
        >
          <ToolIcon name="library" />
        </ToolbarButton>
        {onToggleHierarchy ? (
          <ToolbarButton
            testId="hierarchy-toggle"
            label="Hierarchy"
            text="Hierarchy"
            pressed={hierarchyOpen}
            controls="hierarchy-panel"
            disabled={leftPanelsDisabled}
            onClick={onToggleHierarchy}
          >
            <ToolIcon name="hierarchy" />
          </ToolbarButton>
        ) : null}
        {onToggleObjects ? (
          <ToolbarButton
            testId="objects-layers-toggle"
            label="Objects & layers"
            text="Layers"
            pressed={objectsOpen}
            controls="objects-layers-panel"
            disabled={leftPanelsDisabled}
            onClick={onToggleObjects}
          >
            <ToolIcon name="layers" />
          </ToolbarButton>
        ) : null}
        {onToggleNetlist ? (
          <ToolbarButton
            testId="netlist-panel-toggle"
            label="Netlist"
            text="Netlist"
            shortcut="N"
            pressed={projectPanel === "netlist"}
            onClick={onToggleNetlist}
          >
            <ToolIcon name="netlist" />
          </ToolbarButton>
        ) : null}
        {onToggleTestbench ? (
          <ToolbarButton
            testId="testbench-panel-toggle"
            label="Testbench"
            text="Testbench"
            pressed={projectPanel === "testbench"}
            onClick={onToggleTestbench}
          >
            <ToolIcon name="testbench" />
          </ToolbarButton>
        ) : null}
        {onToggleProjectCode ? (
          <ToolbarButton
            testId="project-code-toggle"
            label="Project Code"
            text="Project Code"
            pressed={projectPanel === "project-code"}
            onClick={onToggleProjectCode}
          >
            <ToolIcon name="project-code" />
          </ToolbarButton>
        ) : null}
      </div>
      <span className="draw-toolbar-divider" aria-hidden="true" />
      {/* Familiar tools are bare icons. Only Wire and No Connect, whose icons
          do not say what they do, explain themselves on hover. */}
      <ToolbarButton
        testId="draw-tool-undo"
        label="Undo"
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
      <ToolbarButton
        testId="draw-tool-document-style"
        label="Properties"
        text="Properties"
        pressed={documentSettingsOpen}
        onClick={onOpenDocumentSettings}
      >
        <ToolIcon name="style" />
      </ToolbarButton>
      {resetLabels ? (
        <ToolbarButton
          testId="draw-tool-reset-labels"
          label="Reset labels"
          text="Reset labels"
          disabled={!resetLabels.enabled}
          onClick={resetLabels.execute}
        >
          <ToolIcon name="reset-labels" />
        </ToolbarButton>
      ) : null}
    </div>
  );
}
