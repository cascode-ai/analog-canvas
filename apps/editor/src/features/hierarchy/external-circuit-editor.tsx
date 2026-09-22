import { useEffect, useState } from "react";
import type { ExternalSubcircuitDefinition } from "@icm/model";
import { createId } from "@icm/model";
import { resolveReviewedExternalBinding } from "@icm/devices";
import type { ExternalDefinitionResult } from "./project-structure-commands";

/** Project-level external declaration; there is no local schematic body. */
export function ExternalCircuitEditor({
  definition,
  onSetExternalDefinition,
  onRemoveExternalDefinition,
}: {
  definition: ExternalSubcircuitDefinition | undefined;
  onSetExternalDefinition(
    definition: ExternalSubcircuitDefinition,
  ): ExternalDefinitionResult;
  onRemoveExternalDefinition(definitionId: string): ExternalDefinitionResult;
}) {
  const [result, setResult] = useState<ExternalDefinitionResult | null>(null);
  const [externalName, setExternalName] = useState("");
  const [externalTerminals, setExternalTerminals] = useState("");
  const [externalParameters, setExternalParameters] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const reviewed =
    definition &&
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

  return (
    <section aria-label="External circuit interface">
      <p className="cell-interface-empty">
        {reviewed
          ? `${reviewed.libraryId} · fixed PDK interface. Set parameters on instances.`
          : "Interface only · supply the model in Simulation sources. Terminal order must match the model."}
      </p>
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
        <button
          type="button"
          disabled={Boolean(reviewed)}
          onClick={() => {
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
                      (terminal) =>
                        terminal.name.toLowerCase() === name.toLowerCase(),
                    );
                    return {
                      id: existing?.id ?? createId("external-terminal"),
                      name,
                      direction: existing?.direction ?? ("passive" as const),
                    };
                  }),
                formalParameters: fields,
                interfaceStatus: "declared",
              }),
            );
          }}
        >
          {definition ? "Save definition" : "Create External Circuit Def"}
        </button>
      </div>
      {definition ? (
        <div className="cell-manager-actions">
          {confirmDelete ? (
            <>
              <span>Delete {definition.name}?</span>
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
      {result ? (
        <p role={result.ok ? "status" : "alert"}>{result.message}</p>
      ) : null}
    </section>
  );
}
