import { useEffect, useState } from "react";
import type { ExternalSubcircuitDefinition } from "@icm/model";

/** Project-level external declaration; there is no local schematic body. */
export function ExternalCircuitEditor({
  definition,
  onSetExternalDefinition,
}: {
  definition: ExternalSubcircuitDefinition | undefined;
  onSetExternalDefinition(definition: ExternalSubcircuitDefinition): void;
}) {
  const externalId = definition?.id ?? "__new__";
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
        match the model’s port order.
      </p>
      <div className="cell-external-grid">
        <label>
          Target
          <input
            aria-label="External subcircuit target"
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
            if (!target) return;
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
            onSetExternalDefinition({
              ...definition,
              id:
                externalId === "__new__"
                  ? `external-subcircuit-${target
                      .toLowerCase()
                      .replaceAll(/[^a-z0-9_-]/gu, "-")}`
                  : externalId,
              name: target,
              terminals: externalTerminals
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
                .map((name, index) => {
                  const existing = definition?.terminals.find(
                    (terminal) =>
                      terminal.name.toLowerCase() === name.toLowerCase(),
                  );
                  return {
                    id:
                      existing?.id ??
                      `external-terminal-${externalId === "__new__" ? target.toLowerCase().replaceAll(/[^a-z0-9_-]/gu, "-") : externalId}-${index + 1}`,
                    name,
                    direction: existing?.direction ?? ("passive" as const),
                  };
                }),
              formalParameters: fields,
              interfaceStatus: "declared",
            });
          }}
        >
          Apply definition
        </button>
      </div>
    </section>
  );
}
