import { useEffect, useState } from "react";

import type {
  ExternalSubcircuitDefinition,
  SchematicDocument,
} from "@icm/model";

import { CellInterfaceEditor } from "./cell-interface-dialog";

export interface CellManagerEntry {
  readonly id: string;
  readonly name: string;
  readonly isTop: boolean;
  readonly portCount: number;
  readonly callers: readonly {
    documentId: string;
    documentName: string;
    instanceId: string;
  }[];
}

export function CellManagerDialog({
  open,
  cells,
  documents,
  activeDocumentId,
  onClose,
  onCreate,
  onOpen,
  onRename,
  onDelete,
  onJumpToCaller,
  onRenameTerminal,
  onSetTerminalDirection,
  onMoveTerminal,
  onSetFormalParameters,
  externalDefinitions,
  onSetExternalDefinition,
}: {
  open: boolean;
  cells: readonly CellManagerEntry[];
  documents: readonly SchematicDocument[];
  activeDocumentId: string;
  onClose(): void;
  onCreate(name: string): void;
  onOpen(documentId: string): void;
  onRename(documentId: string, name: string): void;
  onDelete(documentId: string): void;
  onJumpToCaller(documentId: string, instanceId: string): void;
  onRenameTerminal(documentId: string, terminalId: string, name: string): void;
  onSetTerminalDirection(
    documentId: string,
    terminalId: string,
    direction: "input" | "output" | "inout" | "passive",
  ): void;
  onMoveTerminal(documentId: string, terminalId: string, delta: -1 | 1): void;
  onSetFormalParameters(
    documentId: string,
    formalParameters: NonNullable<
      SchematicDocument["netlist"]
    >["formalParameters"],
  ): void;
  externalDefinitions: readonly ExternalSubcircuitDefinition[];
  onSetExternalDefinition(definition: ExternalSubcircuitDefinition): void;
}) {
  const [selectedId, setSelectedId] = useState(activeDocumentId);
  const [draftName, setDraftName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedId(activeDocumentId);
      return;
    }
    setDraftName("");
    setCreating(false);
    setRenameId(null);
    setDeleteId(null);
  }, [activeDocumentId, open]);

  const selectedEntry =
    cells.find((cell) => cell.id === selectedId) ?? cells[0];
  const selectedDocument = documents.find(
    (document) => document.id === selectedEntry?.id,
  );
  const renameTarget = cells.find((cell) => cell.id === renameId);
  const deleteTarget = cells.find((cell) => cell.id === deleteId);

  function dismissActionDialog(): void {
    setDraftName("");
    setCreating(false);
    setRenameId(null);
    setDeleteId(null);
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

        <div className="cell-manager-body">
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
          </aside>

          <div className="cell-manager-detail">
            {selectedEntry && selectedDocument ? (
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
                  onRenameTerminal={(terminalId, name) =>
                    onRenameTerminal(selectedEntry.id, terminalId, name)
                  }
                  onSetTerminalDirection={(terminalId, direction) =>
                    onSetTerminalDirection(
                      selectedEntry.id,
                      terminalId,
                      direction,
                    )
                  }
                  onMoveTerminal={(terminalId, delta) =>
                    onMoveTerminal(selectedEntry.id, terminalId, delta)
                  }
                  onSetFormalParameters={(formalParameters) =>
                    onSetFormalParameters(selectedEntry.id, formalParameters)
                  }
                  externalDefinitions={externalDefinitions}
                  onSetExternalDefinition={onSetExternalDefinition}
                />

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

        {deleteTarget || creating || renameTarget ? (
          <div
            className="cell-manager-dialog-layer"
            onPointerDown={(event) =>
              event.target === event.currentTarget && dismissActionDialog()
            }
          >
            {deleteTarget ? (
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
