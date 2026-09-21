import { type ReactNode, type ComponentProps } from "react";

import { AccountMenu } from "../components/account";
import { BugReportLink } from "../components/bug-report-link";
import { ProjectMenu, type ProjectMenuProps } from "./project-menu";
import { DrawingToolbar } from "../features/editor-shell/drawing-toolbar";
import { EditorTestTelemetry } from "../features/editor-shell/editor-test-telemetry";
import type { ReleaseChannel } from "../document/release-channel";
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
  releaseChannel,
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
          />
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
                  aria-haspopup="dialog"
                  aria-expanded={userComponentsOpen}
                  onClick={onOpenUserComponents}
                >
                  User Components…
                </button>
                <button
                  type="button"
                  data-testid="edit-manage-cells"
                  onClick={onManageCells}
                >
                  Manage Cells…
                </button>
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
            </details>
            <details className="command-menu" name="editor-command-menu">
              <summary aria-label="Netlist" title="Netlist commands">
                <ToolIcon name="netlist" />
                <span>Netlist</span>
              </summary>
              <div className="command-popover">
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
            </details>
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
          <a
            className="app-repository-link"
            data-testid="editor-repository-link"
            href={SITE_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
            title="GitHub repository"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.82a9.6 9.6 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.56 4.93.36.31.68.92.68 1.85v2.77c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
              />
            </svg>
          </a>
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
      {projectTabs}
      <EditorTestTelemetry {...telemetry} />
    </header>
  );
}
