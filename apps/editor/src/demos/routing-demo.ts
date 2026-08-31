import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  CircuitProjectSchema,
} from "@icm/model";
import type { CircuitProject, Instance } from "@icm/model";

function instance(
  id: string,
  x: number,
  y: number,
  rotation: 0 | 90 | 180 | 270,
  mirror: "none" | "x" = "none",
): Instance {
  return {
    id,
    symbolId: "port",
    placement: { position: { x, y }, rotation, mirror },
  };
}

export function createRoutingDemoProject(): CircuitProject {
  return CircuitProjectSchema.parse({
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: "project-routing",
    name: "Phase 3 Routing Demo",
    source: { entry: null, dialect: "none", sourcePolicy: "copy", files: [] },
    symbolLibrary: {
      id: "razavi-symbols",
      version: "1",
      hash: "razavi-reference-v1",
    },
    structureRevision: 0,
    topDocumentId: "document-routing",
    documents: [
      {
        id: "document-routing",
        name: "Phase 3 Routing",
        revision: 0,
        sourceStatus: "in-sync",
        netlist: {
          name: "Phase_3_Routing",
          terminals: [
            ["A", "HORIZONTAL", "net-h"],
            ["B", "HORIZONTAL", "net-h"],
            ["C", "VERTICAL", "net-v"],
            ["D", "VERTICAL", "net-v"],
            ["E", "HORIZONTAL", "net-h"],
          ].map(([instanceId, name, netId]) => ({
            id: `cell-terminal-${instanceId!.toLowerCase()}`,
            name: name!,
            netId: netId!,
            direction: "passive" as const,
            interfaceInstanceIds: [instanceId!],
          })),
        },
        instances: [
          instance("A", 140, 300, 0),
          instance("B", 460, 300, 0, "x"),
          instance("C", 300, 140, 90),
          instance("D", 300, 460, 270),
          instance("E", 340, 440, 90),
        ],
        nets: [
          {
            id: "net-h",
            terminals: ["A", "B", "E"].map((instanceId) => ({
              instanceId,
              pinName: "P",
            })),
          },
          {
            id: "net-v",
            terminals: ["C", "D"].map((instanceId) => ({
              instanceId,
              pinName: "P",
            })),
          },
        ],
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
}
