import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  CircuitProjectSchema,
} from "./schema.js";
import type { CircuitProject, SchematicDocument } from "./schema.js";

function defaultCellName(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_]+/gu, "_") || "Cell";
  return /^[A-Za-z_]/u.test(normalized) ? normalized : `_${normalized}`;
}

export function createEmptyDocument(
  id: string,
  name: string,
): SchematicDocument {
  return {
    id,
    name,
    revision: 0,
    sourceStatus: "in-sync",
    netlist: {
      name: defaultCellName(name),
      terminals: [],
      formalParameters: [],
    },
    instances: [],
    nets: [],
    connectivityEvidence: [],
    routes: [],
    junctions: [],
    annotations: [],
    presentation: {
      styleProfileId: "razavi-textbook-v1",
      grid: 10,
      compactness: "normal",
    },
    layoutGroups: [],
    constraints: [],
    noConnects: [],
    drafting: { objects: [] },
  };
}

export function createEmptyProject(
  id: string,
  name: string,
  documentId = "document-main",
): CircuitProject {
  return CircuitProjectSchema.parse({
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id,
    name,
    source: {
      entry: null,
      dialect: "none",
      sourcePolicy: "copy",
      files: [],
    },
    symbolLibrary: {
      id: "razavi-symbols",
      version: "1",
      hash: "razavi-reference-v1",
    },
    structureRevision: 0,
    topDocumentId: documentId,
    documents: [createEmptyDocument(documentId, "Main")],
    externalSubcircuitDefinitions: [],
  });
}
