import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  CircuitProjectSchema,
} from "@icm/model";
import type { CircuitProject } from "@icm/model";

const demoProject = CircuitProjectSchema.parse({
  schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
  id: "project-phase-1-manual",
  name: "Phase 1 Manual Editor",
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
  topDocumentId: "document-main",
  documents: [
    {
      id: "document-main",
      name: "Manual Editor Demo",
      revision: 0,
      sourceStatus: "in-sync",
      netlist: { name: "Manual_Editor_Demo", terminals: [] },
      instances: [
        {
          id: "M1",
          symbolId: "nmos",
          symbolVariantId: "textbook-3terminal",
          schematicReference: "M1",
          placement: null,
        },
        {
          id: "M2",
          symbolId: "pmos",
          symbolVariantId: "textbook-3terminal",
          schematicReference: "M2",
          placement: null,
        },
        {
          id: "R1",
          symbolId: "resistor",
          schematicReference: "R1",
          placement: null,
          netlist: {
            reference: "R1",
            parameters: { value: "10k" },
          },
        },
      ],
      nets: [],
      connectivityEvidence: [],
      routes: [],
      junctions: [],
      annotations: [],
      noConnects: [],
      drafting: { objects: [] },
      presentation: {
        styleProfileId: "razavi-textbook-v1",
        grid: 10,
        compactness: "normal",
      },
      layoutGroups: [],
      constraints: [],
    },
  ],
});

export function createDemoProject(): CircuitProject {
  return structuredClone(demoProject);
}
