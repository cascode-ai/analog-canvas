import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

import { parseProjectWithMetadata } from "./load.js";
import {
  upgradeSchema39To40,
  upgradeSchema39To40WithReport,
} from "./transforms/simulation-probe-anchor.js";

function schema39Project(): Record<string, unknown> {
  const project = createEmptyProject("project", "Project", "tb");
  const document = project.documents[0]!;
  document.nets.push(
    { id: "measured", terminals: [] },
    { id: "already-lost", terminals: [] },
  );
  document.junctions.push({
    id: "probe-junction",
    netId: "measured",
    position: { x: 10, y: 20 },
  });
  const raw = structuredClone(project) as unknown as Record<string, unknown>;
  raw.schemaVersion = 39;
  raw.simulation = {
    version: 1,
    input: {
      kind: "structured",
      rootDocumentId: "tb",
      analyses: [{ kind: "op" }],
      probes: [
        {
          id: "measured-probe",
          kind: "net-voltage",
          documentId: "tb",
          netId: "measured",
          occurrence: [],
        },
        {
          id: "lost-probe",
          kind: "net-voltage",
          documentId: "tb",
          netId: "already-lost",
          occurrence: [],
        },
      ],
      environment: { profileId: "test" },
    },
  };
  return raw;
}

describe("schema 39 to 40 simulation probe anchors", () => {
  it("resolves saved Net probes to attached objects and preserves an unresolved Base Net anchor", () => {
    const previous = schema39Project();
    expect(upgradeSchema39To40WithReport(previous)).toMatchObject({
      report: {
        changed: true,
        migratedProbeIds: ["measured-probe"],
        baseNetProbeIds: ["lost-probe"],
      },
      project: {
        schemaVersion: 40,
        simulation: {
          input: {
            probes: [
              {
                id: "measured-probe",
                anchor: { kind: "junction", junctionId: "probe-junction" },
              },
              {
                id: "lost-probe",
                anchor: { kind: "base-net", netId: "already-lost" },
              },
            ],
          },
        },
      },
    });
    expect(previous).toHaveProperty(
      "simulation.input.probes.0.netId",
      "measured",
    );
  });

  it("loads the migrated setup through the public Project boundary", () => {
    const parsed = parseProjectWithMetadata(JSON.stringify(schema39Project()));
    expect(parsed).toMatchObject({
      sourceSchemaVersion: 39,
      migrated: true,
      project: {
        schemaVersion: 40,
        simulation: {
          input: {
            probes: [
              {
                anchor: { kind: "junction", junctionId: "probe-junction" },
              },
              {
                anchor: { kind: "base-net", netId: "already-lost" },
              },
            ],
          },
        },
      },
    });
  });

  it("leaves a raw setup unchanged apart from its version", () => {
    const previous = schema39Project();
    previous.simulation = {
      version: 1,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: "raw\n.end" }],
        dependencies: [],
        environment: { profileId: "test" },
      },
    };
    expect(upgradeSchema39To40(previous)).toEqual({
      ...previous,
      schemaVersion: 40,
    });
  });
});
