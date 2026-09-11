import {
  NetlistParameterNameSchema,
  NetlistParameterValueSchema,
  SignalFlowParametersSchema,
} from "@icm/model";
import type { Instance } from "@icm/model";
import type { ComponentParameter } from "../component-insert/component-parameters";
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
                .map((parameter) => [parameter.key, ""]),
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
      description:
        'Set null to return to the Placement Tray without deleting the component; set {at: [x, y], rotation: 0, mirror: "none"} to place it.',
    },
    {
      path: "reference",
      label: "Reference",
      kind: "text",
      description: "Authored netlist reference; must be unique in this Cell.",
    },
    {
      path: "parameters",
      label: "Parameters",
      kind: "text",
      description:
        "Raw strings, including W/L/NF/M and netlist overrides. Add keys here; empty strings or removed keys clear values. Units are never appended.",
    },
    ...context.parameters.map((parameter) => ({
      path: `parameters.${parameter.key}`,
      label: parameter.label,
      kind: parameter.options ? ("choice" as const) : ("text" as const),
      ...(parameter.options ? { options: parameter.options } : {}),
      description: `${parameter.help}${parameter.defaultValue ? ` Default: ${parameter.defaultValue}.` : ""} Enter any unit suffix yourself.`,
    })),
    {
      path: "netlistTarget",
      label: "Netlist target",
      kind: "text",
      description: `Model name; "" clears it. ${context.modelTarget?.suggestions.length ? `Suggestions: ${context.modelTarget.suggestions.join(", ")}. ` : ""}Reviewed external models use an X reference.`,
    },
    {
      path: "symbol",
      label: "Drawing variant",
      kind: "choice",
      options: componentSymbolOptions(instance.symbolId).map((value) => ({
        value,
        label: value,
      })),
      description:
        "Pin-compatible drawing variants: swap input/output polarity or switch contact circles without losing connections.",
    },
    {
      path: "signalFlow",
      label: "Signal flow",
      kind: "text",
      description:
        "Presentation only: formula, coefficient, bodyWidth (20–1000), bodyHeight (20–500); dimensions are multiples of 10. {} uses symbol defaults.",
    },
  ];
}
