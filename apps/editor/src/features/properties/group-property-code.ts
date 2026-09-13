import { NetlistParameterValueSchema, type Instance } from "@icm/model";
import {
  effectiveComponentParameterValue,
  type ComponentParameter,
} from "../component-insert/component-parameters";
import {
  CANVAS_PROPERTY_FIELDS,
  colorToRgb,
  parseCanvasColor,
} from "./component-property-fields";
import {
  propertyCodeSpans,
  type PropertyCodeSpan,
} from "./component-property-code-assists";

export type GroupPropertyMixedValue = boolean | "";
export type GroupPropertyColor = "auto" | `#${string}` | "";

export interface GroupPropertyCodeValue {
  symbol: string;
  parameters: Record<string, string> | "";
  display: {
    visualAnnotation: GroupPropertyMixedValue;
    value?: GroupPropertyMixedValue;
  };
  appearance: {
    foreground: GroupPropertyColor;
  };
}

export interface GroupPropertyCodeContext {
  symbol: string;
  /** Null when selection types or parameter contracts are incompatible. */
  parameters: Record<string, string> | null;
  parameterFields?: readonly ComponentParameter[];
  reference: GroupPropertyMixedValue;
  value: GroupPropertyMixedValue | null;
  foreground: GroupPropertyColor;
}

export type GroupPropertyCodeParseResult =
  { ok: true; value: GroupPropertyCodeValue } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const key = Object.keys(value).find(
    (candidate) => !allowed.includes(candidate),
  );
  if (key) throw new Error(`${path}.${key} is not a supported property`);
}

function parseMixedBoolean(
  value: unknown,
  path: string,
): GroupPropertyMixedValue {
  if (typeof value === "boolean") return value;
  if (value === "") return value;
  throw new Error(
    `${path} must be true, false, or an empty string to keep individual values`,
  );
}

/** Strict JSON surface for properties shared by a component selection. */
export function parseGroupPropertyCode(
  source: string,
  context: GroupPropertyCodeContext,
): GroupPropertyCodeParseResult {
  try {
    const decoded: unknown = JSON.parse(source);
    if (!isRecord(decoded))
      throw new Error("Property code must be a JSON object");
    assertKeys(
      decoded,
      ["display", "appearance", "symbol", "parameters"],
      "selection",
    );
    if (decoded.symbol !== context.symbol)
      throw new Error(
        "symbol shows the common component type and is read-only in a batch",
      );
    let parameters: GroupPropertyCodeValue["parameters"] = "";
    if (context.parameters === null) {
      if (decoded.parameters !== "")
        throw new Error(
          "Select components of the same type to edit parameters together",
        );
    } else {
      if (!isRecord(decoded.parameters))
        throw new Error("parameters must be an object");
      assertKeys(
        decoded.parameters,
        Object.keys(context.parameters),
        "parameters",
      );
      parameters = {};
      for (const key of Object.keys(context.parameters)) {
        const raw = decoded.parameters[key];
        if (
          typeof raw !== "string" ||
          (raw !== "" && !NetlistParameterValueSchema.safeParse(raw).success)
        )
          throw new Error(
            `parameters.${key} must be a string; leave it empty to keep individual values`,
          );
        parameters[key] = raw;
      }
    }
    if (!isRecord(decoded.display))
      throw new Error("display must be an object");
    const displayKeys =
      context.value === null
        ? ["visualAnnotation"]
        : ["visualAnnotation", "value"];
    assertKeys(decoded.display, displayKeys, "display");
    if (!("visualAnnotation" in decoded.display))
      throw new Error("display.visualAnnotation is required");
    const display: GroupPropertyCodeValue["display"] = {
      visualAnnotation: parseMixedBoolean(
        decoded.display.visualAnnotation,
        "display.visualAnnotation",
      ),
    };
    if (context.value !== null) {
      if (!("value" in decoded.display))
        throw new Error("display.value is required");
      display.value = parseMixedBoolean(decoded.display.value, "display.value");
    }
    if (!isRecord(decoded.appearance))
      throw new Error("appearance must be an object");
    assertKeys(decoded.appearance, ["foreground"], "appearance");
    if (!("foreground" in decoded.appearance))
      throw new Error("appearance.foreground is required");
    const foreground =
      decoded.appearance.foreground === ""
        ? ""
        : parseCanvasColor(
            decoded.appearance.foreground,
            "appearance.foreground",
          );
    return {
      ok: true,
      value: {
        symbol: context.symbol,
        parameters,
        display,
        appearance: { foreground },
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Invalid property code",
    };
  }
}

export function groupPropertyCodeValue(
  context: GroupPropertyCodeContext,
): GroupPropertyCodeValue {
  return {
    symbol: context.symbol,
    parameters: context.parameters ?? "",
    display: {
      visualAnnotation: context.reference,
      ...(context.value === null ? {} : { value: context.value }),
    },
    appearance: { foreground: context.foreground },
  };
}

export function serializeGroupPropertyCode(
  value: GroupPropertyCodeValue,
): string {
  const source = JSON.stringify(
    {
      appearance: {
        foreground:
          value.appearance.foreground === "auto" ||
          value.appearance.foreground === ""
            ? value.appearance.foreground
            : colorToRgb(value.appearance.foreground),
      },
      display: value.display,
      parameters: value.parameters,
      symbol: value.symbol,
    },
    null,
    2,
  );
  return source.replace(
    /\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/gu,
    "[$1, $2, $3]",
  );
}

export function formatGroupPropertyCode(
  context: GroupPropertyCodeContext,
): string {
  return serializeGroupPropertyCode(groupPropertyCodeValue(context));
}

/** Inline controls patch only their own valid JSON value. */
export function groupPropertyCodeChanges(
  source: string,
  context: GroupPropertyCodeContext,
  values: Readonly<Record<string, unknown>>,
): readonly { from: number; to: number; insert: string }[] {
  try {
    JSON.parse(source);
  } catch {
    return [];
  }
  const spans = groupPropertyCodeSpans(source, context);
  const changes = Object.entries(values).map(([path, value]) => {
    const matches = spans.filter((item) => item.field.path === path);
    const span = matches.length === 1 ? matches[0] : undefined;
    return span
      ? { from: span.from, to: span.to, insert: JSON.stringify(value) }
      : null;
  });
  if (changes.some((change) => change === null)) return [];
  let candidate = source;
  for (const change of changes
    .filter((item) => item !== null)
    .sort((a, b) => b.from - a.from))
    candidate =
      candidate.slice(0, change.from) +
      change.insert +
      candidate.slice(change.to);
  return parseGroupPropertyCode(candidate, context).ok
    ? changes.filter((item) => item !== null).sort((a, b) => a.from - b.from)
    : [];
}

export function groupPropertyCodeSpans(
  source: string,
  context: GroupPropertyCodeContext,
): PropertyCodeSpan[] {
  return propertyCodeSpans(source, undefined, [
    ...CANVAS_PROPERTY_FIELDS,
    ...(context.parameterFields ?? []).map((field) => ({
      path: `parameters.${field.key}`,
      label: field.label,
      kind: field.options ? ("choice" as const) : ("text" as const),
      ...(field.options ? { options: field.options } : {}),
      description: field.unit ?? "",
    })),
  ]);
}

export function commonGroupValue<T>(values: readonly T[]): T | "" {
  const first = values[0];
  return first !== undefined && values.every((value) => value === first)
    ? first
    : "";
}

/** Compare rendered ink, including document inheritance and equivalent hex spellings. */
export function groupForeground(
  instances: readonly Instance[],
  defaultForeground: string,
): GroupPropertyColor {
  return commonGroupValue(
    instances.map((instance) =>
      parseCanvasColor(
        colorToRgb(instance.styleOverride?.foreground ?? defaultForeground),
        "foreground",
      ),
    ),
  );
}

export function groupParameterContext(
  instances: readonly Instance[],
  parametersFor: (instance: Instance) => readonly ComponentParameter[],
): Pick<GroupPropertyCodeContext, "symbol" | "parameters" | "parameterFields"> {
  const symbol = commonGroupValue(
    instances.map((instance) => instance.symbolId),
  );
  const first = instances[0];
  const bindingKey = (instance: Instance) => {
    const binding = instance.netlist?.binding;
    return binding?.kind === "external-subcircuit"
      ? `external:${binding.definitionId}`
      : binding?.kind === "subcircuit"
        ? `subcircuit:${binding.childDocumentId}`
        : binding?.kind === "unresolved-subcircuit"
          ? `unresolved:${binding.name}`
          : binding?.kind === "primitive" || binding?.kind === "model"
            ? binding.deviceClass
            : "";
  };
  if (
    !first ||
    !symbol ||
    instances.some(
      (instance) =>
        !instance.netlist || bindingKey(instance) !== bindingKey(first),
    )
  )
    return { symbol, parameters: null };
  const fields = parametersFor(first).filter(
    (field) => !field.compatibilityOnly,
  );
  const keys = new Set([
    ...fields.map((field) => field.key),
    ...instances.flatMap((instance) =>
      Object.keys(instance.netlist!.parameters),
    ),
  ]);
  const parameters = Object.fromEntries(
    [...keys].map((key) => {
      const field = fields.find((field) => field.key === key);
      return [
        key,
        commonGroupValue(
          instances.map((instance) =>
            field
              ? effectiveComponentParameterValue(instance, field)
              : (instance.netlist!.parameters[key] ?? ""),
          ),
        ),
      ];
    }),
  );
  return { symbol, parameters, parameterFields: fields };
}
