import {
  lazy,
  Suspense,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  CLOUD_PROJECT_LIMIT,
  type CloudProjectSummary,
} from "./cloud-projects";
const InlineConfirm = lazy(() =>
  import("../../components/inline-confirm").then((module) => ({
    default: module.InlineConfirm,
  })),
);

export interface FileCommandMenuProps {
  projectStoreLabel: "Cloud Projects" | "Preview Projects";
  projectStoreItemLabel: "Cloud Project" | "Preview Project";
  cloudProjects: readonly CloudProjectSummary[];
  activeCloudProjectId: string | null;
  canRevert: boolean;
  hasRecoverySessions: boolean;
  checkAndSave: { enabled: boolean; execute: () => void };
  projectInputRef: RefObject<HTMLInputElement | null>;
  onNewProject: () => void;
  onSave: () => void;
  onRefreshCloudProjects: () => void;
  onOpenCloudProject: (project: CloudProjectSummary) => void;
  onDeleteCloudProject: (project: CloudProjectSummary) => void | Promise<void>;
  onImportProject: (file: File | null) => void;
  onImportSpice: (
    files: FileList | null,
    namingProfile?: "native" | "cadence-bang",
  ) => void;
  onExportProject: () => void;
  onExportSvg: () => void;
  onExportRaster: (format: "png" | "pdf") => void;
  onRevert: () => void;
  onOpenRecovery: () => void;
}

function CommandSubmenu({
  id,
  title,
  open,
  onToggle,
  onClose,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div
      className="export-submenu"
      onKeyDown={(event) => {
        if (open && event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) onToggle();
            requestAnimationFrame(() =>
              trigger.current?.parentElement
                ?.querySelector<HTMLElement>(
                  ".export-submenu-options button, .export-submenu-options .file-import",
                )
                ?.focus(),
            );
          }
        }}
      >
        {title}
        <span aria-hidden="true">›</span>
      </button>
      <div
        className="export-submenu-options"
        id={id}
        role="group"
        aria-label={title}
        hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}

export function FileCommandMenu({
  projectStoreLabel,
  projectStoreItemLabel,
  cloudProjects,
  activeCloudProjectId,
  onOpenCloudProject,
  onDeleteCloudProject,
  canRevert,
  hasRecoverySessions,
  checkAndSave,
  projectInputRef,
  onNewProject,
  onSave,
  onRefreshCloudProjects,
  onImportProject,
  onImportSpice,
  onExportProject,
  onExportSvg,
  onExportRaster,
  onRevert,
  onOpenRecovery,
}: FileCommandMenuProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<"import" | "export" | null>(
    null,
  );
  const activateFileLabel = (
    event: ReactKeyboardEvent<HTMLLabelElement>,
  ): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.currentTarget.querySelector("input")?.click();
  };
  return (
    <details
      className="command-menu"
      name="editor-command-menu"
      onToggle={(event) => {
        if (event.currentTarget.open) onRefreshCloudProjects();
        else setOpenSubmenu(null);
      }}
    >
      <summary>File</summary>
      <div className="command-popover" data-inline-confirm-menu>
        <button type="button" onClick={onNewProject}>
          New Project
        </button>
        <button type="button" data-testid="save-cloud-project" onClick={onSave}>
          Save
        </button>
        <button
          type="button"
          data-testid="check-and-save"
          disabled={!checkAndSave.enabled}
          onClick={checkAndSave.execute}
          title={`Check ERC and visual issues, and save this ${projectStoreItemLabel}`}
        >
          Check and Save
        </button>
        <span className="command-group-label">
          {projectStoreLabel} ({cloudProjects.length}/{CLOUD_PROJECT_LIMIT})
        </span>
        {cloudProjects.map((project) => (
          <div className="cloud-project-command" key={project.id}>
            <button
              type="button"
              className="cloud-project-open"
              data-testid={`cloud-project-${project.id}`}
              title={`Open revision ${project.revision}`}
              disabled={project.id === activeCloudProjectId}
              onClick={() => onOpenCloudProject(project)}
            >
              <span className="cloud-project-name">{project.name}</span>
              <time className="cloud-project-time" dateTime={project.updatedAt}>
                {new Date(project.updatedAt).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </time>
            </button>
            <Suspense fallback={<button disabled>Delete</button>}>
              <InlineConfirm
                aria-label={`Delete ${projectStoreItemLabel} ${project.name}`}
                title={`Delete this ${projectStoreItemLabel}`}
                disabled={project.id === activeCloudProjectId}
                open={deletingId === project.id}
                onOpenChange={(open) =>
                  setDeletingId((current) =>
                    open ? project.id : current === project.id ? null : current,
                  )
                }
                onConfirm={() => onDeleteCloudProject(project)}
              >
                Delete
              </InlineConfirm>
            </Suspense>
          </div>
        ))}
        <div>
          <CommandSubmenu
            id="file-import-options"
            title="Import"
            open={openSubmenu === "import"}
            onToggle={() =>
              setOpenSubmenu((current) =>
                current === "import" ? null : "import",
              )
            }
            onClose={() => setOpenSubmenu(null)}
          >
            <label
              className="file-import"
              tabIndex={0}
              onKeyDown={activateFileLabel}
            >
              Project File…
              <input
                ref={projectInputRef}
                data-testid="project-file"
                type="file"
                accept=".json,.icproj.json,application/json"
                onChange={(event) =>
                  onImportProject(event.currentTarget.files?.[0] ?? null)
                }
              />
            </label>
            <label
              className="file-import"
              tabIndex={0}
              onKeyDown={activateFileLabel}
            >
              SPICE / SCS…
              <input
                data-testid="spice-files"
                type="file"
                accept=".spi,.cir,.sp,.scs,.inc,.lib"
                multiple
                onChange={(event) => onImportSpice(event.currentTarget.files)}
              />
            </label>
            <label
              className="file-import"
              tabIndex={0}
              onKeyDown={activateFileLabel}
            >
              Cadence SPICE (`!` globals)…
              <input
                data-testid="cadence-spice-files"
                type="file"
                accept=".spi,.cir,.sp,.scs,.inc,.lib"
                multiple
                onChange={(event) =>
                  onImportSpice(event.currentTarget.files, "cadence-bang")
                }
              />
            </label>
          </CommandSubmenu>
        </div>
        <div>
          <CommandSubmenu
            id="file-export-options"
            title="Export"
            open={openSubmenu === "export"}
            onToggle={() =>
              setOpenSubmenu((current) =>
                current === "export" ? null : "export",
              )
            }
            onClose={() => setOpenSubmenu(null)}
          >
            <button
              type="button"
              aria-label="Export Project File…"
              onClick={onExportProject}
            >
              Project File…
            </button>
            <button type="button" aria-label="Export SVG" onClick={onExportSvg}>
              Drawing as SVG
            </button>
            <button
              type="button"
              aria-label="Export PNG"
              onClick={() => onExportRaster("png")}
            >
              Drawing as PNG
            </button>
            <button
              type="button"
              aria-label="Export PDF"
              onClick={() => onExportRaster("pdf")}
            >
              Drawing as PDF
            </button>
          </CommandSubmenu>
        </div>
        {canRevert ? (
          <button type="button" onClick={onRevert}>
            Revert to Last Saved
          </button>
        ) : null}
        {hasRecoverySessions ? (
          <button type="button" onClick={onOpenRecovery}>
            Recover Unsaved Work…
          </button>
        ) : null}
      </div>
    </details>
  );
}
