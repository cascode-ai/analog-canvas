import { useEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

import type { SchematicDocument } from "@icm/model";
import { deviceDescriptor } from "@icm/devices";

import type { CapacitorPlatePropertyRow } from "./capacitor-plate-properties";
import type { ComponentSourceCode } from "./component-source-code";

type Instance = SchematicDocument["instances"][number];

export interface ComponentModelTargetView {
  defaultValue: string;
  suggestions: readonly string[];
  externalSubcircuit: boolean;
}

const CUSTOM_MODEL_OPTION = "__custom_model__";

function ModelTargetControl({
  instanceId,
  revision,
  modelTarget,
  onChange,
}: {
  instanceId: string;
  revision: number;
  modelTarget: ComponentModelTargetView;
  onChange: (value: string) => void;
}) {
  const current = modelTarget.defaultValue.trim();
  const currentIsSuggestion = modelTarget.suggestions.includes(current);
  const currentIsCustom = current !== "" && !currentIsSuggestion;
  const [customMode, setCustomMode] = useState(currentIsCustom);
  const [customDraft, setCustomDraft] = useState(
    currentIsCustom ? current : "",
  );
  const [focusCustom, setFocusCustom] = useState(false);
  const customInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCustomMode(currentIsCustom);
    setCustomDraft(currentIsCustom ? current : "");
    setFocusCustom(false);
  }, [instanceId, revision, current, currentIsCustom]);

  useEffect(() => {
    if (!customMode || !focusCustom) return;
    customInput.current?.focus();
    setFocusCustom(false);
  }, [customMode, focusCustom]);

  const restoreCurrent = (): void => {
    setCustomMode(currentIsCustom);
    setCustomDraft(currentIsCustom ? current : "");
  };
  const commitCustom = (): void => {
    const next = customDraft.trim();
    if (!next) {
      restoreCurrent();
      return;
    }
    onChange(next);
  };

  return (
    <>
      <label>
        Model
        <select
          key={`${instanceId}-${revision}-model-target`}
          aria-label="Component model target"
          value={customMode ? CUSTOM_MODEL_OPTION : current}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next === CUSTOM_MODEL_OPTION) {
              setCustomMode(true);
              setCustomDraft(currentIsCustom ? current : "");
              setFocusCustom(true);
              return;
            }
            setCustomMode(false);
            setCustomDraft("");
            onChange(next);
          }}
        >
          <option value="">None</option>
          {modelTarget.suggestions.map((model) => (
            <option value={model} key={model}>
              {model}
            </option>
          ))}
          <option value={CUSTOM_MODEL_OPTION}>Custom…</option>
        </select>
      </label>
      {customMode ? (
        <label>
          Custom model
          <input
            ref={customInput}
            dir="auto"
            aria-label="Custom model name"
            value={customDraft}
            placeholder="Model name"
            onChange={(event) => setCustomDraft(event.currentTarget.value)}
            onBlur={commitCustom}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.blur();
              }
            }}
          />
        </label>
      ) : null}
    </>
  );
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
  if (
    !binding &&
    deviceDescriptor(instance.symbolId)?.targetPolicy === "builtin"
  ) {
    return null;
  }
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
  formalTerminalSelected,
  portNet,
  targetDescription,
  capacitorPlateRows,
  propertyTerminal,
  modelTarget,
  sourceCode,
  onEditAnnotation,
  onMarkerNameChange,
  onReferenceChange,
  onModelTargetChange,
}: {
  instance: Instance;
  revision: number;
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
  sourceCode: ComponentSourceCode;
  onEditAnnotation?: () => void;
  onMarkerNameChange: (value: string) => void;
  onReferenceChange: (value: string) => boolean | void;
  onModelTargetChange: (value: string) => void;
}) {
  const reference = instance.reference ?? "";
  const hasEditableIdentityControls = Boolean(
    (portNet && !formalTerminalSelected) ||
    instance.reference ||
    onEditAnnotation ||
    targetDescription,
  );
  return (
    <>
      {hasEditableIdentityControls ? (
        <div
          className="property-card component-identity-controls"
          aria-label="Component controls"
        >
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
                <dt>Netlist Reference</dt>
                <dd>
                  <input
                    dir="auto"
                    key={`${instance.id}-${revision}-reference`}
                    aria-label="Netlist Reference"
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
            {onEditAnnotation ? (
              <div>
                <dt>Visual annotation</dt>
                <dd>
                  <button type="button" onClick={onEditAnnotation}>
                    Edit annotation
                  </button>
                </dd>
              </div>
            ) : null}
            {targetDescription ? (
              <div className="property-identity-target">
                <dt>Target</dt>
                <dd>{targetDescription}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
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
          <ModelTargetControl
            instanceId={instance.id}
            revision={revision}
            modelTarget={modelTarget}
            onChange={onModelTargetChange}
          />
          {modelTarget.externalSubcircuit ? (
            <small>External subcircuit · SPICE emits an X card</small>
          ) : null}
        </div>
      ) : null}
      <div
        className="component-source-code"
        aria-label="SPICE component code"
        data-exact={sourceCode.exact}
      >
        <code>{sourceCode.code}</code>
        {sourceCode.note ? <small>{sourceCode.note}</small> : null}
      </div>
    </>
  );
}
