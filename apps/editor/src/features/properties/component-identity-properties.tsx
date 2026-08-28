import { defaultDraftTextDocument, flattenRichText } from "@icm/model";
import type { SchematicDocument } from "@icm/model";

import type { CapacitorPlatePropertyRow } from "./capacitor-plate-properties";

type Instance = SchematicDocument["instances"][number];

export interface ComponentModelTargetView {
  defaultValue: string;
  suggestions: readonly string[];
  listId?: string;
  externalSubcircuit: boolean;
}

export function componentTargetDescription(
  instance: Instance,
  internalCellName?: string,
  externalSubcircuitName?: string,
): string {
  const binding = instance.netlist?.binding;
  switch (binding?.kind) {
    case "primitive":
      return `Built-in primitive: ${binding.deviceClass}`;
    case "subcircuit":
      return `Internal Cell: ${internalCellName ?? "unresolved"}`;
    case "external-subcircuit":
      return `External subcircuit: ${externalSubcircuitName ?? "unresolved"}`;
    case "unresolved-subcircuit":
      return `Unresolved subcircuit: ${binding.name}`;
    default:
      return "No target is bound yet.";
  }
}

export function ComponentIdentityProperties({
  instance,
  revision,
  cellName,
  formalTerminalSelected,
  portNet,
  targetDescription,
  capacitorPlateRows,
  modelTarget,
  onMarkerNameChange,
  onSchematicNameChange,
  onReferenceChange,
  onModelTargetChange,
}: {
  instance: Instance;
  revision: number;
  cellName: string;
  formalTerminalSelected: boolean;
  portNet: { id: string; logicalName: string; supply: boolean } | null;
  targetDescription: string | null;
  capacitorPlateRows: readonly CapacitorPlatePropertyRow[] | null;
  modelTarget: ComponentModelTargetView | null;
  onMarkerNameChange: (value: string) => void;
  onSchematicNameChange: (value: string) => void;
  onReferenceChange: (value: string) => void;
  onModelTargetChange: (value: string) => void;
}) {
  return (
    <>
      <div
        className="property-card property-identity-card"
        aria-label="Component identity"
      >
        <div className="property-section-heading">Identity</div>
        <dl className="component-readonly-fields">
          {portNet && !formalTerminalSelected ? (
            <div>
              <dt>{portNet.supply ? "Supply" : "Net name"}</dt>
              <dd>
                <input
                  dir="auto"
                  key={`${portNet.id}-${revision}-net-port-name`}
                  aria-label={
                    portNet.supply ? "Supply name" : "Supply Net name"
                  }
                  defaultValue={portNet.logicalName}
                  onBlur={(event) =>
                    onMarkerNameChange(event.currentTarget.value)
                  }
                />
              </dd>
            </div>
          ) : !formalTerminalSelected ? (
            <div>
              <dt>Schematic label</dt>
              <dd>
                <input
                  dir="auto"
                  key={`${instance.id}-${revision}-schematic-label`}
                  aria-label="Component schematic label"
                  defaultValue={flattenRichText(
                    instance.schematicName ??
                      defaultDraftTextDocument(
                        instance.schematicReference ??
                          instance.netlist?.reference ??
                          "",
                      ),
                  )}
                  placeholder="Schematic label"
                  onBlur={(event) =>
                    onSchematicNameChange(event.currentTarget.value)
                  }
                />
              </dd>
            </div>
          ) : null}
          {instance.netlist ? (
            <div>
              <dt>Netlist reference</dt>
              <dd>
                <input
                  dir="auto"
                  key={`${instance.id}-${revision}-netlist-reference`}
                  aria-label="Component netlist reference"
                  defaultValue={instance.netlist.reference}
                  onBlur={(event) =>
                    onReferenceChange(event.currentTarget.value)
                  }
                />
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Symbol</dt>
            <dd>{instance.symbolId}</dd>
          </div>
          <div>
            <dt>Cell</dt>
            <dd>{cellName}</dd>
          </div>
          {targetDescription ? (
            <div className="property-identity-target">
              <dt>Target</dt>
              <dd>{targetDescription}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      {capacitorPlateRows ? (
        <div
          className="property-card property-terminal-card"
          role="group"
          aria-label="Capacitor plate terminals"
        >
          <div className="property-section-heading">Electrical terminals</div>
          <dl className="component-readonly-fields">
            {capacitorPlateRows.map((row) => (
              <div key={row.role}>
                <dt>{row.label}</dt>
                <dd aria-label={`${row.label} terminal`}>
                  Pin {row.pinName} ·{" "}
                  {row.netName ?? row.netId ?? "Unconnected"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {modelTarget ? (
        <div
          className="property-card property-target-card"
          aria-label="Netlist target"
        >
          <div className="property-section-heading">Netlist target</div>
          <label>
            Model
            <input
              dir="auto"
              key={`${instance.id}-${revision}-model-target`}
              aria-label="Component model target"
              list={modelTarget.listId}
              defaultValue={modelTarget.defaultValue}
              placeholder="Model name"
              onBlur={(event) => onModelTargetChange(event.currentTarget.value)}
            />
            {modelTarget.listId ? (
              <datalist id={modelTarget.listId}>
                {modelTarget.suggestions.map((model) => (
                  <option value={model} key={model} />
                ))}
              </datalist>
            ) : null}
            {modelTarget.externalSubcircuit ? (
              <small>External subcircuit · X reference</small>
            ) : null}
          </label>
        </div>
      ) : null}
    </>
  );
}
