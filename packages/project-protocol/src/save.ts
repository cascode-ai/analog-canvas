import { withProjectComponentDefinitions } from "@icm/symbols";
import type { CircuitProject } from "@icm/model";

import { validateProject } from "./load.js";
import { encodeProjectFile } from "./owned-project-file.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    const order = Array.isArray(value.documents)
      ? [
          "schemaVersion",
          "id",
          "name",
          "topDocumentId",
          "defaults",
          "documents",
          "componentDefinitions",
          "externalSubcircuitDefinitions",
          "simulationFolders",
          "source",
          "symbolLibrary",
          "structureRevision",
        ]
      : Array.isArray(value.instances) && Array.isArray(value.nets)
        ? [
            "id",
            "name",
            "netlist",
            "presentation",
            "instances",
            "routes",
            "connections",
            "nets",
            "junctions",
            "annotations",
            "drafting",
            "mosBulkDefaults",
            "connectivityEvidence",
            "layoutGroups",
            "constraints",
            "sourceBinding",
            "sourceStatus",
            "revision",
          ]
        : typeof value.type === "string" && "coordinate" in value
          ? [
              "type",
              "name",
              "id",
              "variant",
              "coordinate",
              "rotation",
              "mirror",
              "color",
              "backgroundColor",
              "parameters",
              "target",
              "control",
              "labels",
            ]
          : [];
    const rank = (key: string) =>
      order.indexOf(key) < 0 ? order.length : order.indexOf(key);
    return Object.fromEntries(
      Object.keys(value)
        .sort(
          (left, right) =>
            rank(left) - rank(right) ||
            (left < right ? -1 : left > right ? 1 : 0),
        )
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

export function serializeProject(project: CircuitProject): string {
  const value = sortKeys(
    encodeProjectFile(
      validateProject(
        withProjectComponentDefinitions(validateProject(project)),
      ),
    ),
  );
  return `${projectJson(value)}\n`;
}

function inlineJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inlineJson).join(", ")}]`;
  if (isRecord(value))
    return `{ ${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${JSON.stringify(key)}: ${inlineJson(item)}`)
      .join(", ")} }`;
  return JSON.stringify(value) ?? "null";
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

/** Keep authored objects as blocks; small coordinates and property values
 * read naturally on one line. This is ordinary editable JSON, not an encoded
 * payload or a positional table of device attributes. */
function projectJson(value: unknown, path: string[] = []): string {
  const array = Array.isArray(value);
  if (!array && !isRecord(value)) return JSON.stringify(value) ?? "null";
  const entries = Object.entries(value as object).filter(
    ([, item]) => array || item !== undefined,
  );
  const [open, close] = array ? ["[", "]"] : ["{", "}"];
  if (!entries.length) return `${open}${close}`;
  const smallValue = array
    ? value.every(isScalar)
    : entries.every(
        ([, item]) =>
          isScalar(item) || (Array.isArray(item) && item.every(isScalar)),
      );
  // Every instance, label, definition, route and other collection entry stays
  // an object block, even when it happens to have very few attributes.
  const collectionObject = !array && /^\d+$/.test(path.at(-1) ?? "");
  if (smallValue && !collectionObject) {
    const line = inlineJson(value);
    const keyWidth =
      array || !path.length ? 0 : JSON.stringify(path.at(-1)).length + 2;
    if (path.length * 2 + keyWidth + line.length <= 100) return line;
  }
  return `${open}\n${entries
    .map(
      ([key, item]) =>
        `${"  ".repeat(path.length + 1)}${array ? "" : `${JSON.stringify(key)}: `}${projectJson(item, [...path, key])}`,
    )
    .join(",\n")}\n${"  ".repeat(path.length)}${close}`;
}
