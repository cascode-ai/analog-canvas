import type { ComponentProps, RefObject } from "react";

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

interface ResetAction {
  label: string;
  enabled: boolean;
  execute: () => void;
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
  onManageCells: () => void;
  onOpenSearch: () => void;
  undo: CommandAction;
  redo: CommandAction;
  deleteSelection: CommandAction;
  resets: readonly ResetAction[];
  rotate: CommandAction;
  mirrorLeftRight: CommandAction;
  mirrorTopBottom: CommandAction;
  alignmentActions: readonly AlignmentAction[];
  instanceTableOpen: boolean;
  netlistPreflightOpen: boolean;
  checkAndSave: CommandAction;
  onOpenInstanceTable: () => void;
  onOpenNetlistPreflight: () => void;
  agentAction: { label: string; execute: () => void } | null;
  publishGalleryOpen: boolean;
  onPublishGallery: () => void;
  helpButtonRef: RefObject<HTMLButtonElement | null>;
  helpOpen: boolean;
  onOpenHelp: () => void;
  drawingToolbar: ComponentProps<typeof DrawingToolbar>;
  hierarchyToolbar: ComponentProps<typeof HierarchyToolbar>;
  telemetry: ComponentProps<typeof EditorTestTelemetry>;
  /** Which channel serves this build; the preview wears a banner. */
  releaseChannel: ReleaseChannel;
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
  onManageCells,
  onOpenSearch,
  undo,
  redo,
  deleteSelection,
  resets,
  rotate,
  mirrorLeftRight,
  mirrorTopBottom,
  alignmentActions,
  instanceTableOpen,
  netlistPreflightOpen,
  checkAndSave,
  onOpenInstanceTable,
  onOpenNetlistPreflight,
  agentAction,
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
  return (
    <header className="app-chrome">
      {releaseChannel === "preview" ? (
        <p
          className="app-channel-banner"
          role="status"
          data-testid="release-channel-banner"
        >
          Preview build: unreleased features, simulation included. The gallery
          is read-only here; publish on the production site.
        </p>
      ) : null}
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
                <button
                  type="button"
                  data-testid="edit-manage-cells"
                  onClick={onManageCells}
                >
                  Manage Cells…
                </button>
                <button
                  type="button"
                  data-testid="project-search-button"
                  aria-haspopup="dialog"
                  aria-expanded={searchOpen}
                  onClick={onOpenSearch}
                >
                  Search…
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
                {resets.map((action) => (
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
            <details className="command-menu" name="editor-command-menu">
              <summary>Netlist</summary>
              <div className="command-popover">
                <span className="command-group-label">Authoring</span>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={instanceTableOpen}
                  onClick={onOpenInstanceTable}
                >
                  Instance Table…
                </button>
                <span className="command-group-label">Check</span>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={netlistPreflightOpen}
                  onClick={onOpenNetlistPreflight}
                >
                  Check Report…
                </button>
              </div>
            </details>
            {agentAction ? (
              <details className="command-menu" name="editor-command-menu">
                <summary>Agent</summary>
                <div className="command-popover">
                  <button type="button" onClick={agentAction.execute}>
                    {agentAction.label}
                  </button>
                </div>
              </details>
            ) : null}
            <button
              type="button"
              data-testid="check-and-save"
              disabled={!checkAndSave.enabled}
              onClick={checkAndSave.execute}
              title="Check ERC and visual issues, and save this Cloud Project"
            >
              <span className="toolbar-check-glyph" aria-hidden="true" />
              Check and Save
            </button>
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
