import type { RefObject } from "react";

import {
  CLOUD_PROJECT_LIMIT,
  type CloudProjectSummary,
} from "./cloud-projects";

export interface FileCommandMenuProps {
  cloudProjects: readonly CloudProjectSummary[];
  activeCloudProjectId: string | null;
  canRevert: boolean;
  hasRecoverySessions: boolean;
  projectInputRef: RefObject<HTMLInputElement | null>;
  onNewProject: () => void;
  onSave: () => void;
  onRefreshCloudProjects: () => void;
  onOpenCloudProject: (project: CloudProjectSummary) => void;
  onDeleteCloudProject: (project: CloudProjectSummary) => void;
  onRefresh: () => void;
  onImportProject: (file: File | null) => void;
  onImportSpice: (
    files: FileList | null,
    namingProfile?: "native" | "cadence-bang",
  ) => void;
  onExportProject: () => void;
  onExportSvg: () => void;
  onExportRaster: (format: "png" | "pdf") => void;
  onExportNetlist: (format: "spice" | "spectre") => void;
  onRevert: () => void;
  onOpenRecovery: () => void;
}

export function FileCommandMenu({
  cloudProjects,
  activeCloudProjectId,
  onOpenCloudProject,
  onDeleteCloudProject,
  canRevert,
  hasRecoverySessions,
  projectInputRef,
  onNewProject,
  onSave,
  onRefreshCloudProjects,
  onRefresh,
  onImportProject,
  onImportSpice,
  onExportProject,
  onExportSvg,
  onExportRaster,
  onExportNetlist,
  onRevert,
  onOpenRecovery,
}: FileCommandMenuProps) {
  return (
    <details
      className="command-menu"
      name="editor-command-menu"
      onToggle={(event) => {
        if (event.currentTarget.open) onRefreshCloudProjects();
      }}
    >
      <summary>File</summary>
      <div className="command-popover">
        <button type="button" onClick={onNewProject}>
          New Project
        </button>
        <button type="button" data-testid="save-cloud-project" onClick={onSave}>
          Save
        </button>
        <span className="command-group-label">
          Cloud Projects ({cloudProjects.length}/{CLOUD_PROJECT_LIMIT})
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
            <button
              type="button"
              aria-label={`Delete Cloud Project ${project.name}`}
              title="Delete this Cloud Project"
              disabled={project.id === activeCloudProjectId}
              onClick={() => onDeleteCloudProject(project)}
            >
              Delete
            </button>
          </div>
        ))}
        <label className="file-import">
          Import Project File…
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
        <label className="file-import">
          Import SPICE…
          <input
            data-testid="spice-files"
            type="file"
            accept=".spi,.cir,.sp,.inc,.lib"
            multiple
            onChange={(event) => onImportSpice(event.currentTarget.files)}
          />
        </label>
        <label className="file-import">
          Import Cadence SPICE (`!` globals)…
          <input
            data-testid="cadence-spice-files"
            type="file"
            accept=".spi,.cir,.sp,.inc,.lib"
            multiple
            onChange={(event) =>
              onImportSpice(event.currentTarget.files, "cadence-bang")
            }
          />
        </label>
        <button type="button" onClick={onExportProject}>
          Export Project File…
        </button>
        <span className="command-group-label">Export Drawing</span>
        <button type="button" aria-label="Export SVG" onClick={onExportSvg}>
          SVG
        </button>
        <button
          type="button"
          aria-label="Export PNG"
          onClick={() => onExportRaster("png")}
        >
          PNG
        </button>
        <button
          type="button"
          aria-label="Export PDF"
          onClick={() => onExportRaster("pdf")}
        >
          PDF
        </button>
        <button
          type="button"
          aria-label="Export SPICE netlist"
          onClick={() => onExportNetlist("spice")}
        >
          SPICE netlist
        </button>
        <button
          type="button"
          aria-label="Export Spectre netlist"
          onClick={() => onExportNetlist("spectre")}
        >
          Spectre netlist
        </button>
        <button type="button" onClick={onRefresh}>
          Refresh app
        </button>
        <button type="button" onClick={onRevert} disabled={!canRevert}>
          Revert to Last Saved
        </button>
        {hasRecoverySessions ? (
          <button type="button" onClick={onOpenRecovery}>
            Recover Local Work…
          </button>
        ) : null}
      </div>
    </details>
  );
}
