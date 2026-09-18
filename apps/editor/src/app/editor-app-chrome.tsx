import { type ComponentProps, type RefObject } from "react";

import { AccountMenu } from "../components/account";
import { BugReportLink } from "../components/bug-report-link";
import { DrawingToolbar } from "../features/editor-shell/drawing-toolbar";
import { EditorTestTelemetry } from "../features/editor-shell/editor-test-telemetry";
import type { ReleaseChannel } from "../document/release-channel";
import { FileCommandMenu } from "../features/editor-shell/file-command-menu";
import { ToolIcon } from "../features/editor-shell/tool-icon";
import { HierarchyToolbar } from "../features/hierarchy/hierarchy-toolbar";
import type { EdgeAlignmentMode } from "../features/selection/align-selection";
import { dismissOpenCommandMenus } from "./editor-runtime-helpers";

interface CommandAction {
  enabled: boolean;
  execute: () => void;
}

interface LabeledCommandAction extends CommandAction {
  label: string;
}

interface AlignmentAction extends CommandAction {
  mode: EdgeAlignmentMode;
  label: string;
}

export interface EditorAppChromeProps {
  projectName: string;
  projectSchemaVersion: number;
  projectNameDraft: string | null;
  hasUnsavedWork: boolean;
  documentName: string;
  onProjectNameDraftChange: (value: string) => void;
  onProjectNameCommit: () => void;
  onProjectNameCancel: () => void;
  onOpenGallery: () => void;
  fileCommands: ComponentProps<typeof FileCommandMenu>;
  searchOpen: boolean;
  onInsertComponent: () => void;
  onManageCells: () => void;
  placeProjectCell: CommandAction;
  selectionFilterOpen: boolean;
  onOpenSelectionFilter: () => void;
  onOpenSearch: () => void;
  undo: CommandAction;
  redo: CommandAction;
  deleteSelection: CommandAction;
  copySelectionImages: readonly LabeledCommandAction[];
  rotate: CommandAction;
  mirrorLeftRight: CommandAction;
  mirrorTopBottom: CommandAction;
  alignmentActions: readonly AlignmentAction[];
  instanceCodeOpen: boolean;
  netlistPreflightOpen: boolean;
  checkAndSave: CommandAction;
  onOpenInstanceCode: () => void;
  onOpenNetlistPreflight: () => void;
  onOpenNetlistConfiguration: () => void;
  netlistFormat: "spice" | "spectre";
  onExportNetlist: (format: "spice" | "spectre") => void;
  agentAction: { label: string; execute: () => void } | null;
  simulationAction?: () => void;
  simulationState?: "closed" | "open" | "maximized" | "minimized";
  publishGalleryOpen: boolean;
  onPublishGallery: () => void;
  helpButtonRef: RefObject<HTMLButtonElement | null>;
  helpOpen: boolean;
  onOpenHelp: () => void;
  drawingToolbar: ComponentProps<typeof DrawingToolbar>;
  hierarchyToolbar: ComponentProps<typeof HierarchyToolbar>;
  telemetry: ComponentProps<typeof EditorTestTelemetry>;
  /** Which channel serves this build; Preview is identified without a warning. */
  releaseChannel: ReleaseChannel;
}

export function ReleaseChannelBadge({
  releaseChannel,
}: {
  releaseChannel: ReleaseChannel;
}) {
  return releaseChannel === "preview" ? (
    <span className="app-channel-badge" data-testid="release-channel-badge">
      Preview
    </span>
  ) : null;
}

/** Persistent command chrome above the document workspace. */
export function EditorAppChrome({
  projectName,
  projectSchemaVersion,
  projectNameDraft,
  hasUnsavedWork,
  documentName,
  onProjectNameDraftChange,
  onProjectNameCommit,
  onProjectNameCancel,
  onOpenGallery,
  fileCommands,
  searchOpen,
  onInsertComponent,
  onManageCells,
  placeProjectCell,
  selectionFilterOpen,
  onOpenSelectionFilter,
  onOpenSearch,
  undo,
  redo,
  deleteSelection,
  copySelectionImages,
  rotate,
  mirrorLeftRight,
  mirrorTopBottom,
  alignmentActions,
  instanceCodeOpen,
  netlistPreflightOpen,
  checkAndSave,
  onOpenInstanceCode,
  onOpenNetlistPreflight,
  netlistFormat,
  onOpenNetlistConfiguration,
  onExportNetlist,
  agentAction,
  simulationAction,
  simulationState = "closed",
  publishGalleryOpen,
  onPublishGallery,
  helpButtonRef,
  helpOpen,
  onOpenHelp,
  drawingToolbar,
  hierarchyToolbar,
  telemetry,
  releaseChannel,
}: EditorAppChromeProps) {
  const displayedProjectName = projectNameDraft ?? projectName;
  const copyNetlist = (format: "spice" | "spectre") => {
    dismissOpenCommandMenus();
    onExportNetlist(format);
  };
  return (
    <header className="app-chrome">
      <div className="app-chrome-main">
        <div className="app-brand">
          <a
            className="gallery-home-link"
            href="/"
            aria-label="Back to the gallery"
            title="Back to the gallery"
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return;
              }
              event.preventDefault();
              onOpenGallery();
            }}
          >
            <span className="app-brand-mark" aria-hidden="true" />
            <h1 title="Analog Canvas">Analog Canvas</h1>
          </a>
          <div className="app-brand-copy">
            <p title={`${projectName} / ${documentName}`}>
              <input
                className="app-project-name"
                aria-label="Circuit name"
                data-testid="project-name-input"
                value={displayedProjectName}
                size={Math.max(displayedProjectName.length, 6)}
                onChange={(event) =>
                  onProjectNameDraftChange(event.currentTarget.value)
                }
                onBlur={onProjectNameCommit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") onProjectNameCancel();
                }}
              />{" "}
              {hasUnsavedWork ? (
                <span
                  className="project-unsaved-indicator"
                  data-testid="project-unsaved-indicator"
                  aria-label="Unsaved changes"
                  title="Unsaved changes"
                >
                  ●
                </span>
              ) : null}{" "}
              / <span data-testid="active-document-name">{documentName}</span>
            </p>
          </div>
        </div>
        <nav
          className="app-command-surface"
          aria-label="Editor commands"
          onClick={(event) => {
            const target = event.target;
            if (
              target instanceof Element &&
              target.closest(".command-popover button")
            ) {
              dismissOpenCommandMenus();
            }
          }}
        >
          <div className="menubar-row">
            <FileCommandMenu {...fileCommands} />
            <details className="command-menu" name="editor-command-menu">
              <summary>Edit</summary>
              <div className="command-popover">
                <button type="button" onClick={onInsertComponent}>
                  Insert component… (I)
                </button>
                <button
                  type="button"
                  data-testid="edit-manage-cells"
                  onClick={onManageCells}
                >
                  Manage Cells…
                </button>
                <button
                  type="button"
                  onClick={placeProjectCell.execute}
                  disabled={!placeProjectCell.enabled}
                >
                  Place Cell from this Project…
                </button>
                <button
                  type="button"
                  data-testid="selection-filter-button"
                  aria-haspopup="dialog"
                  aria-expanded={selectionFilterOpen}
                  onClick={onOpenSelectionFilter}
                >
                  Selection Filter… (Ctrl+F)
                </button>
                <button
                  type="button"
                  data-testid="project-search-button"
                  aria-haspopup="dialog"
                  aria-expanded={searchOpen}
                  onClick={onOpenSearch}
                >
                  Search schematic… (Ctrl+Shift+F)
                </button>
                <button
                  type="button"
                  onClick={undo.execute}
                  disabled={!undo.enabled}
                >
                  Undo
                </button>
                <button
                  type="button"
                  onClick={redo.execute}
                  disabled={!redo.enabled}
                >
                  Redo
                </button>
                <button
                  type="button"
                  onClick={deleteSelection.execute}
                  disabled={!deleteSelection.enabled}
                >
                  Delete
                </button>
                <span className="command-group-label">Selection image</span>
                {copySelectionImages.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={action.execute}
                    disabled={!action.enabled}
                  >
                    {action.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={rotate.execute}
                  disabled={!rotate.enabled}
                >
                  <ToolIcon name="rotate" />
                  Rotate
                </button>
                <button
                  type="button"
                  onClick={mirrorLeftRight.execute}
                  disabled={!mirrorLeftRight.enabled}
                >
                  Mirror left/right (Shift+R)
                </button>
                <button
                  type="button"
                  onClick={mirrorTopBottom.execute}
                  disabled={!mirrorTopBottom.enabled}
                >
                  Mirror top/bottom (Ctrl+R)
                </button>
                {alignmentActions.length > 0 ? (
                  <>
                    <span className="command-group-label">Align</span>
                    {alignmentActions.map((action) => (
                      <button
                        key={action.mode}
                        type="button"
                        onClick={action.execute}
                        disabled={!action.enabled}
                      >
                        {action.label}
                      </button>
                    ))}
                  </>
                ) : null}
              </div>
            </details>
            <div className="netlist-copy-group">
              <button
                type="button"
                className="toolbar-button netlist-copy"
                data-testid="copy-netlist"
                aria-label="Copy netlist"
                title={`Copy as-authored ${netlistFormat === "spice" ? "SPICE (.spi)" : "Spectre (.scs)"} netlist`}
                onClick={() => copyNetlist(netlistFormat)}
              >
                <svg
                  viewBox="0 0 20 20"
                  className="tool-icon"
                  aria-hidden="true"
                >
                  <path
                    d="M7 7h10v10H7z M13 7V3H3v10h4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Netlist
              </button>
              <details className="command-menu" name="editor-command-menu">
                <summary
                  aria-label="Netlist"
                  title="Netlist formats and checks"
                />
                <div className="command-popover">
                  <button type="button" onClick={onOpenNetlistConfiguration}>
                    Configuration…
                  </button>
                  <span className="command-group-label">Authoring</span>
                  <button
                    type="button"
                    aria-expanded={instanceCodeOpen}
                    onClick={onOpenInstanceCode}
                  >
                    Instances…
                  </button>
                  <span className="command-group-label">Check</span>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={netlistPreflightOpen}
                    onClick={() => onOpenNetlistPreflight()}
                  >
                    Check Report…
                  </button>
                  <button
                    type="button"
                    data-testid="check-and-save"
                    disabled={!checkAndSave.enabled}
                    onClick={checkAndSave.execute}
                    title={`Check ERC and visual issues, and save this ${fileCommands.projectStoreItemLabel}`}
                  >
                    <span className="toolbar-check-glyph" aria-hidden="true" />
                    Check and Save
                  </button>
                </div>
              </details>
            </div>
            {simulationAction ? (
              <button
                type="button"
                data-testid="open-analog-simulation"
                aria-label="Analog simulation"
                aria-pressed={
                  simulationState === "open" || simulationState === "maximized"
                }
                onClick={simulationAction}
              >
                {simulationState === "minimized"
                  ? "Simulation · Minimized"
                  : "Simulation"}
              </button>
            ) : null}
            {agentAction ? (
              <button
                type="button"
                data-testid="open-agent"
                title={agentAction.label}
                onClick={() => {
                  dismissOpenCommandMenus();
                  agentAction.execute();
                }}
              >
                Agent
              </button>
            ) : null}
            {/* Publishing is the primary narrow-window action. Keeping it
                immediately after the compact menus makes it visible before
                the command row needs horizontal scrolling. */}
            <button
              type="button"
              data-testid="publish-gallery-button"
              aria-haspopup="dialog"
              aria-expanded={publishGalleryOpen}
              title="Publish to Gallery"
              onClick={onPublishGallery}
            >
              Publish<span className="publish-label-long"> to Gallery</span>
            </button>
          </div>
        </nav>
        <div className="app-chrome-actions">
          <ReleaseChannelBadge releaseChannel={releaseChannel} />
          {releaseChannel === "preview" ? (
            <AccountMenu showGalleryLinks={false} />
          ) : null}
          <BugReportLink
            testId="editor-report-bug"
            surface="Editor"
            projectSchemaVersion={projectSchemaVersion}
          />
          <button
            type="button"
            className="menubar-help"
            ref={helpButtonRef}
            aria-haspopup="dialog"
            aria-expanded={helpOpen}
            aria-controls="editor-help-dialog"
            onClick={onOpenHelp}
          >
            Help
          </button>
          <div className="tokenzhang-credit">
            <span className="tokenzhang-credit-kicker">Presented by</span>
            <a
              className="tokenzhang-link"
              href="https://tokenzhang.com"
              target="_blank"
              rel="noreferrer"
              aria-label="TokenZhang"
              title="TokenZhang"
            >
              <img
                className="tokenzhang-link-icon"
                src="/tokenzhang-favicon.png"
                alt=""
                width={12}
                height={12}
              />
              <span className="tokenzhang-link-label">TokenZhang</span>
            </a>
          </div>
        </div>
      </div>
      <DrawingToolbar {...drawingToolbar} />
      <HierarchyToolbar {...hierarchyToolbar} />
      <EditorTestTelemetry {...telemetry} />
    </header>
  );
}
