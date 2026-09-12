import {
  NetlistParameterNameSchema,
  NetlistParameterValueSchema,
  SignalFlowParametersSchema,
} from "@icm/model";
import type { Instance } from "@icm/model";
import type { ComponentParameter } from "../component-insert/component-parameters";
import {
  effectiveComponentParameterValue,
  updateComponentParameterValues,
} from "../component-insert/component-parameters";
import { differentialInputSibling } from "../editor-shell/differential-input-swap";
import { differentialOutputSibling } from "../editor-shell/differential-output-swap";
import { switchContactStyleSibling } from "../editor-shell/switch-contact-style";
import type { CanvasPropertyField } from "./component-property-fields";

export interface ComponentPropertyDetailsContext {
  parameters: readonly ComponentParameter[];
  modelTarget?: { defaultValue: string; suggestions: readonly string[] };
  signalFlow?: boolean;
}

export interface ComponentPropertyDetailsValue {
  reference?: string;
  parameters?: Record<string, string>;
  netlistTarget?: string;
  symbol?: string;
  signalFlow?: NonNullable<Instance["signalFlowParameters"]>;
}

/** Only the existing pin-compatible drawing variants are interchangeable. */
export function componentSymbolOptions(symbolId: string): string[] {
  const options = new Set([symbolId]);
  for (const candidate of options) {
    for (const sibling of [
      differentialInputSibling(candidate),
      differentialOutputSibling(candidate),
      switchContactStyleSibling(candidate),
    ])
      if (sibling) options.add(sibling);
  }
  return [...options];
}

export function componentPropertyDetailsValue(
  instance: Instance,
  context?: ComponentPropertyDetailsContext,
): ComponentPropertyDetailsValue {
  if (!context) return {};
  return {
    ...(instance.reference ? { reference: instance.reference } : {}),
    ...(instance.netlist
      ? {
          parameters: {
            ...Object.fromEntries(
              context.parameters
                .filter((parameter) => !parameter.compatibilityOnly)
                .map((parameter) => [
                  parameter.key,
                  effectiveComponentParameterValue(instance, parameter),
                ]),
            ),
            ...instance.netlist.parameters,
          },
        }
      : {}),
    ...(context.modelTarget
      ? { netlistTarget: context.modelTarget.defaultValue }
      : {}),
    ...(componentSymbolOptions(instance.symbolId).length > 1
      ? { symbol: instance.symbolId }
      : {}),
    ...(context.signalFlow
      ? { signalFlow: instance.signalFlowParameters ?? {} }
      : {}),
  };
}

export function parseComponentPropertyDetails(
  decoded: Record<string, unknown>,
  instance: Instance,
  context?: ComponentPropertyDetailsContext,
): ComponentPropertyDetailsValue {
  const baseline = componentPropertyDetailsValue(instance, context);
  const result: ComponentPropertyDetailsValue = {};
  for (const key of [
    "reference",
    "parameters",
    "netlistTarget",
    "symbol",
    "signalFlow",
  ] as const) {
    if (!(key in baseline)) {
      if (key in decoded)
        throw new Error(`${key} is not available for this component`);
      continue;
    }
    const value = decoded[key];
    if (key === "parameters") {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error("parameters must be an object of raw string values");
      if (Object.keys(value).length > 128)
        throw new Error("parameters may contain at most 128 entries");
      const names = new Set<string>();
      const entries: [string, string][] = [];
      for (const [name, raw] of Object.entries(value)) {
        if (
          !NetlistParameterNameSchema.safeParse(name).success ||
          name !== name.trim()
        )
          throw new Error(`Invalid parameter name: ${name}`);
        if (names.has(name.toLowerCase()))
          throw new Error(`Duplicate parameter name: ${name}`);
        names.add(name.toLowerCase());
        if (
          typeof raw !== "string" ||
          (raw !== "" && !NetlistParameterValueSchema.safeParse(raw).success)
        )
          throw new Error(
            `parameters.${name} must be a raw string (empty removes it)`,
          );
        entries.push([name, raw]);
      }
      result.parameters = Object.fromEntries(entries);
      // The Digital Clock's primary timing controls still own its legacy
      // pulse-source projection. Reuse that policy rather than leaving the
      // displayed duty cycle disconnected from the waveform sent to SPICE.
      if (instance.symbolId === "pulse-voltage-source") {
        for (const key of ["period", "dutyCycle", "initial"]) {
          const raw = result.parameters[key];
          if (raw !== undefined && raw !== baseline.parameters?.[key])
            result.parameters = updateComponentParameterValues(
              instance.symbolId,
              result.parameters,
              key,
              raw,
            );
        }
      }
    } else if (key === "signalFlow") {
      const parsed = SignalFlowParametersSchema.safeParse(value);
      if (!parsed.success)
        throw new Error(`signalFlow: ${parsed.error.issues[0]?.message}`);
      result.signalFlow = parsed.data;
    } else {
      if (
        typeof value !== "string" ||
        value.length > 128 ||
        (key !== "netlistTarget" && !value.trim())
      )
        throw new Error(
          `${key} must be ${key === "netlistTarget" ? "a" : "a nonempty"} string of at most 128 characters`,
        );
      if (
        key === "symbol" &&
        !componentSymbolOptions(instance.symbolId).includes(value)
      )
        throw new Error(
          "symbol must be one of this component's compatible drawing variants",
        );
      result[key] = value;
    }
  }
  return result;
}

export function componentDetailFields(
  instance: Instance,
  context?: ComponentPropertyDetailsContext,
): CanvasPropertyField[] {
  if (!context) return [];
  return [
    {
      path: "placement",
      label: "Placement",
      kind: "text",
      description: "",
    },
    {
      path: "reference",
      label: "Reference",
      kind: "text",
      description: "Netlist name",
      help: "Unique electrical instance name in this Cell. Double-click the drawing label to edit its visual text independently.",
    },
    {
      path: "parameters",
      label: "Parameters",
      kind: "text",
      description: "",
    },
    ...context.parameters.map((parameter) => ({
      path: `parameters.${parameter.key}`,
      label: parameter.label,
      kind: parameter.options ? ("choice" as const) : ("text" as const),
      ...(parameter.options ? { options: parameter.options } : {}),
      description: parameter.unit ?? "",
    })),
    {
      path: "netlistTarget",
      label: "Model",
      kind: context.modelTarget?.suggestions.length ? "choice" : "text",
      options: [
        ...new Set([
          "",
          ...(context.modelTarget?.suggestions ?? []),
          context.modelTarget?.defaultValue ?? "",
        ]),
      ].map((value) => ({ value, label: value || "None" })),
      description: 'Model name · "": clear',
      help: "Choose a suggested model or type a custom model name in JSON. An empty string clears the target; model compatibility checks still apply.",
    },
    {
      path: "symbol",
      label: "Drawing variant",
      kind: "choice",
      options: componentSymbolOptions(instance.symbolId).map((value) => ({
        value,
        label: value,
      })),
      description: "Pin-compatible variant",
    },
    {
      path: "signalFlow",
      label: "Signal flow",
      kind: "text",
      description: "Presentation only",
    },
  ];
}
