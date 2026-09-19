import { useEffect, useState } from "react";
import type { ProjectCellSummary } from "@icm/derived";

import type {
  CircuitProject,
  ExternalSubcircuitDefinition,
  HierarchyFrame,
} from "@icm/model";
import { CellHierarchyTree } from "./cell-hierarchy-tree";
import type { CloudProjectSummary } from "../editor-shell/cloud-projects";

import { CellInterfaceEditor } from "./cell-interface-dialog";
import { ExternalCircuitEditor } from "./external-circuit-editor";
import type {
  CellParameterChange,
  ExternalDefinitionResult,
} from "./project-structure-commands";

function CellName({
  name,
  onRename,
}: {
  name: string;
  onRename(name: string): void;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  return (
    <input
      className="cell-manager-name"
      aria-label="Cell name"
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (next && next !== name) onRename(next);
        else setDraft(name);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          event.currentTarget.value = name;
          setDraft(name);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function CellManagerDialog({
  open,
  cells,
  project,
  hierarchyCalls,
  onOpenOccurrence,
  activeDocumentId,
  onClose,
  onCreate,
  onOpen,
  onRename,
  onReorder,
  onDelete,
  onJumpToCaller,
  onSetPortDirection,
  onMovePort,
  onEditParameter,
  externalDefinitions,
  onSetExternalDefinition,
  onRemoveExternalDefinition,
  onPlaceExternal,
  cloudProjects,
  activeCloudProjectId,
  onLoadCloudProject,
  onImportCloudCell,
}: {
  open: boolean;
  cells: readonly ProjectCellSummary[];
  project: CircuitProject;
  hierarchyCalls: readonly HierarchyFrame[];
  onOpenOccurrence(documentId: string, path: readonly HierarchyFrame[]): void;
  activeDocumentId: string;
  onClose(): void;
  onCreate(name: string): void;
  onOpen(documentId: string): void;
  onRename(documentId: string, name: string): void;
  onReorder(documentIds: string[], topDocumentId: string): void;
  onDelete(documentId: string): void;
  onJumpToCaller(documentId: string, instanceId: string): void;
  onSetPortDirection(
    documentId: string,
    portId: string,
    direction: "input" | "output" | "inout" | "passive",
  ): void;
  onMovePort(documentId: string, portId: string, delta: -1 | 1): void;
  onEditParameter(
    documentId: string,
    name: string,
    change: CellParameterChange,
  ): ExternalDefinitionResult;
  externalDefinitions: readonly ExternalSubcircuitDefinition[];
  onSetExternalDefinition(
    definition: ExternalSubcircuitDefinition,
  ): ExternalDefinitionResult;
  onPlaceExternal(definitionId: string): void;
  onRemoveExternalDefinition(definitionId: string): ExternalDefinitionResult;
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
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
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
    setDeleteId(null);
    setImporting(false);
    setImportProjectId("");
    setImportSource(null);
    setImportCellId("");
    setImportBusy(false);
    setImportMessage("");
  }, [activeDocumentId, open]);

  const selectedEntry =
    cells.find((cell) => cell.id === selectedId) ?? cells[0];
  const orderedCells = [
    ...cells.filter((cell) => cell.isTop),
    ...cells.filter((cell) => !cell.isTop),
  ];
  function moveCell(sourceId: string, beforeId: string, makeTop: boolean) {
    if (sourceId === beforeId) return;
    const ids = orderedCells
      .map((cell) => cell.id)
      .filter((id) => id !== sourceId);
    // Ordinary sorting cannot implicitly demote Top.
    if (!makeTop && sourceId === project.topDocumentId) return;
    ids.splice(beforeId ? ids.indexOf(beforeId) : ids.length, 0, sourceId);
    onReorder(ids, makeTop ? sourceId : project.topDocumentId);
    setDraggedId(null);
    setDropId(null);
  }
  const selectedDocument = project.documents.find(
    (document) => document.id === selectedEntry?.id,
  );
  const selectedExternal = externalDefinitions.find(
    (definition) => definition.id === externalId,
  );
  const callers =
    resourceKind === "local"
      ? (selectedEntry?.callers ?? [])
      : project.documents.flatMap((document) =>
          document.instances.flatMap((instance) =>
            selectedExternal &&
            instance.netlist?.binding?.kind === "external-subcircuit" &&
            instance.netlist.binding.definitionId === selectedExternal.id
              ? [
                  {
                    documentId: document.id,
                    documentName: document.name,
                    instanceId: instance.id,
                  },
                ]
              : [],
          ),
        );
  const deleteTarget = cells.find((cell) => cell.id === deleteId);

  function dismissActionDialog(): void {
    setDraftName("");
    setCreating(false);
    setDeleteId(null);
    setImporting(false);
  }

  function submitCellName(): void {
    const name = draftName.trim();
    if (!name) return;
    onCreate(name);
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
            External Circuit Defs
          </button>
        </div>
        <div className="cell-manager-body">
          {resourceKind === "local" ? (
            <aside className="cell-manager-list" aria-label="Cells">
              <div className="cell-manager-list-scroll">
                <CellHierarchyTree
                  project={project}
                  calls={hierarchyCalls}
                  onOpen={onOpenOccurrence}
                />
                {orderedCells.map((cell) => (
                  <div
                    key={cell.id}
                    className="cell-manager-entry"
                    data-drop={dropId === cell.id ? "active" : undefined}
                    onDragOver={(event) => {
                      if (
                        draggedId &&
                        draggedId !== cell.id &&
                        draggedId !== project.topDocumentId
                      ) {
                        event.preventDefault();
                        setDropId(cell.id);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedId) moveCell(draggedId, cell.id, cell.isTop);
                    }}
                  >
                    {dropId === cell.id ? (
                      <small className="cell-drop-hint">
                        {cell.isTop ? "Set as Top" : `Move before ${cell.name}`}
                      </small>
                    ) : null}
                    <button
                      type="button"
                      draggable={!cell.isTop}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", cell.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggedId(cell.id);
                      }}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setDropId(null);
                      }}
                      onDoubleClick={() => onOpen(cell.id)}
                      onKeyDown={(event) => {
                        if (event.altKey && event.key === "ArrowUp") {
                          event.preventDefault();
                          const index = orderedCells.findIndex(
                            (item) => item.id === cell.id,
                          );
                          if (index > 0)
                            moveCell(
                              cell.id,
                              orderedCells[index - 1]!.id,
                              index === 1,
                            );
                        }
                        if (
                          event.altKey &&
                          event.key === "ArrowDown" &&
                          !cell.isTop
                        ) {
                          event.preventDefault();
                          const index = orderedCells.findIndex(
                            (item) => item.id === cell.id,
                          );
                          if (index < orderedCells.length - 1)
                            moveCell(
                              cell.id,
                              orderedCells[index + 2]?.id ?? "",
                              false,
                            );
                        }
                      }}
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
                  </div>
                ))}
                <div
                  className="cell-manager-drop-end"
                  aria-label="Move Cell to end"
                  onDragOver={(event) => {
                    if (draggedId) {
                      event.preventDefault();
                      setDropId("");
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedId) moveCell(draggedId, "", false);
                  }}
                >
                  {draggedId ? "Move to end" : null}
                </div>
              </div>
              <button
                type="button"
                className="cell-manager-new"
                onClick={() => {
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
            <aside
              className="cell-manager-list"
              aria-label="External Circuit Defs"
            >
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
                New External Circuit Def
              </button>
            </aside>
          )}

          <div className="cell-manager-detail">
            {resourceKind === "external" ? (
              <>
                <header className="cell-manager-detail-header">
                  <div className="cell-manager-title-row">
                    <h3>
                      {selectedExternal?.name ?? "New External Circuit Def"}
                    </h3>
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
                  onRemoveExternalDefinition={(id) => {
                    const result = onRemoveExternalDefinition(id);
                    if (result.ok) setExternalId(null);
                    return result;
                  }}
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
                      <CellName
                        key={selectedEntry.id}
                        name={selectedEntry.name}
                        onRename={(name) => onRename(selectedEntry.id, name)}
                      />
                    </div>
                  </div>
                  <div className="cell-manager-actions">
                    {!selectedEntry.isTop ? (
                      <button
                        type="button"
                        onClick={() =>
                          moveCell(
                            selectedEntry.id,
                            project.topDocumentId,
                            true,
                          )
                        }
                      >
                        Set as Top
                      </button>
                    ) : null}
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
                  project={project}
                  callerCount={selectedEntry.callers.length}
                  onSetPortDirection={(portId, direction) =>
                    onSetPortDirection(selectedEntry.id, portId, direction)
                  }
                  onMovePort={(portId, delta) =>
                    onMovePort(selectedEntry.id, portId, delta)
                  }
                  onEditParameter={(name, change) =>
                    onEditParameter(selectedEntry.id, name, change)
                  }
                />
              </>
            ) : (
              <p className="cell-interface-empty">No Cell selected.</p>
            )}
            {callers.length > 0 ? (
              <details className="cell-manager-callers">
                <summary>Callers ({callers.length})</summary>
                <ul>
                  {callers.map((caller) => (
                    <li key={`${caller.documentId}:${caller.instanceId}`}>
                      <span>
                        {caller.documentName}.{caller.instanceId}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onJumpToCaller(caller.documentId, caller.instanceId)
                        }
                      >
                        Jump to caller
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </div>

        {deleteTarget || creating || importing ? (
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
                  <h2 id="cell-name-dialog-title">New Cell</h2>
                </header>
                <div className="editor-action-dialog-body">
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
                    Create
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
