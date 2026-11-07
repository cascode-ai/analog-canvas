import { useEffect, useState } from "react";
import { resolveReviewedLibraryInterface } from "@icm/devices";
import type { CircuitProject, ExternalSubcircuitDefinition } from "@icm/model";

import { ExternalCircuitEditor } from "./external-circuit-editor";
import type { ApplyModelSourceEdit } from "./external-model-source-editor";
import type { SimulationSourceLocation } from "@icm/simulation-service/contract";
import type { ProjectStructureEdit } from "@icm/edit-engine";
import type { ExternalDefinitionResult } from "./project-structure-commands";

/**
 * The External Circuits manager: Project-owned native models and their
 * callers. Schematic Cells are edited in Cell properties from the hierarchy
 * tree; this dialog keeps its historical name, chunk and class.
 */
export function CellManagerDialog({
  open,
  project,
  initialExternalId,
  initialModelLocation,
  onClose,
  onJumpToCaller,
  externalDefinitions,
  onSetExternalDefinition,
  onRemoveExternalDefinition,
  onPlaceExternal,
  onApplyModelSource,
  onSaveModelDraft,
  onCopyModelText,
}: {
  open: boolean;
  onCopyModelText?(text: string): Promise<void>;
  project: CircuitProject;
  initialExternalId?: string | null;
  initialModelLocation?: SimulationSourceLocation | undefined;
  onClose(): void;
  onJumpToCaller(documentId: string, instanceId: string): void;
  externalDefinitions: readonly ExternalSubcircuitDefinition[];
  onSetExternalDefinition(
    definition: ExternalSubcircuitDefinition,
  ): ExternalDefinitionResult;
  onPlaceExternal(definitionId: string): void;
  onApplyModelSource(edit: ApplyModelSourceEdit): ExternalDefinitionResult;
  onSaveModelDraft(
    edits: ProjectStructureEdit[],
    definitionId: string,
  ): ExternalDefinitionResult;
  onRemoveExternalDefinition(definitionId: string): ExternalDefinitionResult;
}) {
  const [externalId, setExternalId] = useState<string | null>(null);
  const [externalDraft, setExternalDraft] = useState(0);
  const [filter, setFilter] = useState("");
  const [detailVisible, setDetailVisible] = useState(
    Boolean(initialExternalId) || externalDefinitions.length === 0,
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
      setDetailVisible(
        Boolean(initialExternalId) || externalDefinitions.length === 0,
      );
      if (initialExternalId) setExternalId(initialExternalId);
      return;
    }
    setFilter("");
  }, [open, initialExternalId]);

  const matchesFilter = (name: string) =>
    name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());
  const visibleDefinitions = externalDefinitions.filter((definition) =>
    matchesFilter(definition.name),
  );
  const selectedExternal = externalDefinitions.find(
    (definition) => definition.id === externalId,
  );
  const callers = project.documents.flatMap((document) =>
    document.instances.flatMap((instance) =>
      selectedExternal &&
      instance.netlist?.binding?.kind === "external-subcircuit" &&
      instance.netlist.binding.definitionId === selectedExternal.id
        ? [
            {
              documentId: document.id,
              documentName: document.name,
              instanceId: instance.id,
              // The part's reference, as the canvas shows it.
              reference: instance.reference ?? instance.id,
            },
          ]
        : [],
    ),
  );

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
            else requestLeave(onClose);
          }
        }}
      >
        <header className="cell-manager-header">
          <div className="cell-manager-heading">
            <p>
              {externalDefinitions.length}{" "}
              {externalDefinitions.length === 1 ? "model" : "models"}
            </p>
            <h2 id="cell-manager-title">External Circuits</h2>
          </div>
          <button
            type="button"
            className="cell-manager-dismiss"
            onClick={() => requestLeave(onClose)}
            aria-label="Close External Circuits"
          >
            ×
          </button>
        </header>

        <div
          className="cell-manager-body"
          id="cell-manager-panel-external"
          data-pane={detailVisible ? "detail" : "list"}
        >
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

          <div className="cell-manager-detail">
            <button
              type="button"
              className="cell-manager-back"
              onClick={() => setDetailVisible(false)}
            >
              Back to list
            </button>
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
                if (result.ok) setExternalId(edit.definitions[0]!.definitionId);
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
            {callers.length > 0 ? (
              <details className="cell-manager-callers">
                <summary>Callers ({callers.length})</summary>
                <ul>
                  {callers.map((caller) => (
                    <li key={`${caller.documentId}:${caller.instanceId}`}>
                      <span>
                        {caller.documentName} · {caller.reference}
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
      </section>
    </div>
  );
}
