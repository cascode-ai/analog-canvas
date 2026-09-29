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
/**
 * One value per selected component, keyed by the component's Reference.
 * Where the components differ, the batch says what each one has.
 */
export type GroupPerItem<T> = Readonly<Record<string, T>>;
type ItemColor = "auto" | `#${string}`;

/** A batch's name where the selected parts show different names. */
export const GROUP_NAME_AS_IS = "as is";

export interface GroupPropertyCodeValue {
  symbol: string;
  /**
   * The name every selected part shows, or "as is" where they differ: one
   * name written there names them all (see `planGroupNaming`). Each part's
   * name by its key still renames each one by its own entry.
   */
  names?: GroupPerItem<string> | string;
  parameters: Record<string, string | GroupPerItem<string>> | "";
  display: {
    visualAnnotation: GroupPropertyMixedValue | GroupPerItem<boolean>;
    value?: GroupPropertyMixedValue | GroupPerItem<boolean>;
  };
  appearance: {
    color: GroupPropertyColor | GroupPerItem<ItemColor>;
  };
}

/** One selected component, as the batch lists it where values differ. */
export interface GroupPropertyItem {
  /** Its Reference, or its ID where it has none or it repeats. */
  key: string;
  instanceId: string;
  /** Its name: a Pin's name, else its Reference. */
  name: string;
  /**
   * The name its label shows: its display alias, else its name; null when
   * it carries no name (a ground). Absent, it shows its name.
   */
  shown?: string | null;
  parameters: Readonly<Record<string, string>>;
  reference: boolean;
  /** Null when the component shows no value. */
  value: boolean | null;
  foreground: ItemColor;
}

export interface GroupPropertyCodeContext {
  symbol: string;
  /**
   * The parameters every selected component has, each with the value they
   * share or "" where they differ; null when they share none.
   */
  parameters: Record<string, string> | null;
  /** Label, unit and choices of each parameter every component describes alike. */
  parameterFields?: readonly ComponentParameter[];
  /**
   * Parameters whose meaning differs by component type — a resistor's value
   * and a capacitor's: each component takes its own, never one for all.
   */
  perComponentParameters?: readonly string[];
  reference: GroupPropertyMixedValue;
  value: GroupPropertyMixedValue | null;
  foreground: GroupPropertyColor;
  /** The components themselves; absent, a difference shows as "". */
  items?: readonly GroupPropertyItem[];
}

/** Dictionary keys: a Reference, unless it is missing or repeated. */
export function groupPropertyItemKeys(
  instances: readonly Pick<Instance, "id" | "reference">[],
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const instance of instances)
    if (instance.reference)
      counts.set(instance.reference, (counts.get(instance.reference) ?? 0) + 1);
  return new Map(
    instances.map((instance) => [
      instance.id,
      instance.reference && counts.get(instance.reference) === 1
        ? instance.reference
        : instance.id,
    ]),
  );
}

/**
 * Each component's own value, whether or not they are the same: a
 * parameter reads who has what, and an entry changed changes that one.
 */
function eachItem<T>(
  items: readonly GroupPropertyItem[] | undefined,
  pick: (item: GroupPropertyItem) => T | null,
): GroupPerItem<T> | null {
  const entries = (items ?? []).flatMap((item) => {
    const value = pick(item);
    return value === null ? [] : [[item.key, value] as const];
  });
  return entries.length > 1 ? Object.fromEntries(entries) : null;
}

/** Each component's own value, where they are not all the same. */
function perItem<T>(
  items: readonly GroupPropertyItem[] | undefined,
  pick: (item: GroupPropertyItem) => T | null,
): GroupPerItem<T> | null {
  const entries = (items ?? []).flatMap((item) => {
    const value = pick(item);
    return value === null ? [] : [[item.key, value] as const];
  });
  const distinct = new Set(entries.map(([, value]) => JSON.stringify(value)));
  return entries.length > 1 && distinct.size > 1
    ? Object.fromEntries(entries)
    : null;
}

/** The selected components, as a batch lists them where they differ. */
export function groupPropertyItems(
  instances: readonly Instance[],
  options: {
    parametersFor: (instance: Instance) => readonly ComponentParameter[];
    parameterKeys: readonly string[];
    nameOf: (instance: Instance) => string;
    /** The name its label shows; null when it carries none. */
    shownNameOf?: (instance: Instance) => string | null;
    referenceVisible: (instance: Instance) => boolean;
    valueVisible: (instance: Instance) => boolean | null;
    defaultForeground: string;
  },
): GroupPropertyItem[] {
  const keys = groupPropertyItemKeys(instances);
  return instances.map((instance) => {
    const fields = options.parametersFor(instance);
    return {
      key: keys.get(instance.id)!,
      instanceId: instance.id,
      name: options.nameOf(instance),
      ...(options.shownNameOf ? { shown: options.shownNameOf(instance) } : {}),
      parameters: Object.fromEntries(
        options.parameterKeys.map((key) => {
          const field = fields.find((candidate) => candidate.key === key);
          return [
            key,
            field
              ? effectiveComponentParameterValue(instance, field)
              : (instance.netlist?.parameters[key] ?? ""),
          ];
        }),
      ),
      reference: options.referenceVisible(instance),
      value: options.valueVisible(instance),
      foreground: parseCanvasColor(
        colorToRgb(
          instance.styleOverride?.foreground ?? options.defaultForeground,
        ),
        "color",
      ),
    };
  });
}

/**
 * The name the selected parts all show, or "as is" where they show
 * different names; "" when there is no batch or no part carries a name.
 */
export function groupPropertyItemNames(
  context: Pick<GroupPropertyCodeContext, "items">,
): string {
  const items = context.items ?? [];
  if (items.length < 2) return "";
  const shown = items.flatMap((item) =>
    item.shown === null ? [] : [item.shown ?? item.name],
  );
  if (shown.length === 0) return "";
  return shown.every((name) => name === shown[0])
    ? shown[0]!
    : GROUP_NAME_AS_IS;
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
  context: GroupPropertyCodeContext,
): GroupPropertyMixedValue | GroupPerItem<boolean> {
  if (typeof value === "boolean") return value;
  if (value === "") return value;
  if (isRecord(value))
    return parsePerItem(value, path, context, (raw, entryPath) => {
      if (typeof raw !== "boolean")
        throw new Error(`${entryPath} must be true or false`);
      return raw;
    });
  throw new Error(
    `${path} must be true, false, one value per component, or an empty string to keep individual values`,
  );
}

/** A dictionary of one value per selected component, keyed as shown. */
function parsePerItem<T>(
  value: Record<string, unknown>,
  path: string,
  context: GroupPropertyCodeContext,
  entry: (raw: unknown, path: string) => T,
): GroupPerItem<T> {
  const keys = new Set((context.items ?? []).map((item) => item.key));
  return Object.fromEntries(
    Object.entries(value).map(([key, raw]) => {
      if (!keys.has(key))
        throw new Error(`${path}.${key} is not one of the selected components`);
      return [key, entry(raw, `${path}.${key}`)];
    }),
  );
}

const parameterValue = (raw: unknown, path: string): string => {
  if (
    typeof raw !== "string" ||
    (raw !== "" && !NetlistParameterValueSchema.safeParse(raw).success)
  )
    throw new Error(
      `${path} must be a string; leave it empty to keep individual values`,
    );
  return raw;
};

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
      ["display", "appearance", "symbol", "parameters", "names"],
      "selection",
    );
    let names: GroupPerItem<string> | string | undefined;
    if (typeof decoded.names === "string") {
      // One name for them all; "as is" leaves each its own.
      if (decoded.names.trim() !== "") names = decoded.names.trim();
    } else if (decoded.names !== undefined) {
      if (!isRecord(decoded.names))
        throw new Error(
          "name is one name for them all, or one name per selected component",
        );
      names = parsePerItem(decoded.names, "name", context, (raw, path) => {
        if (typeof raw !== "string" || raw.trim() === "")
          throw new Error(`${path} must be a name`);
        return raw.trim();
      });
    }
    if (decoded.symbol !== context.symbol)
      throw new Error(
        "symbol shows the common component type and is read-only in a batch",
      );
    let parameters: GroupPropertyCodeValue["parameters"] = "";
    if (context.parameters === null) {
      if (decoded.parameters !== "")
        throw new Error("The selected components share no parameters");
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
        if (isRecord(raw)) {
          parameters[key] = parsePerItem(
            raw,
            `parameters.${key}`,
            context,
            parameterValue,
          );
          continue;
        }
        const single = parameterValue(raw, `parameters.${key}`);
        if (single !== "" && context.perComponentParameters?.includes(key))
          throw new Error(
            `parameters.${key} means something different on each component type; give each component its own value`,
          );
        parameters[key] = single;
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
        context,
      ),
    };
    if (context.value !== null) {
      if (!("value" in decoded.display))
        throw new Error("display.value is required");
      display.value = parseMixedBoolean(
        decoded.display.value,
        "display.value",
        context,
      );
    }
    if (!isRecord(decoded.appearance))
      throw new Error("appearance must be an object");
    assertKeys(decoded.appearance, ["color"], "appearance");
    if (!("color" in decoded.appearance))
      throw new Error("appearance.color is required");
    const color =
      decoded.appearance.color === ""
        ? ""
        : isRecord(decoded.appearance.color)
          ? parsePerItem(
              decoded.appearance.color,
              "appearance.color",
              context,
              (raw, path) => parseCanvasColor(raw, path),
            )
          : parseCanvasColor(decoded.appearance.color, "appearance.color");
    return {
      ok: true,
      value: {
        symbol: context.symbol,
        ...(names ? { names } : {}),
        parameters,
        display,
        appearance: { color },
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
  const { items } = context;
  const names = groupPropertyItemNames(context);
  return {
    symbol: context.symbol,
    ...(names === "" ? {} : { names }),
    // Every shared parameter by each component, as names are; one value
    // written in place of the list still sets them all.
    parameters:
      context.parameters === null
        ? ""
        : Object.fromEntries(
            Object.entries(context.parameters).map(([key, common]) => [
              key,
              eachItem(items, (item) => item.parameters[key] ?? "") ?? common,
            ]),
          ),
    display: {
      visualAnnotation:
        perItem(items, (item) => item.reference) ?? context.reference,
      ...(context.value === null
        ? {}
        : { value: perItem(items, (item) => item.value) ?? context.value }),
    },
    appearance: {
      color: perItem(items, (item) => item.foreground) ?? context.foreground,
    },
  };
}

const colorCode = (color: ItemColor | "") =>
  color === "auto" || color === "" ? color : colorToRgb(color);

export function serializeGroupPropertyCode(
  value: GroupPropertyCodeValue,
): string {
  const color = value.appearance.color;
  const source = JSON.stringify(
    {
      appearance: {
        color:
          typeof color === "string"
            ? colorCode(color)
            : Object.fromEntries(
                Object.entries(color).map(([key, entry]) => [
                  key,
                  colorCode(entry),
                ]),
              ),
      },
      display: value.display,
      ...(value.names ? { names: value.names } : {}),
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
  const fields = [
    ...CANVAS_PROPERTY_FIELDS,
    ...(context.parameterFields ?? []).map((field) => ({
      path: `parameters.${field.key}`,
      label: field.label,
      kind: field.options ? ("choice" as const) : ("text" as const),
      ...(field.options ? { options: field.options } : {}),
      description: field.unit ?? "",
    })),
  ];
  // Where components differ, each has its own entry and its own control;
  // the dictionary that holds them has none.
  const perItem = fields.filter(
    (field) =>
      field.path === "display.visualAnnotation" ||
      field.path === "display.value" ||
      field.path === "appearance.color" ||
      field.path.startsWith("parameters."),
  );
  const perItemFields = perItem.flatMap((field) =>
    (context.items ?? []).map((item) => ({
      ...field,
      path: `${field.path}.${item.key}`,
      label: `${field.label} · ${item.key}`,
    })),
  );
  const dictionaries = new Set(perItem.map((field) => field.path));
  return propertyCodeSpans(source, undefined, [
    ...fields,
    ...perItemFields,
  ]).filter(
    (span) => !(dictionaries.has(span.field.path) && isRecord(span.value)),
  );
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
        "color",
      ),
    ),
  );
}

/**
 * The parameters every selected component has, whatever its type — an NMOS
 * and a PMOS share their width and length. The batch lists each one per
 * component, so a key that means something different on each type, such as
 * a resistor's and a capacitor's value, is still edited component by
 * component; only a key every component describes alike also takes one
 * value for all.
 */
export function groupParameterContext(
  instances: readonly Instance[],
  parametersFor: (instance: Instance) => readonly ComponentParameter[],
): Pick<
  GroupPropertyCodeContext,
  "symbol" | "parameters" | "parameterFields" | "perComponentParameters"
> {
  const symbol = commonGroupValue(
    instances.map((instance) => instance.symbolId),
  );
  if (instances.length === 0 || instances.some((instance) => !instance.netlist))
    return { symbol, parameters: null };
  // A value one component of a type carries explicitly, its siblings of the
  // same type have too, as an empty entry.
  const explicit = new Map<string, Set<string>>();
  for (const instance of instances) {
    const keys = explicit.get(instance.symbolId) ?? new Set<string>();
    for (const key of Object.keys(instance.netlist!.parameters)) keys.add(key);
    explicit.set(instance.symbolId, keys);
  }
  const own = instances.map((instance) => {
    const fields = parametersFor(instance).filter(
      (field) => !field.compatibilityOnly,
    );
    return {
      instance,
      fields,
      keys: new Set([
        ...fields.map((field) => field.key),
        ...explicit.get(instance.symbolId)!,
      ]),
    };
  });
  const shared = [...own[0]!.keys].filter((key) =>
    own.every((entry) => entry.keys.has(key)),
  );
  if (shared.length === 0) return { symbol, parameters: null };
  const fieldOf = (entry: (typeof own)[number], key: string) =>
    entry.fields.find((field) => field.key === key);
  const parameters = Object.fromEntries(
    shared.map((key) => [
      key,
      commonGroupValue(
        own.map((entry) => {
          const field = fieldOf(entry, key);
          return field
            ? effectiveComponentParameterValue(entry.instance, field)
            : (entry.instance.netlist!.parameters[key] ?? "");
        }),
      ),
    ]),
  );
  const description = (field: ComponentParameter | undefined) =>
    JSON.stringify(
      field
        ? [
            field.label,
            field.unit ?? "",
            field.options ?? null,
            field.definitionParameter ?? false,
          ]
        : null,
    );
  const alike = (key: string) =>
    new Set(own.map((entry) => description(fieldOf(entry, key)))).size === 1;
  const parameterFields = shared.flatMap((key) => {
    const field = fieldOf(own[0]!, key);
    return field && alike(key) ? [field] : [];
  });
  const perComponentParameters = shared.filter((key) => !alike(key));
  return {
    symbol,
    parameters,
    parameterFields,
    ...(perComponentParameters.length ? { perComponentParameters } : {}),
  };
}
