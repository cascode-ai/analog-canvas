import type { Ref } from "react";

import type { SchematicDocument } from "@icm/model";

import { DisplayToggle } from "../component-insert/display-toggle";
import type { ComponentParameter } from "../component-insert/component-parameters";
import type { AdditionalParameterDraft } from "./additional-parameters";
import { derivedFingerWidth } from "./finger-width";

type Instance = SchematicDocument["instances"][number];

export function ComponentElectricalProperties({
  instance,
  parameters,
  parameterValues,
  firstInputRef,
  referenceVisible,
  valueVisible,
  valueAvailable,
  additionalParameters,
  additionalParametersChanged,
  onParameterChange,
  onReferenceVisibilityChange,
  onValueVisibilityChange,
  onAdditionalParameterChange,
  onAdditionalParameterRemove,
  onAdditionalParameterAdd,
  onAdditionalParametersApply,
  onAdditionalParametersCancel,
}: {
  instance: Instance;
  parameters: readonly ComponentParameter[];
  parameterValues: Readonly<Record<string, string>>;
  firstInputRef: Ref<HTMLInputElement>;
  referenceVisible: boolean;
  valueVisible: boolean;
  valueAvailable: boolean;
  additionalParameters: readonly AdditionalParameterDraft[];
  additionalParametersChanged: boolean;
  onParameterChange: (key: string, value: string) => void;
  onReferenceVisibilityChange: (visible: boolean) => void;
  onValueVisibilityChange: (visible: boolean) => void;
  onAdditionalParameterChange: (
    id: string,
    change: Partial<Pick<AdditionalParameterDraft, "name" | "value">>,
  ) => void;
  onAdditionalParameterRemove: (id: string) => void;
  onAdditionalParameterAdd: () => void;
  onAdditionalParametersApply: () => void;
  onAdditionalParametersCancel: () => void;
}) {
  const fingerWidth = derivedFingerWidth(parameterValues.w, parameterValues.nf);
  const primaryParameters = parameters.filter(
    (parameter) => !parameter.compatibilityOnly,
  );
  return (
    <div
      className="property-card property-electrical-section"
      aria-label="Component parameters and display"
    >
      <div className="property-section-heading">Parameters</div>
      <div className="component-parameter-grid">
        {primaryParameters.map((parameter, index) => (
          <label key={parameter.key} title={parameter.help}>
            <span className="property-parameter-name">
              {parameter.label}
              {parameter.unit ? ` / ${parameter.unit}` : ""}
              <em>({parameter.help})</em>
            </span>
            <input
              ref={index === 0 ? firstInputRef : undefined}
              aria-label={`Component ${parameter.label.toLowerCase()}`}
              inputMode={parameter.inputMode}
              value={parameterValues[parameter.key] ?? ""}
              placeholder={parameter.placeholder}
              onChange={(event) =>
                onParameterChange(parameter.key, event.currentTarget.value)
              }
            />
          </label>
        ))}
      </div>
      {fingerWidth ? (
        <p className="property-derived-note" data-testid="derived-finger-width">
          Finger width {fingerWidth} · W = FW × NF
        </p>
      ) : null}
      <div className="property-display-card">
        <div className="property-section-heading">Display</div>
        <div
          className="display-toggle-row"
          aria-label="Component display toggles"
        >
          <DisplayToggle
            label={
              instance.symbolId === "port" ||
              instance.symbolId === "port-filled"
                ? "Port label"
                : "Reference"
            }
            checked={referenceVisible}
            onChange={onReferenceVisibilityChange}
          />
          <DisplayToggle
            label="Value"
            checked={valueVisible}
            disabled={!valueAvailable}
            help={
              valueAvailable ? undefined : "Set the device parameters first"
            }
            onChange={onValueVisibilityChange}
          />
        </div>
      </div>
      {instance.netlist ? (
        <details className="property-details property-details-inline">
          <summary>
            <span>Advanced parameters</span>
            <small>{additionalParameters.length}</small>
          </summary>
          <div
            className="additional-parameters"
            aria-label="Additional parameters"
          >
            <small>
              Model- or dialect-specific raw values. Apply commits all rows as
              one undoable edit.
            </small>
            {additionalParameters.map((parameter, index) => (
              <div className="component-geometry-row" key={parameter.id}>
                <label>
                  Name
                  <input
                    aria-label={`Additional parameter name ${index + 1}`}
                    value={parameter.name}
                    onChange={(event) =>
                      onAdditionalParameterChange(parameter.id, {
                        name: event.currentTarget.value,
                      })
                    }
                  />
                </label>
                <label>
                  Value
                  <input
                    aria-label={`Additional parameter value ${index + 1}`}
                    value={parameter.value}
                    onChange={(event) =>
                      onAdditionalParameterChange(parameter.id, {
                        value: event.currentTarget.value,
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  aria-label={`Remove additional parameter ${index + 1}`}
                  onClick={() => onAdditionalParameterRemove(parameter.id)}
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="component-mirror-row">
              <button type="button" onClick={onAdditionalParameterAdd}>
                Add parameter
              </button>
              {additionalParametersChanged ? (
                <>
                  <button type="button" onClick={onAdditionalParametersApply}>
                    Apply parameters
                  </button>
                  <button type="button" onClick={onAdditionalParametersCancel}>
                    Cancel parameter edits
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
