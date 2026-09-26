/** Schema 64: an object may keep the Document style of a copy's source. */
import { createProjectSymbolResolver } from "@icm/symbols";
import type { CircuitProject } from "@icm/model";
import { ProjectFormatError } from "./diagnostics.js";
import {
  encodeProjectFile as encodeOwned,
  decodeProjectFile as decodeOwned,
} from "./owned-project-v59.js";
import {
  compactProjectFile,
  expandProjectFile,
} from "./compact-project-file.js";
import {
  captureSourceConnectivity,
  materializeSourceConnectivity,
  type SourceConnectivity,
} from "./source-connectivity.js";
export const CURRENT_PROJECT_FILE_VERSION = 64;
type Value = Record<string, any>;

/** An object's kept Document style first appears in schema 64. */
export function rejectKeptDocumentStyle(raw: Value): void {
  if (!Array.isArray(raw.documents)) return;
  const scan = (items: unknown, path: (string | number)[]) => {
    if (!Array.isArray(items)) return;
    items.forEach((item, index) => {
      if (
        item &&
        typeof item === "object" &&
        Object.hasOwn(item, "documentStyle")
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            path: [...path, index, "documentStyle"],
            message: "A kept Document style requires Project schema 64",
          },
        ]);
    });
  };
  raw.documents.forEach((document: Value | null, index: number) => {
    if (!document || typeof document !== "object") return;
    const path = ["documents", index];
    for (const key of [
      "instances",
      "annotations",
      "routes",
      "junctions",
      "noConnects",
    ])
      scan(document[key], [...path, key]);
    if (Array.isArray(document.instances))
      document.instances.forEach((instance: Value | null, instanceIndex) =>
        scan(instance?.labels, [...path, "instances", instanceIndex, "labels"]),
      );
    scan(document.drafting?.objects, [...path, "drafting", "objects"]);
  });
}

export function encodeProjectFile(project: CircuitProject): Value {
  const owned = encodeOwned(project) as Value;
  const connections = captureSourceConnectivity(project);
  for (const [index, document] of owned.documents.entries()) {
    document.nets = connections[index]!.nets;
    document.connections = connections[index]!.connections;
    for (const route of document.routes) delete route.netId;
    for (const junction of document.junctions) delete junction.netId;
  }
  owned.schemaVersion = CURRENT_PROJECT_FILE_VERSION;
  return compactProjectFile(owned);
}

export function decodeProjectFile(raw: Value): Value {
  if (raw.schemaVersion === 59) return decodeOwned(raw);
  try {
    const owned = expandProjectFile(raw);
    const sources: SourceConnectivity[] = [];
    for (const document of owned.documents) {
      sources.push({ nets: document.nets, connections: document.connections });
      delete document.connections;
      document.nets = document.nets.map((net: Value) => ({
        id: net.id,
        terminals: [],
      }));
      for (const route of document.routes) {
        if (Object.hasOwn(route, "netId"))
          throw new Error("Route netId is derived; edit its endpoints instead");
        route.netId = "pending-network";
      }
      for (const junction of document.junctions) {
        if (Object.hasOwn(junction, "netId"))
          throw new Error(
            "Junction netId is derived; edit its connections instead",
          );
        junction.netId = "pending-network";
      }
    }
    const decoded = decodeOwned(owned, {
      allowParameterShowValue: raw.schemaVersion >= 61,
      allowFormulaFormat: raw.schemaVersion >= 62,
    }) as unknown as CircuitProject;
    const resolver = createProjectSymbolResolver(decoded, []);
    decoded.documents.forEach((document, index) =>
      materializeSourceConnectivity(document, sources[index]!, resolver),
    );
    return decoded as unknown as Value;
  } catch (error) {
    if (error instanceof ProjectFormatError) throw error;
    throw new ProjectFormatError([
      {
        code: "INVALID_PROJECT",
        path: [],
        message: error instanceof Error ? error.message : String(error),
      },
    ]);
  }
}
