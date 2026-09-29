import { type ReactNode, type ComponentProps } from "react";

import { BugReportLink } from "../components/bug-report-link";
import { ProjectMenu, type ProjectMenuProps } from "./project-menu";
import { AccountMenu } from "../components/account";
import { DrawingToolbar } from "../features/editor-shell/drawing-toolbar";
import { EditorTestTelemetry } from "../features/editor-shell/editor-test-telemetry";
import { FileCommandMenu } from "../features/editor-shell/file-command-menu";
import { SITE_REPOSITORY_URL } from "../components/site-resource-links";
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
  communityEnabled?: boolean;
  identityEnabled?: boolean;
  externalLinksEnabled?: boolean;
  projectTabs?: ReactNode;
  projectChoices?: ProjectMenuProps["projects"];
  projectName: string;
  galleryEntryMetadata: {
    author: string;
    description: string;
  } | null;
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
  userComponentsOpen: boolean;
  onOpenUserComponents: () => void;
  cellManagerOpen: boolean;
  onManageCells: () => void;
  placeProjectCell: CommandAction;
  selectionFilterOpen: boolean;
  onOpenSelectionFilter: () => void;
  onOpenSearch: () => void;
  deleteSelection: CommandAction;
  copySelectionImages: readonly LabeledCommandAction[];
  rotate: CommandAction;
  mirrorLeftRight: CommandAction;
  mirrorTopBottom: CommandAction;
  alignmentActions: readonly AlignmentAction[];
  instanceCodeOpen: boolean;
  netlistPreflightOpen: boolean;
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
  drawingToolbar: ComponentProps<typeof DrawingToolbar>;
  hierarchyToolbar: ComponentProps<typeof HierarchyToolbar>;
  telemetry: ComponentProps<typeof EditorTestTelemetry>;
}

/** Persistent command chrome above the document workspace. */
export function EditorAppChrome({
  communityEnabled = true,
  identityEnabled = true,
  externalLinksEnabled = true,
  projectTabs,
  projectChoices,
  projectName,
  galleryEntryMetadata,
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
  userComponentsOpen,
  onOpenUserComponents,
  cellManagerOpen,
  onManageCells,
  placeProjectCell,
  selectionFilterOpen,
  onOpenSelectionFilter,
  onOpenSearch,
  deleteSelection,
  copySelectionImages,
  rotate,
  mirrorLeftRight,
  mirrorTopBottom,
  alignmentActions,
  instanceCodeOpen,
  netlistPreflightOpen,
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
  drawingToolbar,
  hierarchyToolbar,
  telemetry,
}: EditorAppChromeProps) {
  const copyNetlist = (format: "spice" | "spectre") => {
    dismissOpenCommandMenus();
    onExportNetlist(format);
  };
  const hasSelectionActions =
    deleteSelection.enabled ||
    copySelectionImages.some((action) => action.enabled) ||
    rotate.enabled ||
    mirrorLeftRight.enabled ||
    mirrorTopBottom.enabled ||
    alignmentActions.length > 0;
  return (
    <header className="app-chrome">
      <div className="app-chrome-main">
        <div className="app-brand">
          <a
            className="gallery-home-link"
            href={communityEnabled ? "/" : undefined}
            aria-label={
              communityEnabled
                ? "Back to the gallery"
                : "Analog Canvas desktop preview"
            }
            title={
              communityEnabled
                ? "Back to the gallery"
                : "Desktop preview · Save projects to local files"
            }
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
              if (communityEnabled) onOpenGallery();
            }}
          >
            <span className="app-brand-mark" aria-hidden="true" />
            <h1 title="Analog Canvas">Analog Canvas</h1>
          </a>
          {/* One menu, named for the project: its details, then every
              editor command by group. The header keeps only actions. */}
          <ProjectMenu
            name={projectName}
            nameDraft={projectNameDraft}
            documentName={documentName}
            dirty={hasUnsavedWork}
            publication={galleryEntryMetadata}
            onNameChange={onProjectNameDraftChange}
            onNameCommit={onProjectNameCommit}
            onNameCancel={onProjectNameCancel}
            {...(projectChoices ? { projects: projectChoices } : {})}
            onOpen={() => {
              fileCommands.nativeFiles?.refresh();
              if (fileCommands.cloudEnabled !== false)
                fileCommands.onRefreshCloudProjects();
            }}
          >
            <FileCommandMenu {...fileCommands} embedded />
            <div className="command-section" role="group" aria-label="Edit">
              <span className="command-section-title" aria-hidden="true">
                Edit
              </span>
              <button type="button" onClick={onInsertComponent}>
                Insert component… (I)
              </button>
              {communityEnabled ? (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={userComponentsOpen}
                  onClick={onOpenUserComponents}
                >
                  User Components…
                </button>
              ) : null}
              {placeProjectCell.enabled ? (
                <button type="button" onClick={placeProjectCell.execute}>
                  Place Cell from this Project…
                </button>
              ) : null}
              <button
                type="button"
                data-testid="project-search-button"
                aria-haspopup="dialog"
                aria-expanded={searchOpen}
                onClick={onOpenSearch}
              >
                Find in Circuit… (Ctrl+F)
              </button>
              {hasSelectionActions ? (
                <>
                  <span className="command-group-label">Selection</span>
                  {deleteSelection.enabled ? (
                    <button type="button" onClick={deleteSelection.execute}>
                      Delete
                    </button>
                  ) : null}
                  {copySelectionImages.map((action) =>
                    action.enabled ? (
                      <button
                        key={action.label}
                        type="button"
                        onClick={action.execute}
                      >
                        {action.label}
                      </button>
                    ) : null,
                  )}
                  {rotate.enabled ? (
                    <button type="button" onClick={rotate.execute}>
                      <ToolIcon name="rotate" />
                      Rotate
                    </button>
                  ) : null}
                  {mirrorLeftRight.enabled ? (
                    <button type="button" onClick={mirrorLeftRight.execute}>
                      Mirror left/right (Shift+R)
                    </button>
                  ) : null}
                  {mirrorTopBottom.enabled ? (
                    <button type="button" onClick={mirrorTopBottom.execute}>
                      Mirror top/bottom (Ctrl+R)
                    </button>
                  ) : null}
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
              <span className="command-group-label">Advanced</span>
              <button
                type="button"
                data-testid="selection-filter-button"
                aria-haspopup="dialog"
                aria-expanded={selectionFilterOpen}
                onClick={onOpenSelectionFilter}
              >
                Choose Selectable Objects… (Ctrl+Shift+F)
              </button>
            </div>
            <div
              className="command-section"
              role="group"
              aria-label="Hierarchy"
            >
              <span className="command-section-title" aria-hidden="true">
                Hierarchy
              </span>
              <button
                type="button"
                data-testid="hierarchy-entry"
                aria-haspopup="dialog"
                aria-expanded={cellManagerOpen}
                onClick={onManageCells}
              >
                Cell Manager…
              </button>
            </div>
            <div className="command-section" role="group" aria-label="Netlist">
              <span className="command-section-title" aria-hidden="true">
                Netlist
              </span>
              <button
                type="button"
                data-testid="copy-netlist"
                title={`Copy as-authored ${netlistFormat === "spice" ? "SPICE (.spi)" : "Spectre (.scs)"} netlist`}
                onClick={() => copyNetlist(netlistFormat)}
              >
                Copy Netlist
              </button>
              <button type="button" onClick={onOpenNetlistConfiguration}>
                Netlist Settings…
              </button>
              <button
                type="button"
                aria-expanded={instanceCodeOpen}
                onClick={onOpenInstanceCode}
              >
                Edit Device Data…
              </button>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={netlistPreflightOpen}
                onClick={() => onOpenNetlistPreflight()}
              >
                Review Netlist Issues…
              </button>
            </div>
          </ProjectMenu>
        </div>
        {/* The header's actions, alike in shape; Publish is the one primary. */}
        <nav className="app-command-surface" aria-label="Editor commands">
          <div className="menubar-row app-actions">
            {simulationAction ? (
              <button
                type="button"
                className="app-action"
                data-testid="open-analog-simulation"
                aria-label="Analog simulation"
                aria-pressed={
                  simulationState === "open" || simulationState === "maximized"
                }
                onClick={simulationAction}
              >
                <svg
                  className="app-action-icon"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <path
                    d="M1.5 8c1.2-4 2.6-4 3.8 0s2.6 4 3.8 0 2.6-4 3.8 0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                {simulationState === "minimized"
                  ? "Simulate · Minimized"
                  : "Simulate"}
              </button>
            ) : null}
            {agentAction ? (
              <button
                type="button"
                className="app-action"
                data-testid="open-agent"
                title={agentAction.label}
                onClick={() => {
                  dismissOpenCommandMenus();
                  agentAction.execute();
                }}
              >
                <svg
                  className="app-action-icon"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <path
                    d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
                Agent
              </button>
            ) : null}
            {communityEnabled ? (
              <button
                type="button"
                className="app-action app-action-primary"
                data-testid="publish-gallery-button"
                aria-haspopup="dialog"
                aria-expanded={publishGalleryOpen}
                title="Publish to Gallery"
                onClick={onPublishGallery}
              >
                Publish<span className="publish-label-long"> to Gallery</span>
              </button>
            ) : null}
          </div>
        </nav>
        <div className="app-chrome-actions">
          {/* Who is signed in, as the Gallery shows it; Sign in otherwise. */}
          {identityEnabled ? <AccountMenu showGalleryLinks={false} /> : null}
          {/* What the header says about the site, not the drawing: one ⋯. */}
          <details
            className="command-menu app-more-menu"
            data-testid="app-more-menu"
          >
            <summary aria-label="More" title="More">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="3" cy="8" r="1.4" fill="currentColor" />
                <circle cx="8" cy="8" r="1.4" fill="currentColor" />
                <circle cx="13" cy="8" r="1.4" fill="currentColor" />
              </svg>
            </summary>
            <div className="command-popover app-more-popover">
              {externalLinksEnabled ? (
                <>
                  <BugReportLink
                    testId="editor-report-bug"
                    surface="Editor"
                    projectSchemaVersion={projectSchemaVersion}
                  />
                  <a
                    className="app-repository-link"
                    data-testid="editor-repository-link"
                    href={SITE_REPOSITORY_URL}
                    target="_blank"
                    rel="noreferrer"
                    title="GitHub repository"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.82a9.6 9.6 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.56 4.93.36.31.68.92.68 1.85v2.77c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
                      />
                    </svg>
                    GitHub repository
                  </a>
                </>
              ) : (
                <span
                  className="app-more-note"
                  title="Export Project File writes a copy. Native Save and online services are unavailable."
                >
                  Desktop preview
                </span>
              )}
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
          </details>
        </div>
      </div>
      <DrawingToolbar {...drawingToolbar} />
      <HierarchyToolbar {...hierarchyToolbar} />
      {projectTabs}
      <EditorTestTelemetry {...telemetry} />
    </header>
  );
}
