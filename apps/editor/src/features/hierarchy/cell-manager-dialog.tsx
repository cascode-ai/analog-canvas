import { useEffect, useState } from "react";
import type { ProjectCellSummary } from "@icm/derived";

import type {
  CircuitProject,
  ExternalSubcircuitDefinition,
  SchematicDocument,
} from "@icm/model";
import {
  planCellReset,
  type CellResetIntent,
  type CellResetPlan,
} from "@icm/edit-engine";
import type { CloudProjectSummary } from "../editor-shell/cloud-projects";

import { CellInterfaceEditor } from "./cell-interface-dialog";
import { ExternalCircuitEditor } from "./external-circuit-editor";
import type { ExternalDefinitionResult } from "./project-structure-commands";

const RESET_ACTIONS: readonly {
  intent: CellResetIntent;
  command: string;
}[] = [
  { intent: "clear-drawing", command: "Clear Drawing" },
  { intent: "reset-placement", command: "Reset Cell Placement" },
  { intent: "reset-body", command: "Reset Cell Body" },
];

export function CellManagerDialog({
  open,
  cells,
  project,
  activeDocumentId,
  onClose,
  onCreate,
  onOpen,
  onRename,
  onDelete,
  onJumpToCaller,
  onSetPortDirection,
  onMovePort,
  onSetFormalParameters,
  externalDefinitions,
  onSetExternalDefinition,
  onPlaceExternal,
  onReset,
  cloudProjects,
  activeCloudProjectId,
  onLoadCloudProject,
  onImportCloudCell,
}: {
  open: boolean;
  cells: readonly ProjectCellSummary[];
  project: CircuitProject;
  activeDocumentId: string;
  onClose(): void;
  onCreate(name: string): void;
  onOpen(documentId: string): void;
  onRename(documentId: string, name: string): void;
  onDelete(documentId: string): void;
  onJumpToCaller(documentId: string, instanceId: string): void;
  onSetPortDirection(
    documentId: string,
    portId: string,
    direction: "input" | "output" | "inout" | "passive",
  ): void;
  onMovePort(documentId: string, portId: string, delta: -1 | 1): void;
  onSetFormalParameters(
    documentId: string,
    formalParameters: NonNullable<
      SchematicDocument["netlist"]
    >["formalParameters"],
  ): void;
  externalDefinitions: readonly ExternalSubcircuitDefinition[];
  onSetExternalDefinition(
    definition: ExternalSubcircuitDefinition,
  ): ExternalDefinitionResult;
  onPlaceExternal(definitionId: string): void;
  onReset(plan: CellResetPlan, command: string): boolean;
  cloudProjects: readonly CloudProjectSummary[];
  activeCloudProjectId: string | null;
  onLoadCloudProject(
    projectId: string,
  ): Promise<
    { ok: true; project: CircuitProject } | { ok: false; message: string }
  >;
  onImportCloudCell(
    source: CircuitProject,
    documentId: string,
  ): Promise<{ ok: boolean; message: string; documentId?: string }>;
}) {
  const [selectedId, setSelectedId] = useState(activeDocumentId);
  const [resourceKind, setResourceKind] = useState<"local" | "external">(
    "local",
  );
  const [externalId, setExternalId] = useState<string | null>(null);
  const [externalDraft, setExternalDraft] = useState(0);
  const [draftName, setDraftName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [resetIntent, setResetIntent] = useState<CellResetIntent | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProjectId, setImportProjectId] = useState("");
  const [importSource, setImportSource] = useState<CircuitProject | null>(null);
  const [importCellId, setImportCellId] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  useEffect(() => {
    if (open) {
      setSelectedId(activeDocumentId);
      setResourceKind("local");
      return;
    }
    setDraftName("");
    setCreating(false);
    setRenameId(null);
    setDeleteId(null);
    setResetIntent(null);
    setImporting(false);
    setImportProjectId("");
    setImportSource(null);
    setImportCellId("");
    setImportBusy(false);
    setImportMessage("");
  }, [activeDocumentId, open]);

  const selectedEntry =
    cells.find((cell) => cell.id === selectedId) ?? cells[0];
  const selectedDocument = project.documents.find(
    (document) => document.id === selectedEntry?.id,
  );
  const selectedExternal = externalDefinitions.find(
    (definition) => definition.id === externalId,
  );
  const renameTarget = cells.find((cell) => cell.id === renameId);
  const deleteTarget = cells.find((cell) => cell.id === deleteId);
  const resetAction = RESET_ACTIONS.find(
    (action) => action.intent === resetIntent,
  );
  const resetPlan =
    selectedDocument && resetAction
      ? planCellReset(project, selectedDocument.id, resetAction.intent)
      : null;

  function dismissActionDialog(): void {
    setDraftName("");
    setCreating(false);
    setRenameId(null);
    setDeleteId(null);
    setResetIntent(null);
    setImporting(false);
  }

  function submitCellName(): void {
    const name = draftName.trim();
    if (!name) return;
    if (renameTarget) onRename(renameTarget.id, name);
    else onCreate(name);
    dismissActionDialog();
  }

  if (!open) return null;

  return (
    <div
      className="insert-dialog-backdrop"
      onPointerDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <section
        className="cell-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cell-manager-title"
      >
        <header className="cell-manager-header">
          <div>
            <p>Project hierarchy</p>
            <h2 id="cell-manager-title">Cell Manager</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Cell Manager"
          >
            Close
          </button>
        </header>

        <div
          className="cell-manager-resource-tabs"
          role="group"
          aria-label="Definition type"
        >
          <button
            type="button"
            aria-pressed={resourceKind === "local"}
            onClick={() => setResourceKind("local")}
          >
            Cells
          </button>
          <button
            type="button"
            aria-pressed={resourceKind === "external"}
            onClick={() => setResourceKind("external")}
          >
            External Circuits
          </button>
        </div>
        <div className="cell-manager-body">
          {resourceKind === "local" ? (
            <aside className="cell-manager-list" aria-label="Cells">
              <div className="cell-manager-list-heading">
                <span>Cells</span>
                <span>{cells.length}</span>
              </div>
              <div className="cell-manager-list-scroll">
                {cells.map((cell) => (
                  <button
                    key={cell.id}
                    type="button"
                    className="cell-manager-list-item"
                    aria-selected={cell.id === selectedEntry?.id}
                    onClick={() => setSelectedId(cell.id)}
                  >
                    <span>
                      <strong>{cell.name}</strong>
                      {cell.isTop ? <em>Top</em> : null}
                    </span>
                    <small>
                      {cell.portCount} ports · {cell.callers.length} callers
                    </small>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="cell-manager-new"
                onClick={() => {
                  setRenameId(null);
                  setDraftName("");
                  setDeleteId(null);
                  setCreating(true);
                }}
              >
                New Cell
              </button>
              <button
                type="button"
                className="cell-manager-new"
                disabled={cloudProjects.length === 0}
                onClick={() => {
                  setCreating(false);
                  setRenameId(null);
                  setDeleteId(null);
                  setImporting(true);
                  setImportProjectId("");
                  setImportSource(null);
                  setImportCellId("");
                  setImportMessage("");
                }}
              >
                Import Cell
              </button>
            </aside>
          ) : (
            <aside className="cell-manager-list" aria-label="External Circuits">
              <div className="cell-manager-list-heading">
                <span>External Circuits</span>
                <span>{externalDefinitions.length}</span>
              </div>
              <div className="cell-manager-list-scroll">
                {externalDefinitions.map((definition) => (
                  <button
                    key={definition.id}
                    type="button"
                    className="cell-manager-list-item"
                    aria-selected={definition.id === externalId}
                    onClick={() => setExternalId(definition.id)}
                  >
                    <span>
                      <strong>{definition.name}</strong>
                      <em>External</em>
                    </span>
                    <small>{definition.terminals.length} ports</small>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="cell-manager-new"
                onClick={() => {
                  setExternalId(null);
                  setExternalDraft((value) => value + 1);
                }}
              >
                New External Circuit
              </button>
            </aside>
          )}

          <div className="cell-manager-detail">
            {resourceKind === "external" ? (
              <>
                <header className="cell-manager-detail-header">
                  <div className="cell-manager-title-row">
                    <h3>{selectedExternal?.name ?? "New External Circuit"}</h3>
                    <span>External</span>
                  </div>
                  {selectedExternal ? (
                    <button
                      type="button"
                      onClick={() => onPlaceExternal(selectedExternal.id)}
                    >
                      Place
                    </button>
                  ) : null}
                </header>
                <ExternalCircuitEditor
                  key={selectedExternal?.id ?? `new-${externalDraft}`}
                  definition={selectedExternal}
                  onSetExternalDefinition={(definition) => {
                    const result = onSetExternalDefinition(definition);
                    if (result.ok) setExternalId(definition.id);
                    return result;
                  }}
                />
              </>
            ) : selectedEntry && selectedDocument ? (
              <>
                <header className="cell-manager-detail-header">
                  <div>
                    <div className="cell-manager-title-row">
                      <h3>{selectedEntry.name}</h3>
                      {selectedEntry.isTop ? <span>Top Cell</span> : null}
                    </div>
                    <p>
                      {selectedEntry.portCount} ports ·{" "}
                      {selectedEntry.callers.length} callers
                    </p>
                  </div>
                  <div className="cell-manager-actions">
                    <button
                      type="button"
                      onClick={() => onOpen(selectedEntry.id)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameId(selectedEntry.id);
                        setDraftName(selectedEntry.name);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      disabled={
                        selectedEntry.isTop || selectedEntry.callers.length > 0
                      }
                      onClick={() => setDeleteId(selectedEntry.id)}
                    >
                      Delete
                    </button>
                  </div>
                </header>

                <CellInterfaceEditor
                  cell={selectedDocument}
                  callerCount={selectedEntry.callers.length}
                  onSetPortDirection={(portId, direction) =>
                    onSetPortDirection(selectedEntry.id, portId, direction)
                  }
                  onMovePort={(portId, delta) =>
                    onMovePort(selectedEntry.id, portId, delta)
                  }
                  onSetFormalParameters={(formalParameters) =>
                    onSetFormalParameters(selectedEntry.id, formalParameters)
                  }
                />

                <details className="cell-manager-danger-zone">
                  <summary>Reset Cell</summary>
                  <p>
                    Destructive maintenance for {selectedEntry.name}. Every
                    action is confirmed and can be restored with Undo.
                  </p>
                  <div className="cell-manager-reset-actions">
                    {RESET_ACTIONS.map((action) => {
                      const plan = planCellReset(
                        project,
                        selectedEntry.id,
                        action.intent,
                      );
                      return (
                        <button
                          key={action.intent}
                          type="button"
                          disabled={plan.edits.length === 0}
                          onClick={() => setResetIntent(action.intent)}
                        >
                          {action.command}
                        </button>
                      );
                    })}
                  </div>
                </details>

                {selectedEntry.callers.length > 0 ? (
                  <details className="cell-manager-callers">
                    <summary>Callers ({selectedEntry.callers.length})</summary>
                    <ul>
                      {selectedEntry.callers.map((caller) => (
                        <li key={`${caller.documentId}:${caller.instanceId}`}>
                          <span>
                            {caller.documentName}.{caller.instanceId}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onJumpToCaller(
                                caller.documentId,
                                caller.instanceId,
                              )
                            }
                          >
                            Jump to caller
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            ) : (
              <p className="cell-interface-empty">No Cell selected.</p>
            )}
          </div>
        </div>

        {deleteTarget || resetPlan || creating || renameTarget || importing ? (
          <div
            className="cell-manager-dialog-layer"
            onPointerDown={(event) =>
              event.target === event.currentTarget && dismissActionDialog()
            }
          >
            {importing ? (
              <section
                className="editor-action-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="import-cell-dialog-title"
              >
                <header className="editor-action-dialog-header">
                  <p>Project hierarchy</p>
                  <h2 id="import-cell-dialog-title">Import Cloud Cell</h2>
                </header>
                <div className="editor-action-dialog-body">
                  <label>
                    Source Project
                    <select
                      value={importProjectId}
                      disabled={importBusy}
                      onChange={async (event) => {
                        const projectId = event.target.value;
                        setImportProjectId(projectId);
                        setImportSource(null);
                        setImportCellId("");
                        setImportMessage("");
                        if (!projectId) return;
                        setImportBusy(true);
                        const loaded = await onLoadCloudProject(projectId);
                        setImportBusy(false);
                        if (!loaded.ok) {
                          setImportMessage(loaded.message);
                          return;
                        }
                        setImportSource(loaded.project);
                        setImportCellId(loaded.project.topDocumentId);
                      }}
                    >
                      <option value="">Choose a saved Project…</option>
                      {cloudProjects
                        .filter((cloud) => cloud.id !== activeCloudProjectId)
                        .map((cloud) => (
                          <option key={cloud.id} value={cloud.id}>
                            {cloud.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Cell
                    <select
                      value={importCellId}
                      disabled={!importSource || importBusy}
                      onChange={(event) => setImportCellId(event.target.value)}
                    >
                      {(importSource?.documents ?? []).map((document) => (
                        <option key={document.id} value={document.id}>
                          {document.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {importMessage ? <p role="status">{importMessage}</p> : null}
                  <p>
                    The Cell and its child Cells are copied into this Project.
                    The source stays unchanged.
                  </p>
                </div>
                <footer className="editor-action-dialog-actions">
                  <button type="button" onClick={dismissActionDialog}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!importSource || !importCellId || importBusy}
                    onClick={async () => {
                      if (!importSource || !importCellId) return;
                      setImportBusy(true);
                      const outcome = await onImportCloudCell(
                        importSource,
                        importCellId,
                      );
                      setImportBusy(false);
                      if (!outcome.ok) {
                        setImportMessage(outcome.message);
                        return;
                      }
                      dismissActionDialog();
                      if (outcome.documentId) onOpen(outcome.documentId);
                    }}
                  >
                    {importBusy ? "Importing…" : "Import"}
                  </button>
                </footer>
              </section>
            ) : resetPlan && resetAction && selectedDocument ? (
              <section
                className="editor-action-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={`${resetAction.command} in ${selectedDocument.name}?`}
                onKeyDown={(event) => {
                  if (event.key === "Escape") dismissActionDialog();
                }}
              >
                <header className="editor-action-dialog-header">
                  <p>Cell contents</p>
                  <h2>
                    {resetAction.command} in {selectedDocument.name}?
                  </h2>
                </header>
                <div className="editor-action-dialog-body">
                  <p>
                    {resetPlan.summary}. Affected objects:{" "}
                    {resetPlan.affectedObjectIds.length}. You can restore them
                    with Undo.
                  </p>
                </div>
                <footer className="editor-action-dialog-actions">
                  <button type="button" autoFocus onClick={dismissActionDialog}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      if (onReset(resetPlan, resetAction.command)) {
                        dismissActionDialog();
                      }
                    }}
                  >
                    {resetAction.command}
                  </button>
                </footer>
              </section>
            ) : deleteTarget ? (
              <section
                className="editor-action-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Delete Cell"
                onKeyDown={(event) => {
                  if (event.key === "Escape") dismissActionDialog();
                }}
              >
                <header className="editor-action-dialog-header">
                  <p>Project hierarchy</p>
                  <h2 id="delete-cell-dialog-title">
                    Delete {deleteTarget.name}?
                  </h2>
                </header>
                <div className="editor-action-dialog-body">
                  <p>
                    Remove this unreferenced Cell definition. You can restore it
                    with Undo.
                  </p>
                </div>
                <footer className="editor-action-dialog-actions">
                  <button type="button" autoFocus onClick={dismissActionDialog}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      onDelete(deleteTarget.id);
                      dismissActionDialog();
                    }}
                  >
                    Delete Cell
                  </button>
                </footer>
              </section>
            ) : (
              <form
                className="editor-action-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="cell-name-dialog-title"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCellName();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") dismissActionDialog();
                }}
              >
                <header className="editor-action-dialog-header">
                  <p>Project hierarchy</p>
                  <h2 id="cell-name-dialog-title">
                    {renameTarget ? "Rename Cell" : "New Cell"}
                  </h2>
                </header>
                <div className="editor-action-dialog-body">
                  <p>
                    {renameTarget
                      ? "Update the name used throughout this project."
                      : "Create a reusable schematic definition in this project."}
                  </p>
                  <label className="editor-action-dialog-field">
                    <span>Cell name</span>
                    <input
                      id="cell-name-input"
                      autoFocus
                      value={draftName}
                      onChange={(event) =>
                        setDraftName(event.currentTarget.value)
                      }
                    />
                  </label>
                </div>
                <footer className="editor-action-dialog-actions">
                  <button type="button" onClick={dismissActionDialog}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="primary"
                    disabled={draftName.trim().length === 0}
                  >
                    {renameTarget ? "Rename" : "Create"}
                  </button>
                </footer>
              </form>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
