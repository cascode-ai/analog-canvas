import type { Ref } from "react";

import { deviceDescriptor } from "@icm/devices";
import type { SchematicDocument } from "@icm/model";

import { DisplayToggle } from "../component-insert/display-toggle";
import type { ComponentParameter } from "../component-insert/component-parameters";
import type { AdditionalParameterDraft } from "./additional-parameters";
import { derivedFingerWidth } from "./finger-width";

type Instance = SchematicDocument["instances"][number];
const COMPACT_PARAMETER_LABELS = new Set(["W", "L", "NF"]);

export function ComponentElectricalProperties({
  instance,
  parameters,
  parameterValues,
  firstInputRef,
  referenceVisible,
  referencePrefix,
  referencePrefixHidden,
  valueVisible,
  valueAvailable,
  valueSupported,
  referenceAvailable,
  referenceLabelRenderable,
  additionalParameters,
  additionalParametersChanged,
  onParameterChange,
  onReferenceVisibilityChange,
  onReferencePrefixHiddenChange,
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
  /**
   * The device Reference prefix this instance is designated with, or null
   * when the device policy demands none. It labels the prefix switch, so a
   * capacitor offers `C` rather than a hard-coded `R`.
   */
  referencePrefix: string | null;
  referencePrefixHidden: boolean;
  valueVisible: boolean;
  valueAvailable: boolean;
  /**
   * Whether this device can ever annotate a value. A switch designates S1 and
   * carries no value at all, so its Value toggle would switch nothing. This
   * is not the same as {@link valueAvailable}, which is false only until the
   * parameters are filled in and keeps its toggle so the remedy is visible.
   */
  valueSupported: boolean;
  /**
   * Whether this instance has a reference designator to show. A part with no
   * device descriptor — a voltage amplifier, an op amp, the signal-flow
   * blocks — never gets one, so a "Reference" toggle would switch something
   * that does not exist. Read from the reference policy rather than a list of
   * Symbol names, so a Symbol added later is right without anyone editing it.
   */
  referenceAvailable: boolean;
  /**
   * Whether this Symbol can draw a reference label at all. A Symbol that
   * declares `labelVisibility: "hidden"` — a summing junction, a 1/s block,
   * Ground — never shows one, so the toggle cannot do anything.
   */
  referenceLabelRenderable: boolean;
  additionalParameters: readonly AdditionalParameterDraft[];
  additionalParametersChanged: boolean;
  onParameterChange: (key: string, value: string) => void;
  onReferenceVisibilityChange: (visible: boolean) => void;
  onReferencePrefixHiddenChange: (hidden: boolean) => void;
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
  // A toggle that cannot change the drawing is not an option, it is a dead
  // control: schematic-only glyphs neither draw a reference nor carry a
  // value, and a Symbol with no parameters and no netlist has nothing left
  // for this card to say.
  // Offer only what the drawing can actually show: a reference this
  // instance has and this Symbol draws, and a value this device supports.
  const referenceToggleable = referenceLabelRenderable && referenceAvailable;
  const displayable = referenceToggleable || valueSupported;
  const isMos = deviceDescriptor(instance.symbolId)?.deviceClass === "mos";
  if (primaryParameters.length === 0 && !displayable && !instance.netlist) {
    return null;
  }
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
              {isMos && COMPACT_PARAMETER_LABELS.has(parameter.label) ? null : (
                <em>({parameter.help})</em>
              )}
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
      {displayable ? (
        <div className="property-display-card">
          <div className="property-section-heading">Display</div>
          <div
            className="display-toggle-row"
            aria-label="Component display toggles"
          >
            {referenceToggleable ? (
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
            ) : null}
            {referenceToggleable && referencePrefix ? (
              <DisplayToggle
                label={`Prefix ${referencePrefix}`}
                checked={!referencePrefixHidden}
                disabled={!referenceVisible}
                help={`Clear this to draw the Reference without its leading ${referencePrefix}. The Reference itself is unchanged, so allocation and the exported netlist keep it.`}
                testId="reference-prefix-toggle"
                onChange={(checked) => onReferencePrefixHiddenChange(!checked)}
              />
            ) : null}
            {valueSupported ? (
              <DisplayToggle
                label="Value"
                checked={valueVisible}
                disabled={!valueAvailable}
                help={
                  valueAvailable ? undefined : "Set the device parameters first"
                }
                onChange={onValueVisibilityChange}
              />
            ) : null}
          </div>
        </div>
      ) : null}
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
