import type { FocusEvent, KeyboardEvent } from "react";

import type { SchematicDocument } from "@icm/model";

import type { CapacitorPlatePropertyRow } from "./capacitor-plate-properties";

type Instance = SchematicDocument["instances"][number];

export interface ComponentModelTargetView {
  defaultValue: string;
  suggestions: readonly string[];
  listId?: string;
  externalSubcircuit: boolean;
}

function commitIdentityInput(
  event: FocusEvent<HTMLInputElement>,
  savedValue: string,
  commit: (value: string) => boolean | void,
): void {
  if (commit(event.currentTarget.value) === false) {
    event.currentTarget.value = savedValue;
  }
}

function handleIdentityInputKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  savedValue: string,
): void {
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.value = savedValue;
    event.currentTarget.blur();
  }
}

export function componentTargetDescription(
  instance: Instance,
  internalCellName?: string,
  externalSubcircuitName?: string,
): string | null {
  const binding = instance.netlist?.binding;
  switch (binding?.kind) {
    case "primitive":
      return null;
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
  propertyTerminal,
  modelTarget,
  onMarkerNameChange,
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
  propertyTerminal?: {
    label: string;
    pinName: string;
    netId: string | null;
    options: readonly { netId: string; label: string }[];
    onChange: (netId: string | null) => void;
  } | null;
  modelTarget: ComponentModelTargetView | null;
  onMarkerNameChange: (value: string) => void;
  onReferenceChange: (value: string) => boolean | void;
  onModelTargetChange: (value: string) => void;
}) {
  const reference = instance.reference ?? "";
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
          ) : null}
          {instance.reference ? (
            <div>
              <dt>Reference</dt>
              <dd>
                <input
                  dir="auto"
                  key={`${instance.id}-${revision}-reference`}
                  aria-label="Component reference"
                  defaultValue={reference}
                  onBlur={(event) =>
                    commitIdentityInput(event, reference, onReferenceChange)
                  }
                  onKeyDown={(event) =>
                    handleIdentityInputKeyDown(event, reference)
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
      {propertyTerminal ? (
        <div
          className="property-card property-terminal-card"
          role="group"
          aria-label="Property-only electrical terminals"
        >
          <div className="property-section-heading">Electrical terminals</div>
          <label>
            {propertyTerminal.label}
            <select
              aria-label={propertyTerminal.label}
              value={propertyTerminal.netId ?? ""}
              onChange={(event) =>
                propertyTerminal.onChange(event.currentTarget.value || null)
              }
            >
              <option value="">Unconnected</option>
              {propertyTerminal.options.map((option) => (
                <option value={option.netId} key={option.netId}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>Property-only terminal · no canvas pin or wire</small>
          </label>
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
              <small>External subcircuit · SPICE emits an X card</small>
            ) : null}
          </label>
        </div>
      ) : null}
    </>
  );
}
