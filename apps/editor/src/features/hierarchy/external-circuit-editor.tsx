import { useEffect, useState } from "react";
import type { CircuitProject, ExternalSubcircuitDefinition } from "@icm/model";
import { createId } from "@icm/model";
import { resolveReviewedExternalBinding } from "@icm/devices";
import type { ExternalDefinitionResult } from "./project-structure-commands";
import {
  ExternalModelSourceEditor,
  type ApplyModelSourceEdit,
} from "./external-model-source-editor";
import type { ProjectStructureEdit } from "@icm/edit-engine";
import type { SimulationSourceLocation } from "@icm/simulation-service/contract";

/**
 * Project-level external declaration; there is no local schematic body. The
 * interface reads as one card: the grid is plain content and every action sits
 * in the card footer instead of floating around the fields.
 */
export function ExternalCircuitEditor({
  definition,
  initialLocation,
  project,
  onApplyModelSource,
  onSaveModelDraft,
  onSetExternalDefinition,
  onRemoveExternalDefinition,
  onPlace,
  onDirtyChange,
  onRequestLeave,
}: {
  project: CircuitProject;
  definition: ExternalSubcircuitDefinition | undefined;
  initialLocation?: SimulationSourceLocation | undefined;
  onApplyModelSource(edit: ApplyModelSourceEdit): ExternalDefinitionResult;
  onSaveModelDraft(
    edits: ProjectStructureEdit[],
    definitionId: string,
  ): ExternalDefinitionResult;
  onSetExternalDefinition(
    definition: ExternalSubcircuitDefinition,
  ): ExternalDefinitionResult;
  onRemoveExternalDefinition(definitionId: string): ExternalDefinitionResult;
  onPlace(definitionId: string): void;
  onDirtyChange(dirty: boolean): void;
  onRequestLeave(action: () => void): void;
}) {
  const [result, setResult] = useState<ExternalDefinitionResult | null>(null);
  const [externalName, setExternalName] = useState("");
  const [externalTerminals, setExternalTerminals] = useState("");
  const [externalParameters, setExternalParameters] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [placeholder, setPlaceholder] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const reviewed =
    definition &&
    !definition.implementation &&
    resolveReviewedExternalBinding(
      definition.name,
      definition.terminals.map((item) => item.name),
    );

  useEffect(() => {
    setConfirmDelete(false);
    if (!definition) {
      setExternalName("");
      setExternalTerminals("");
      setExternalParameters("");
      return;
    }
    setExternalName(definition.name);
    setExternalTerminals(
      definition.terminals.map((terminal) => terminal.name).join(", "),
    );
    setExternalParameters(
      definition.formalParameters
        .map((parameter) =>
          parameter.defaultValue === undefined
            ? parameter.name
            : `${parameter.name}=${parameter.defaultValue}`,
        )
        .join(", "),
    );
  }, [definition]);

  if (
    !reviewed &&
    !placeholder &&
    (sourceMode ||
      !definition ||
      definition.implementation?.kind === "source" ||
      (definition.implementation?.kind === "placeholder" &&
        definition.implementation.sourceId))
  )
    return (
      <ExternalModelSourceEditor
        project={project}
        definition={definition}
        initialLocation={initialLocation}
        onApply={onApplyModelSource}
        onPlace={onPlace}
        onDirtyChange={onDirtyChange}
        onRequestLeave={onRequestLeave}
        onSaveDraft={onSaveModelDraft}
        onMetadata={onSetExternalDefinition}
        onPlaceholder={() => setPlaceholder(true)}
        onDelete={() => onRemoveExternalDefinition(definition?.id ?? "")}
      />
    );

  function submitDefinition(): void {
    const target = externalName.trim();
    if (!target) {
      setResult({
        ok: false,
        message: "Enter an external model target name.",
      });
      return;
    }
    const fields = externalParameters
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [name, ...defaultParts] = item.split("=");
        const defaultValue = defaultParts.join("=").trim();
        return {
          name: name!.trim(),
          ...(defaultValue ? { defaultValue } : {}),
        };
      });
    setResult(
      onSetExternalDefinition({
        ...definition,
        id: definition?.id ?? createId("external-subcircuit"),
        name: target,
        terminals: externalTerminals
          .split(/[,，\s]+/u)
          .map((item) => item.trim())
          .filter(Boolean)
          .map((name) => {
            const existing = definition?.terminals.find(
              (terminal) => terminal.name.toLowerCase() === name.toLowerCase(),
            );
            return {
              id: existing?.id ?? createId("external-terminal"),
              name,
              direction: existing?.direction ?? ("passive" as const),
            };
          }),
        formalParameters: fields,
        interfaceStatus: "declared",
        ...(!definition && !reviewed
          ? { implementation: { kind: "placeholder" as const } }
          : {}),
      }),
    );
  }

  return (
    <section
      className="cell-interface-section"
      aria-label="External circuit interface"
    >
      <header>
        <div>
          <h3>Interface</h3>
          <p>
            {reviewed
              ? `${reviewed.libraryId} · fixed PDK interface. Set parameters on instances.`
              : definition?.implementation?.kind === "placeholder"
                ? "Unimplemented placeholder · attach a Project model before simulation."
                : "Legacy interface · model ownership has not been verified. Attach the matching Project model explicitly."}
          </p>
        </div>
        {definition ? (
          <span className="cell-count-badge">
            {definition.terminals.length}
          </span>
        ) : null}
      </header>
      <div className="cell-external-grid">
        <label>
          Target
          <input
            aria-label="External subcircuit target"
            autoComplete="off"
            placeholder="amplifier"
            value={externalName}
            readOnly={Boolean(reviewed)}
            onChange={(event) => setExternalName(event.currentTarget.value)}
          />
        </label>
        <label>
          Ordered terminals
          <input
            aria-label="External subcircuit terminals"
            autoComplete="off"
            placeholder="INP, INN, OUT"
            value={externalTerminals}
            readOnly={Boolean(reviewed)}
            onChange={(event) =>
              setExternalTerminals(event.currentTarget.value)
            }
          />
        </label>
        <label>
          Formal parameters
          <input
            aria-label="External subcircuit formal parameters"
            autoComplete="off"
            placeholder="gain=10, bias"
            value={externalParameters}
            readOnly={Boolean(reviewed)}
            onChange={(event) =>
              setExternalParameters(event.currentTarget.value)
            }
          />
        </label>
      </div>
      {result ? (
        <p
          className="cell-external-result"
          role={result.ok ? "status" : "alert"}
        >
          {result.message}
        </p>
      ) : null}
      <footer className="cell-external-actions">
        {definition ? (
          <div className="cell-external-actions-lead">
            <button type="button" onClick={() => onPlace(definition.id)}>
              Place
            </button>
            {reviewed ? null : (
              <button type="button" onClick={() => setSourceMode(true)}>
                Define implementation…
              </button>
            )}
            {confirmDelete ? (
              <>
                <span className="cell-manager-confirm">
                  Delete {definition.name}?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setResult(onRemoveExternalDefinition(definition.id));
                    setConfirmDelete(false);
                  }}
                >
                  Confirm delete
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)}>
                Delete definition
              </button>
            )}
          </div>
        ) : null}
        <button
          type="button"
          className="primary"
          disabled={Boolean(reviewed)}
          onClick={submitDefinition}
        >
          {definition ? "Save definition" : "Create External Circuit Def"}
        </button>
      </footer>
    </section>
  );
}
