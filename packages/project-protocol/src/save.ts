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

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    const order = Array.isArray(value.documents)
      ? PROJECT_KEY_ORDER
      : Array.isArray(value.instances) && Array.isArray(value.nets)
        ? DOCUMENT_KEY_ORDER
        : typeof value.type === "string" && "coordinate" in value
          ? INSTANCE_KEY_ORDER
          : undefined;
    const keys = Object.keys(value);
    if (order) {
      const fallback = order.size;
      keys.sort(
        (left, right) =>
          (order.get(left) ?? fallback) - (order.get(right) ?? fallback) ||
          (left < right ? -1 : left > right ? 1 : 0),
      );
    } else {
      keys.sort();
    }
    const sorted: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]!;
      sorted[key] = sortKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

function normalizedFile(
  project: CircuitProject,
  version = CURRENT_PROJECT_FILE_VERSION,
): unknown {
  const validated = validateProjectReadSnapshot(project);
  const withDefinitions = withProjectComponentDefinitions(validated);
  return sortKeys(
    encodeProjectFile(
      withDefinitions === validated && isFrozenSnapshot(validated)
        ? validated
        : validateProjectReadSnapshot(withDefinitions),
      version,
    ),
  );
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
  return `${projectJson(orderedProjectFile(project))}\n`;
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
  return `${layout === "compact" ? JSON.stringify(value) : projectJson(value)}\n`;
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
