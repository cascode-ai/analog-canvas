import { useEffect, useRef, useState } from "react";
import type { CircuitProject } from "@icm/model";

import type { CloudProjectSummary } from "../editor-shell/cloud-projects";

/** Copy a Cell, its children and compatible models from another Cloud Project. */
export function ImportCellDialog({
  cloudProjects,
  activeCloudProjectId,
  onLoadCloudProject,
  onImportCloudCell,
  onImported,
  onClose,
}: {
  cloudProjects: readonly CloudProjectSummary[];
  activeCloudProjectId: string | null;
  onLoadCloudProject?(
    projectId: string,
  ): Promise<
    { ok: true; project: CircuitProject } | { ok: false; message: string }
  >;
  onImportCloudCell(
    source: CircuitProject,
    documentId: string,
  ): Promise<{ ok: boolean; message: string; documentId?: string }>;
  onImported(documentId: string | undefined): void;
  onClose(): void;
}) {
  const [projectId, setProjectId] = useState("");
  const [source, setSource] = useState<CircuitProject | null>(null);
  const [cellId, setCellId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  // Opened from the tree, focus would stay behind the backdrop and Escape
  // would never reach the dialog.
  useEffect(() => dialogRef.current?.focus(), []);
  const sources = cloudProjects.filter(
    (cloud) => cloud.id !== activeCloudProjectId,
  );
  const canImport = Boolean(sources.length && onLoadCloudProject);

  async function loadProject(id: string): Promise<void> {
    setProjectId(id);
    setSource(null);
    setCellId("");
    setMessage("");
    if (!id || !onLoadCloudProject) return;
    setBusy(true);
    const loaded = await onLoadCloudProject(id);
    setBusy(false);
    if (!loaded.ok) {
      setMessage(loaded.message);
      return;
    }
    setSource(loaded.project);
    setCellId(loaded.project.topDocumentId);
  }

  async function importCell(): Promise<void> {
    if (!source || !cellId) return;
    setBusy(true);
    const outcome = await onImportCloudCell(source, cellId);
    setBusy(false);
    if (outcome.ok) onImported(outcome.documentId);
    else setMessage(outcome.message);
  }

  return (
    <div
      className="insert-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="editor-action-dialog import-cell-dialog"
        role="dialog"
        data-plain-keys="local"
        aria-modal="true"
        aria-labelledby="import-cell-dialog-title"
      >
        <header className="editor-action-dialog-header">
          <h2 id="import-cell-dialog-title">Import Cell</h2>
        </header>
        <div className="editor-action-dialog-body">
          {canImport ? (
            <>
              <p>
                Copies the Cell with its children and compatible models; the
                copy is independent of its source.
              </p>
              <label>
                Source Project
                <select
                  value={projectId}
                  disabled={busy}
                  onChange={(event) => void loadProject(event.target.value)}
                >
                  <option value="">Choose a saved Project…</option>
                  {sources.map((cloud) => (
                    <option key={cloud.id} value={cloud.id}>
                      {cloud.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cell
                <select
                  value={cellId}
                  disabled={!source || busy}
                  onChange={(event) => setCellId(event.target.value)}
                >
                  {(source?.documents ?? []).map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <p>Sign in and save another Project to import a Cell from it.</p>
          )}
          {message ? <p role="status">{message}</p> : null}
          {busy ? <p role="status">Loading…</p> : null}
        </div>
        <footer className="editor-action-dialog-actions">
          <button type="button" onClick={onClose}>
            {canImport ? "Cancel" : "Close"}
          </button>
          {canImport ? (
            <button
              type="button"
              className="primary"
              disabled={!source || !cellId || busy}
              onClick={() => void importCell()}
            >
              {busy ? "Importing…" : "Import"}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
