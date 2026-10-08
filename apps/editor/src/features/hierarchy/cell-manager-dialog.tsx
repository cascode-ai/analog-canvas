import { useEffect, useState } from "react";
import { resolveReviewedLibraryInterface } from "@icm/devices";
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
import type { ApplyModelSourceEdit } from "./external-model-source-editor";
import type { SimulationSourceLocation } from "@icm/simulation-service/contract";
import type { ProjectStructureEdit } from "@icm/edit-engine";
import type {
  CellParameterChange,
  ExternalDefinitionResult,
} from "./project-structure-commands";
import { cellPlacementIssue } from "./project-structure-commands";

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
      autoComplete="off"
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
  initialExternalId,
  initialModelLocation,
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
  onPlaceCell,
  onApplyModelSource,
  onSaveModelDraft,
  onCopyModelText,
  cloudProjects,
  activeCloudProjectId,
  onLoadCloudProject,
  onImportCloudCell,
}: {
  open: boolean;
  onCopyModelText?(text: string): Promise<void>;
  cells: readonly ProjectCellSummary[];
  project: CircuitProject;
  hierarchyCalls: readonly HierarchyFrame[];
  onOpenOccurrence(documentId: string, path: readonly HierarchyFrame[]): void;
  activeDocumentId: string;
  initialExternalId?: string | null;
  initialModelLocation?: SimulationSourceLocation | undefined;
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
  onPlaceCell(documentId: string): void;
  onApplyModelSource(edit: ApplyModelSourceEdit): ExternalDefinitionResult;
  onSaveModelDraft(
    edits: ProjectStructureEdit[],
    definitionId: string,
  ): ExternalDefinitionResult;
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
  const [filter, setFilter] = useState("");
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
  const [detailVisible, setDetailVisible] = useState(
    Boolean(initialExternalId),
  );
  const [pendingPlacement, setPendingPlacement] = useState<string | null>(null);
  const [modelDirty, setModelDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<{ run: () => void } | null>(
    null,
  );
  const requestLeave = (run: () => void) => {
    if (modelDirty) setPendingLeave({ run });
    else run();
  };
  useEffect(() => {
    if (
      !pendingPlacement ||
      !externalDefinitions.some((d) => d.id === pendingPlacement)
    )
      return;
    setPendingPlacement(null);
    onPlaceExternal(pendingPlacement);
  }, [pendingPlacement, externalDefinitions, onPlaceExternal]);

  useEffect(() => {
    if (open) {
      setSelectedId(activeDocumentId);
      setResourceKind(initialExternalId ? "external" : "local");
      if (initialExternalId) setExternalId(initialExternalId);
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
    setFilter("");
  }, [activeDocumentId, open, initialExternalId]);

  const selectedEntry =
    cells.find((cell) => cell.id === selectedId) ?? cells[0];
  const orderedCells = [
    ...cells.filter((cell) => cell.isTop),
    ...cells.filter((cell) => !cell.isTop),
  ];
  const matchesFilter = (name: string) =>
    name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());
  const visibleCells = orderedCells.filter((cell) => matchesFilter(cell.name));
  const visibleDefinitions = externalDefinitions.filter((definition) =>
    matchesFilter(definition.name),
  );
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
  const placementIssue = selectedDocument
    ? cellPlacementIssue(project, activeDocumentId, selectedDocument.id)
    : "Select a Cell";
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
        event.target === event.currentTarget && requestLeave(onClose)
      }
    >
      <section
        className="cell-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cell-manager-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (pendingLeave) setPendingLeave(null);
            else if (importing || creating || deleteId) dismissActionDialog();
            else requestLeave(onClose);
          }
        }}
      >
        <header className="cell-manager-header">
          <div className="cell-manager-heading">
            <p>
              {cells.length} {cells.length === 1 ? "Cell" : "Cells"} ·{" "}
              {externalDefinitions.length} External
            </p>
            <h2 id="cell-manager-title">Cell Manager</h2>
          </div>
          <div
            className="cell-manager-resource-tabs"
            role="tablist"
            aria-label="Definition type"
          >
            <button
              type="button"
              role="tab"
              id="cell-manager-tab-local"
              aria-controls="cell-manager-panel-local"
              aria-selected={resourceKind === "local"}
              onClick={() =>
                requestLeave(() => {
                  setResourceKind("local");
                  setDetailVisible(false);
                })
              }
            >
              Cells
            </button>
            <button
              type="button"
              role="tab"
              id="cell-manager-tab-external"
              aria-controls="cell-manager-panel-external"
              aria-selected={resourceKind === "external"}
              onClick={() =>
                requestLeave(() => {
                  setResourceKind("external");
                  setDetailVisible(externalDefinitions.length === 0);
                })
              }
            >
              External Circuits
            </button>
          </div>
          <button
            type="button"
            className="cell-manager-dismiss"
            onClick={() => requestLeave(onClose)}
            aria-label="Close Cell Manager"
          >
            ×
          </button>
        </header>

        <div
          className="cell-manager-body"
          role="tabpanel"
          id={`cell-manager-panel-${resourceKind}`}
          aria-labelledby={`cell-manager-tab-${resourceKind}`}
          data-pane={detailVisible ? "detail" : "list"}
        >
          {resourceKind === "local" ? (
            <aside className="cell-manager-list" aria-label="Cells">
              <input
                type="search"
                aria-label="Search definitions"
                placeholder="Search…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <div className="cell-manager-list-scroll">
                {visibleCells.map((cell) => (
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
                      onClick={() => {
                        setSelectedId(cell.id);
                        setDetailVisible(true);
                      }}
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
                {filter && !visibleCells.length ? (
                  <p role="status">No matches</p>
                ) : null}
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
              <CellHierarchyTree
                project={project}
                calls={hierarchyCalls}
                onOpen={onOpenOccurrence}
              />
              <footer className="cell-manager-list-actions">
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
                  title={
                    cloudProjects.length === 0
                      ? "Sign in and open another Project to import a Cell."
                      : undefined
                  }
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
              </footer>
            </aside>
          ) : (
            <aside className="cell-manager-list" aria-label="External Circuits">
              <input
                type="search"
                aria-label="Search definitions"
                placeholder="Search…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <div className="cell-manager-list-scroll">
                {visibleDefinitions.map((definition) => (
                  <button
                    key={definition.id}
                    type="button"
                    className="cell-manager-list-item"
                    aria-selected={definition.id === externalId}
                    onClick={() =>
                      requestLeave(() => {
                        setExternalId(definition.id);
                        setDetailVisible(true);
                      })
                    }
                  >
                    <span>
                      <strong>{definition.name}</strong>
                    </span>
                    <small>
                      {definition.terminals.length} ports
                      {definition.implementation?.kind === "placeholder"
                        ? " · Unimplemented"
                        : definition.implementation?.kind === "source"
                          ? " · Project model"
                          : resolveReviewedLibraryInterface(
                                definition.name,
                                definition.terminals.map((t) => t.name),
                              )
                            ? " · Reviewed library"
                            : " · Legacy"}
                    </small>
                  </button>
                ))}
                {filter && !visibleDefinitions.length ? (
                  <p role="status">No matches</p>
                ) : null}
              </div>
              <footer className="cell-manager-list-actions">
                <button
                  type="button"
                  className="cell-manager-new"
                  onClick={() =>
                    requestLeave(() => {
                      setExternalId(null);
                      setExternalDraft((value) => value + 1);
                      setDetailVisible(true);
                    })
                  }
                >
                  New External Circuit
                </button>
              </footer>
            </aside>
          )}

          <div className="cell-manager-detail">
            <button
              type="button"
              className="cell-manager-back"
              onClick={() => setDetailVisible(false)}
            >
              Back to list
            </button>
            {resourceKind === "external" ? (
              <>
                <header className="cell-manager-detail-header">
                  <div className="cell-manager-title-row">
                    <h3>{selectedExternal?.name ?? "New External Circuit"}</h3>
                    <span>External</span>
                  </div>
                </header>
                <ExternalCircuitEditor
                  key={selectedExternal?.id ?? `new-${externalDraft}`}
                  definition={selectedExternal}
                  initialLocation={
                    selectedExternal?.id === initialExternalId
                      ? initialModelLocation
                      : undefined
                  }
                  project={project}
                  onCopyText={onCopyModelText}
                  onPlace={setPendingPlacement}
                  onDirtyChange={setModelDirty}
                  onRequestLeave={requestLeave}
                  onSaveModelDraft={(edits, definitionId) => {
                    const result = onSaveModelDraft(edits, definitionId);
                    if (result.ok) setExternalId(definitionId);
                    return result;
                  }}
                  onApplyModelSource={(edit) => {
                    const result = onApplyModelSource(edit);
                    if (result.ok)
                      setExternalId(edit.definitions[0]!.definitionId);
                    return result;
                  }}
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
                  <div className="cell-manager-title-row">
                    <CellName
                      key={selectedEntry.id}
                      name={selectedEntry.name}
                      onRename={(name) => onRename(selectedEntry.id, name)}
                    />
                  </div>
                  <div className="cell-manager-actions">
                    <button
                      type="button"
                      disabled={Boolean(placementIssue)}
                      title={
                        placementIssue ??
                        "Place this Cell in the current drawing"
                      }
                      onClick={() => onPlaceCell(selectedEntry.id)}
                    >
                      Place
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpen(selectedEntry.id)}
                    >
                      Open
                    </button>
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

                {placementIssue ? (
                  <p className="cell-interface-empty">{placementIssue}</p>
                ) : null}

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
                          requestLeave(() =>
                            onJumpToCaller(
                              caller.documentId,
                              caller.instanceId,
                            ),
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
          </div>
        </div>

        {pendingLeave ? (
          <div className="cell-manager-dialog-layer">
            <section
              className="editor-action-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Unsaved model"
            >
              <header className="editor-action-dialog-header">
                <h2>Unsaved model</h2>
              </header>
              <div className="editor-action-dialog-body">
                <p>Apply or save a draft to keep your edits.</p>
              </div>
              <footer className="editor-action-dialog-actions">
                <button
                  type="button"
                  autoFocus
                  onClick={() => setPendingLeave(null)}
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const action = pendingLeave.run;
                    setPendingLeave(null);
                    setModelDirty(false);
                    action();
                  }}
                >
                  Discard changes
                </button>
              </footer>
            </section>
          </div>
        ) : null}

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
                  {importBusy ? <p role="status">Loading…</p> : null}
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
                      if (outcome.documentId) {
                        setSelectedId(outcome.documentId);
                        setDetailVisible(true);
                      }
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
                autoComplete="off"
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
                      autoComplete="off"
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

/** Advisory placement check. The atomic Project transaction also rejects cycles. */
