import type { Ref } from "react";

import { deviceDescriptor } from "@icm/devices";
import type { SchematicDocument } from "@icm/model";

import { DisplayToggle } from "../component-insert/display-toggle";
import type { ComponentParameter } from "../component-insert/component-parameters";
import type { AdditionalParameterDraft } from "./additional-parameters";
import { derivedFingerWidth } from "./finger-width";
import { PropertyDisclosure } from "./property-disclosure";

type Instance = SchematicDocument["instances"][number];
const COMPACT_PARAMETER_LABELS = new Set(["W", "L", "NF"]);

const SOURCE_BASE_PARAMETER_ROWS = [
  ["dc", "waveform"],
  ["acMagnitude", "acPhase"],
] as const;

const SOURCE_TRANSIENT_PARAMETER_ROWS = {
  dc: [],
  pulse: [["low", "high"], ["delay"], ["rise", "fall"], ["width", "period"]],
  sin: [
    ["offset", "amplitude"],
    ["frequency", "phase"],
    ["delay", "damping"],
  ],
} as const;

function parameterRows(
  parameters: readonly ComponentParameter[],
  waveform: string | undefined,
): readonly (readonly ComponentParameter[])[] {
  if (!parameters.some(({ key }) => key === "waveform")) {
    return parameters.map((parameter) => [parameter]);
  }

  const byKey = new Map(
    parameters.map((parameter) => [parameter.key, parameter]),
  );
  const transientRows =
    waveform === "pulse" || waveform === "sin"
      ? SOURCE_TRANSIENT_PARAMETER_ROWS[waveform]
      : SOURCE_TRANSIENT_PARAMETER_ROWS.dc;
  const orderedKeys = [...SOURCE_BASE_PARAMETER_ROWS, ...transientRows];
  const used = new Set<string>(orderedKeys.flat());
  return [
    ...orderedKeys
      .map((keys) =>
        keys.flatMap((key) => (byKey.has(key) ? [byKey.get(key)!] : [])),
      )
      .filter((row) => row.length > 0),
    ...parameters
      .filter(({ key }) => !used.has(key))
      .map((parameter) => [parameter]),
  ];
}

export function ComponentElectricalProperties({
  instance,
  parameters,
  parameterValues,
  firstInputRef,
  referenceVisible,
  valueVisible,
  valueAvailable,
  valueSupported,
  referenceAvailable,
  referenceLabelRenderable,
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
   * blocks — never gets one, so a "Visual annotation" toggle would switch something
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
  const descriptor = deviceDescriptor(instance.symbolId);
  const waveform =
    parameterValues.waveform || descriptor?.sourceWaveformDefault;
  const primaryParameters = parameters.filter(
    (parameter) =>
      !parameter.compatibilityOnly &&
      (!parameter.visibleForSourceWaveforms ||
        ((waveform === "pulse" || waveform === "sin") &&
          parameter.visibleForSourceWaveforms.includes(waveform))),
  );
  const primaryParameterRows = parameterRows(primaryParameters, waveform);
  const isIndependentSource = primaryParameters.some(
    ({ key }) => key === "waveform",
  );
  // A toggle that cannot change the drawing is not an option, it is a dead
  // control: schematic-only glyphs neither draw a reference nor carry a
  // value, and a Symbol with no parameters and no netlist has nothing left
  // for this card to say.
  // Offer only what the drawing can actually show: a reference this
  // instance has and this Symbol draws, and a value this device supports.
  const referenceToggleable = referenceLabelRenderable && referenceAvailable;
  const displayable = referenceToggleable || valueSupported;
  const isMos = descriptor?.deviceClass === "mos";
  if (primaryParameters.length === 0 && !displayable && !instance.netlist) {
    return null;
  }
  return (
    <PropertyDisclosure
      title="Parameters"
      className="property-electrical-section"
      ariaLabel="Component parameters and display"
      defaultOpen
    >
      <div className="component-parameter-grid">
        {primaryParameterRows.map((row) => (
          <div
            className="component-parameter-row"
            data-parameter-row={row.map(({ key }) => key).join("-")}
            key={row.map(({ key }) => key).join("-")}
          >
            {row.map((parameter) => (
              <label
                key={parameter.key}
                title={isIndependentSource ? undefined : parameter.help}
              >
                <span className="property-parameter-name">
                  {parameter.label}
                  {parameter.unit ? ` / ${parameter.unit}` : ""}
                  {isIndependentSource ||
                  (isMos &&
                    COMPACT_PARAMETER_LABELS.has(parameter.label)) ? null : (
                    <em>({parameter.help})</em>
                  )}
                </span>
                {parameter.options ? (
                  <select
                    aria-label={`Component ${parameter.label.toLowerCase()}`}
                    value={parameterValues[parameter.key] ?? ""}
                    onChange={(event) =>
                      onParameterChange(
                        parameter.key,
                        event.currentTarget.value,
                      )
                    }
                  >
                    {parameter.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    ref={
                      parameter.key === primaryParameters[0]?.key
                        ? firstInputRef
                        : undefined
                    }
                    aria-label={`Component ${parameter.label.toLowerCase()}`}
                    inputMode={parameter.inputMode}
                    value={parameterValues[parameter.key] ?? ""}
                    placeholder={parameter.placeholder}
                    onChange={(event) =>
                      onParameterChange(
                        parameter.key,
                        event.currentTarget.value,
                      )
                    }
                  />
                )}
              </label>
            ))}
          </div>
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
                    : "Visual annotation"
                }
                checked={referenceVisible}
                onChange={onReferenceVisibilityChange}
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
            <span>Netlist overrides</span>
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
    </PropertyDisclosure>
  );
}
