/** Schema 61: named parameter labels may hide their live value presentation. */
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
export const CURRENT_PROJECT_FILE_VERSION = 61;
type Value = Record<string, any>;

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
