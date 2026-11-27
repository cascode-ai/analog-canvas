import { withProjectComponentDefinitions } from "@icm/symbols";
import { isFrozenSnapshot, type CircuitProject } from "@icm/model";

import {
  tryParseProjectWithMetadata,
  validateProjectReadSnapshot,
} from "./load.js";
import {
  CURRENT_PROJECT_FILE_VERSION,
  MAX_READABLE_PROJECT_FILE_VERSION,
  encodeProjectFile,
} from "./owned-project-file.js";

export class ProjectWriterNotActiveError extends Error {
  constructor() {
    super(
      "This Project needs a newer writer. Keep your draft and retry after the regional update.",
    );
    this.name = "ProjectWriterNotActiveError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PROJECT_KEY_ORDER = new Map(
  [
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
  ].map((key, index) => [key, index]),
);
const DOCUMENT_KEY_ORDER = new Map(
  [
    "id",
    "name",
    "netlist",
    "presentation",
    "drawingOrder",
    "instances",
    "instanceGroups",
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
    "inductorCouplings",
    "sourceBinding",
    "sourceStatus",
    "revision",
  ].map((key, index) => [key, index]),
);
const INSTANCE_KEY_ORDER = new Map(
  [
    "type",
    "name",
    "id",
    "variant",
    "coordinate",
    "rotation",
    "mirror",
    "color",
    "backgroundColor",
    "bodyFill",
    "parameters",
    "target",
    "control",
    "labels",
  ].map((key, index) => [key, index]),
);

function keyOrderForRecord(
  value: Record<string, unknown>,
): ReadonlyMap<string, number> | undefined {
  if (Array.isArray(value.documents)) return PROJECT_KEY_ORDER;
  if (Array.isArray(value.instances) && Array.isArray(value.nets))
    return DOCUMENT_KEY_ORDER;
  if (typeof value.type === "string" && "coordinate" in value)
    return INSTANCE_KEY_ORDER;
  return undefined;
}

function sortedKeysOf(value: Record<string, unknown>): {
  keys: string[];
  alreadySorted: boolean;
} {
  const keys = Object.keys(value);
  const length = keys.length;
  if (length <= 1) return { keys, alreadySorted: true };
  const order = keyOrderForRecord(value);
  if (order) {
    const fallback = order.size;
    let alreadySorted = true;
    let prevKey = keys[0]!;
    let prevRank = order.get(prevKey) ?? fallback;
    for (let i = 1; i < length; i += 1) {
      const key = keys[i]!;
      const rank = order.get(key) ?? fallback;
      if (rank < prevRank || (rank === prevRank && key < prevKey)) {
        alreadySorted = false;
        break;
      }
      prevKey = key;
      prevRank = rank;
    }
    if (!alreadySorted) {
      keys.sort(
        (left, right) =>
          (order.get(left) ?? fallback) - (order.get(right) ?? fallback) ||
          (left < right ? -1 : left > right ? 1 : 0),
      );
    }
    return { keys, alreadySorted };
  }
  let alreadySorted = true;
  for (let i = 1; i < length; i += 1) {
    if (keys[i]! < keys[i - 1]!) {
      alreadySorted = false;
      break;
    }
  }
  if (!alreadySorted) keys.sort();
  return { keys, alreadySorted };
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let copy: unknown[] | undefined;
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      if (item === null || typeof item !== "object") continue;
      const next = sortKeys(item);
      if (next !== item) {
        copy ??= value.slice();
        copy[i] = next;
      }
    }
    return copy ?? value;
  }
  const record = value as Record<string, unknown>;
  const { keys, alreadySorted } = sortedKeysOf(record);
  if (alreadySorted) {
    let copy: Record<string, unknown> | undefined;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]!;
      const item = record[key];
      if (item === null || typeof item !== "object") {
        if (copy) copy[key] = item;
        continue;
      }
      const next = sortKeys(item);
      if (next !== item) {
        if (!copy) {
          copy = {};
          for (let j = 0; j < i; j += 1) {
            const priorKey = keys[j]!;
            copy[priorKey] = record[priorKey];
          }
        }
        copy[key] = next;
      } else if (copy) {
        copy[key] = item;
      }
    }
    return copy ?? record;
  }
  const sorted: Record<string, unknown> = {};
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    sorted[key] = sortKeys(record[key]);
  }
  return sorted;
}

function encodedFile(
  project: CircuitProject,
  version = CURRENT_PROJECT_FILE_VERSION,
): unknown {
  const validated = validateProjectReadSnapshot(project);
  const withDefinitions = withProjectComponentDefinitions(validated);
  return encodeProjectFile(
    withDefinitions === validated && isFrozenSnapshot(validated)
      ? validated
      : validateProjectReadSnapshot(withDefinitions),
    version,
  );
}

function normalizedFile(
  project: CircuitProject,
  version = CURRENT_PROJECT_FILE_VERSION,
): unknown {
  return sortKeys(encodedFile(project, version));
}

function orderedProjectFile(project: CircuitProject): unknown {
  const file = normalizedFile(project);
  if (MAX_READABLE_PROJECT_FILE_VERSION > CURRENT_PROJECT_FILE_VERSION) {
    // During a staged release a newer feature may arrive through replication
    // or an updated editor. Never stamp it with a format that cannot retain it.
    const text = JSON.stringify(file);
    const reopened = tryParseProjectWithMetadata(text);
    if (
      !reopened.ok ||
      JSON.stringify(
        normalizedFile(reopened.project, MAX_READABLE_PROJECT_FILE_VERSION),
      ) !==
        JSON.stringify(
          normalizedFile(project, MAX_READABLE_PROJECT_FILE_VERSION),
        )
    )
      throw new ProjectWriterNotActiveError();
  }
  return file;
}

export function serializeProject(project: CircuitProject): string {
  if (MAX_READABLE_PROJECT_FILE_VERSION > CURRENT_PROJECT_FILE_VERSION) {
    return `${projectJson(orderedProjectFile(project), 0, "", false)}\n`;
  }
  return `${projectJson(encodedFile(project), 0, "", true)}\n`;
}

export function serializeCompactProject(project: CircuitProject): string {
  return `${JSON.stringify(orderedProjectFile(project))}\n`;
}

/** Reformat encoded Project JSON without changing its file schema. */
export function formatProjectFile(
  projectText: string,
  layout: "readable" | "compact" = "readable",
): string {
  let value: unknown;
  try {
    value = JSON.parse(projectText);
  } catch {
    return projectText;
  }
  return `${layout === "compact" ? JSON.stringify(value) : projectJson(value, 0, "", false)}\n`;
}

const INDENTS: string[] = Array.from({ length: 24 }, (_, i) => "  ".repeat(i));
function indentOf(depth: number): string {
  return depth < INDENTS.length ? INDENTS[depth]! : "  ".repeat(depth);
}

function isAllDigits(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function inlineJson(value: unknown, sortRecordKeys: boolean): string {
  if (Array.isArray(value)) {
    let out = "[";
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) out += ", ";
      out += inlineJson(value[i], sortRecordKeys);
    }
    return `${out}]`;
  }
  if (isRecord(value)) {
    const keys = sortRecordKeys ? sortedKeysOf(value).keys : Object.keys(value);
    let out = "{ ";
    let first = true;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]!;
      const item = value[key];
      if (item === undefined) continue;
      if (!first) out += ", ";
      first = false;
      out += `${JSON.stringify(key)}: ${inlineJson(item, sortRecordKeys)}`;
    }
    return `${out} }`;
  }
  return JSON.stringify(value) ?? "null";
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

function isScalarArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (!isScalar(value[i])) return false;
  }
  return true;
}

/** Keep authored objects as blocks; small coordinates and property values
 * read naturally on one line. This is ordinary editable JSON, not an encoded
 * payload or a positional table of device attributes. */
function projectJson(
  value: unknown,
  depth = 0,
  parentKey = "",
  sortRecordKeys = false,
): string {
  if (isScalar(value)) return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    const length = value.length;
    if (length === 0) return "[]";
    if (isScalarArray(value)) {
      const line = inlineJson(value, sortRecordKeys);
      if (depth * 2 + line.length <= 100) return line;
    }
    const childIndent = indentOf(depth + 1);
    const parts = new Array<string>(length);
    for (let i = 0; i < length; i += 1) {
      parts[i] =
        `${childIndent}${projectJson(value[i], depth + 1, String(i), sortRecordKeys)}`;
    }
    return `[\n${parts.join(",\n")}\n${indentOf(depth)}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = sortRecordKeys ? sortedKeysOf(record).keys : Object.keys(record);
  let definedCount = 0;
  let smallValue = true;
  for (let i = 0; i < keys.length; i += 1) {
    const item = record[keys[i]!];
    if (item === undefined) continue;
    definedCount += 1;
    if (smallValue && !isScalar(item) && !isScalarArray(item)) {
      smallValue = false;
    }
  }
  if (definedCount === 0) return "{}";
  // Every instance, label, definition, route and other collection entry stays
  // an object block, even when it happens to have very few attributes.
  const collectionObject = isAllDigits(parentKey);
  if (smallValue && !collectionObject) {
    const line = inlineJson(record, sortRecordKeys);
    const keyWidth = depth === 0 ? 0 : JSON.stringify(parentKey).length + 2;
    if (depth * 2 + keyWidth + line.length <= 100) return line;
  }
  const childIndent = indentOf(depth + 1);
  const parts: string[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    const item = record[key];
    if (item === undefined) continue;
    parts.push(
      `${childIndent}${JSON.stringify(key)}: ${projectJson(item, depth + 1, key, sortRecordKeys)}`,
    );
  }
  return `{\n${parts.join(",\n")}\n${indentOf(depth)}}`;
}
