import type { RefObject } from "react";

import type { WorkspaceSlot } from "./workspace-shelf";

export interface FileCommandMenuProps {
  workspaceSlots: readonly WorkspaceSlot[];
  previousProjectName: string | null;
  canRevert: boolean;
  hasRecoverySessions: boolean;
  projectInputRef: RefObject<HTMLInputElement | null>;
  onNewProject: () => void;
  onSaveProject: (pickLocation: boolean) => void;
  onCheckAndSave: () => void;
  onOpenShelfSlot: (slot: WorkspaceSlot) => void;
  onRefresh: () => void;
  onOpenProject: (file: File | null) => void;
  onImportSpice: (files: FileList | null) => void;
  onExportSvg: () => void;
  onExportRaster: (format: "png" | "pdf") => void;
  onExportNetlist: (format: "spice" | "spectre") => void;
  onRestorePrevious: () => void;
  onRevert: () => void;
  onOpenRecovery: () => void;
}

export function FileCommandMenu({
  previousProjectName,
  canRevert,
  hasRecoverySessions,
  projectInputRef,
  onNewProject,
  onSaveProject,
  onCheckAndSave,
  onRefresh,
  onOpenProject,
  onImportSpice,
  onExportSvg,
  onExportRaster,
  onExportNetlist,
  onRestorePrevious,
  onRevert,
  onOpenRecovery,
}: FileCommandMenuProps) {
  return (
    <details className="command-menu" name="editor-command-menu">
      <summary>File</summary>
      <div className="command-popover">
        <button type="button" onClick={onNewProject}>
          New Project
        </button>
        <button type="button" onClick={() => onSaveProject(false)}>
          Save Project
        </button>
        <button
          type="button"
          data-testid="save-project-as"
          onClick={() => onSaveProject(true)}
        >
          Save Project As…
        </button>
        <button
          type="button"
          data-testid="check-and-save-button"
          title="Check the circuit and save it to your shelf"
          onClick={onCheckAndSave}
        >
          <span className="toolbar-check-glyph" aria-hidden="true" />
          Check and Save
        </button>
        <button type="button" onClick={onRefresh}>
          Refresh app
        </button>
        <label className="file-import">
          Open Project
          <input
            ref={projectInputRef}
            data-testid="project-file"
            type="file"
            accept=".json,.icproj.json,application/json"
            onChange={(event) =>
              onOpenProject(event.currentTarget.files?.[0] ?? null)
            }
          />
        </label>
        <label className="file-import">
          Import SPICE
          <input
            data-testid="spice-files"
            type="file"
            accept=".spi,.cir,.sp,.inc,.lib"
            multiple
            onChange={(event) => onImportSpice(event.currentTarget.files)}
          />
        </label>
        <span className="command-group-label">Export</span>
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
        <button
          type="button"
          onClick={onRestorePrevious}
          disabled={previousProjectName === null}
          title={
            previousProjectName
              ? `Return to ${previousProjectName}`
              : "No previous Project in this editor session"
          }
        >
          Previous Project
        </button>
        <button type="button" onClick={onRevert} disabled={!canRevert}>
          Revert to Last Saved
        </button>
        {hasRecoverySessions ? (
          <button type="button" onClick={onOpenRecovery}>
            Recover recent work…
          </button>
        ) : null}
      </div>
    </details>
  );
}
