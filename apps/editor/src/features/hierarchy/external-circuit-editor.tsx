import { useEffect, useState } from "react";
import type { ExternalSubcircuitDefinition } from "@icm/model";
import { createId } from "@icm/model";
import type { ExternalDefinitionResult } from "./project-structure-commands";

/** Project-level external declaration; there is no local schematic body. */
export function ExternalCircuitEditor({
  definition,
  onSetExternalDefinition,
}: {
  definition: ExternalSubcircuitDefinition | undefined;
  onSetExternalDefinition(
    definition: ExternalSubcircuitDefinition,
  ): ExternalDefinitionResult;
}) {
  const [result, setResult] = useState<ExternalDefinitionResult | null>(null);
  const [externalName, setExternalName] = useState("");
  const [externalTerminals, setExternalTerminals] = useState("");
  const [externalParameters, setExternalParameters] = useState("");

  useEffect(() => {
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
        Interface for an external model, not a local schematic. Terminals must
        match the model’s port order. Simulation also requires the external
        model implementation in its source files.
      </p>
      <div className="cell-external-grid">
        <label>
          Target
          <input
            aria-label="External subcircuit target"
            placeholder="amplifier"
            value={externalName}
            onChange={(event) => setExternalName(event.currentTarget.value)}
          />
        </label>
        <label>
          Ordered terminals
          <input
            aria-label="External subcircuit terminals"
            placeholder="INP, INN, OUT"
            value={externalTerminals}
            onChange={(event) =>
              setExternalTerminals(event.currentTarget.value)
            }
          />
        </label>
        <label>
          Formal parameters
          <input
            aria-label="External subcircuit formal parameters"
            placeholder="gain=10, bias"
            value={externalParameters}
            onChange={(event) =>
              setExternalParameters(event.currentTarget.value)
            }
          />
        </label>
        <button
          type="button"
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
          {definition ? "Save definition" : "Create External Circuit"}
        </button>
      </div>
      {result ? (
        <p role={result.ok ? "status" : "alert"}>{result.message}</p>
      ) : null}
    </section>
  );
}
