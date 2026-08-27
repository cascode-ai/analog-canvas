import type { ComponentProps, RefObject } from "react";

import { DrawingToolbar } from "../features/editor-shell/drawing-toolbar";
import { EditorTestTelemetry } from "../features/editor-shell/editor-test-telemetry";
import { FileCommandMenu } from "../features/editor-shell/file-command-menu";
import { ToolIcon } from "../features/editor-shell/tool-icon";
import { HierarchyToolbar } from "../features/hierarchy/hierarchy-toolbar";
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

export interface EditorAppChromeProps {
  projectName: string;
  projectNameDraft: string | null;
  documentName: string;
  onProjectNameDraftChange: (value: string) => void;
  onProjectNameCommit: () => void;
  onProjectNameCancel: () => void;
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
  onAlign: (() => void) | null;
  instanceTableOpen: boolean;
  netlistPreflightOpen: boolean;
  onOpenInstanceTable: () => void;
  onOpenNetlistPreflight: () => void;
  agentAction: { label: string; execute: () => void } | null;
  onCheckAndSave: () => void;
  publishGalleryOpen: boolean;
  onPublishGallery: () => void;
  visitStats: { uv: number; pv: number } | null | undefined;
  helpButtonRef: RefObject<HTMLButtonElement | null>;
  helpOpen: boolean;
  onOpenHelp: () => void;
  drawingToolbar: ComponentProps<typeof DrawingToolbar>;
  hierarchyToolbar: ComponentProps<typeof HierarchyToolbar>;
  telemetry: ComponentProps<typeof EditorTestTelemetry>;
}

/** Persistent command chrome above the document workspace. */
export function EditorAppChrome({
  projectName,
  projectNameDraft,
  documentName,
  onProjectNameDraftChange,
  onProjectNameCommit,
  onProjectNameCancel,
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
  onAlign,
  instanceTableOpen,
  netlistPreflightOpen,
  onOpenInstanceTable,
  onOpenNetlistPreflight,
  agentAction,
  onCheckAndSave,
  publishGalleryOpen,
  onPublishGallery,
  visitStats,
  helpButtonRef,
  helpOpen,
  onOpenHelp,
  drawingToolbar,
  hierarchyToolbar,
  telemetry,
}: EditorAppChromeProps) {
  const displayedProjectName = projectNameDraft ?? projectName;
  return (
    <header className="app-chrome">
      <div className="app-chrome-main">
        <div className="app-brand">
          <a
            className="gallery-home-link"
            href="/"
            aria-label="Back to the gallery"
            title="Back to the gallery"
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
                {onAlign ? (
                  <button type="button" onClick={onAlign}>
                    Align
                  </button>
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
              className="toolbar-check-save"
              data-testid="check-and-save-button"
              title="Check the circuit and save it to your shelf"
              onClick={onCheckAndSave}
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
              Publish to Gallery
            </button>
          </div>
        </nav>
        <div className="app-chrome-actions">
          <a
            className="analytics-link"
            href="/analytics"
            aria-label="Open visitor analytics"
          >
            {visitStats ? (
              <>
                <span>{visitStats.uv.toLocaleString()} visitors</span>
                <span aria-hidden="true">·</span>
                <span>{visitStats.pv.toLocaleString()} views</span>
              </>
            ) : (
              "Analytics"
            )}
          </a>
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
            <span className="tokenzhang-credit-kicker">Provided by</span>
            <a
              className="tokenzhang-link"
              href="https://tokenzhang.com"
              target="_blank"
              rel="noreferrer"
              aria-label="tokenzhang.com"
              title="tokenzhang.com"
            >
              <img
                className="tokenzhang-link-icon"
                src="/tokenzhang-favicon.png"
                alt=""
                width={12}
                height={12}
              />
              <span className="tokenzhang-link-label">tokenzhang.com</span>
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
