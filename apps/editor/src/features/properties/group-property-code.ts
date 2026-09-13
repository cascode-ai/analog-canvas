import { colorToRgb, parseCanvasColor } from "./component-property-fields";
import {
  propertyCodeSpans,
  type PropertyCodeSpan,
} from "./component-property-code-assists";

export type GroupPropertyMixedValue = boolean | "mixed";
export type GroupPropertyColor = "auto" | `#${string}` | "mixed";

export interface GroupPropertyCodeValue {
  display: {
    visualAnnotation: GroupPropertyMixedValue;
    value?: GroupPropertyMixedValue;
  };
  appearance: {
    foreground: GroupPropertyColor;
  };
}

export interface GroupPropertyCodeContext {
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
  current: GroupPropertyMixedValue,
  path: string,
): GroupPropertyMixedValue {
  if (typeof value === "boolean") return value;
  if (value === "mixed" && current === "mixed") return value;
  throw new Error(`${path} must be true, false, or "mixed"`);
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
    assertKeys(decoded, ["display", "appearance"], "selection");
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
        context.reference,
        "display.visualAnnotation",
      ),
    };
    if (context.value !== null) {
      if (!("value" in decoded.display))
        throw new Error("display.value is required");
      display.value = parseMixedBoolean(
        decoded.display.value,
        context.value,
        "display.value",
      );
    }
    if (!isRecord(decoded.appearance))
      throw new Error("appearance must be an object");
    assertKeys(decoded.appearance, ["foreground"], "appearance");
    if (!("foreground" in decoded.appearance))
      throw new Error("appearance.foreground is required");
    const foreground =
      decoded.appearance.foreground === "mixed" &&
      context.foreground === "mixed"
        ? "mixed"
        : parseCanvasColor(
            decoded.appearance.foreground,
            "appearance.foreground",
          );
    return { ok: true, value: { display, appearance: { foreground } } };
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
      display: value.display,
      appearance: {
        foreground:
          value.appearance.foreground === "auto" ||
          value.appearance.foreground === "mixed"
            ? value.appearance.foreground
            : colorToRgb(value.appearance.foreground),
      },
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
  const spans = propertyCodeSpans(source);
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

export function groupPropertyCodeSpans(source: string): PropertyCodeSpan[] {
  return propertyCodeSpans(source);
}

export function commonGroupValue<T>(values: readonly T[]): T | "mixed" {
  const first = values[0];
  return first !== undefined && values.every((value) => value === first)
    ? first
    : "mixed";
}
