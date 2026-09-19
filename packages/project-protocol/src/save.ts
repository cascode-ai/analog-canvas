import { withProjectComponentDefinitions } from "@icm/symbols";
import type { CircuitProject } from "@icm/model";

import { validateProject } from "./load.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

export function serializeProject(project: CircuitProject): string {
  const value = sortKeys(
    validateProject(withProjectComponentDefinitions(validateProject(project))),
  );
  return `${projectJson(value)}\n`;
}

function inlineJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inlineJson).join(", ")}]`;
  if (isRecord(value))
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${JSON.stringify(key)}: ${inlineJson(item)}`)
      .join(", ")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Keep every class attribute, but put each pin/path/parameter on one line.
 * Geometry points do not need five lines apiece in an editable Project. */
function projectJson(value: unknown, path: string[] = []): string {
  const compact =
    path[0] === "componentDefinitions" &&
    (["pins", "primitives", "additionalPrimitives", "parameters"].includes(
      path.at(-2) ?? "",
    ) ||
      [
        "viewBox",
        "at",
        "from",
        "to",
        "center",
        "bounds",
        "formulaPresentation",
      ].includes(path.at(-1) ?? ""));
  if (compact) return inlineJson(value);
  const array = Array.isArray(value);
  if (!array && !isRecord(value)) return JSON.stringify(value) ?? "null";
  const entries = Object.entries(value as object).filter(
    ([, item]) => array || item !== undefined,
  );
  const [open, close] = array ? ["[", "]"] : ["{", "}"];
  if (!entries.length) return `${open}${close}`;
  return `${open}\n${entries
    .map(
      ([key, item]) =>
        `${"  ".repeat(path.length + 1)}${array ? "" : `${JSON.stringify(key)}: `}${projectJson(item, [...path, key])}`,
    )
    .join(",\n")}\n${"  ".repeat(path.length)}${close}`;
}
