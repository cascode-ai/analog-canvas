import { describe, expect, it } from "vitest";

import {
  createEmptyDocument,
  createEmptyProject,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "@icm/model";
import type { SimulationSetup } from "@icm/model";

import {
  parseProjectWithMetadata,
  tryParseProjectWithMetadata,
} from "./load.js";
import { serializeProject } from "./save.js";
import {
  upgradeSchema36To37,
  upgradeSchema36To37WithReport,
} from "./transforms/simulation-setup.js";

describe("schema 36 to 37 migration (persisted SimulationSetup)", () => {
  const schema36Project = (): Record<string, unknown> => {
    const project = createEmptyProject("divider", "Divider");
    const raw = JSON.parse(serializeProject(project)) as Record<
      string,
      unknown
    >;
    const document = (raw.documents as Record<string, unknown>[])[0]!;
    (document.instances as unknown[]).push({
      id: "V1",
      symbolId: "voltage-source",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      reference: "V1",
      netlist: { parameters: { dc: "1" } },
    });
    raw.schemaVersion = 36;
    return raw;
  };

  const setup = (): SimulationSetup => ({
    version: 1,
    input: {
      kind: "structured",
      rootDocumentId: "testbench",
      analyses: [
        { kind: "op" },
        { kind: "ac", sweep: "dec", points: 10, startHz: 1, stopHz: 1e6 },
      ],
      probes: [
        {
          id: "probe-out",
          kind: "net-voltage",
          documentId: "testbench",
          netId: "net-out",
          occurrence: [],
        },
      ],
      environment: { profileId: "sky130-core-continuous-ngspice46-v1" },
    },
  });

  it("changes only the version stamp", () => {
    const previous = schema36Project();

    expect(upgradeSchema36To37(previous)).toEqual({
      ...previous,
      schemaVersion: 37,
    });
    expect(upgradeSchema36To37WithReport(previous).report).toEqual({
      changed: false,
    });
  });

  it("loads schema 36 with no simulation setup invented", () => {
    const result = parseProjectWithMetadata(JSON.stringify(schema36Project()));

    expect(result.sourceSchemaVersion).toBe(36);
    expect(result.migrated).toBe(true);
    expect(result.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(result.project).not.toHaveProperty("simulation");
    expect(result.project.documents[0]!.instances[0]!.netlist).toEqual({
      parameters: { dc: "1" },
    });
    expect(serializeProject(result.project)).not.toContain('"simulation"');
  });

  it("round-trips an authored setup byte-stably beside the circuit", () => {
    const project = createEmptyProject("ota-bench", "OTA bench", "testbench");
    project.documents.push(createEmptyDocument("ota", "OTA"));
    project.simulation = setup();

    const serialized = serializeProject(project);
    const reloaded = parseProjectWithMetadata(serialized);

    expect(reloaded.migrated).toBe(false);
    expect(reloaded.project.simulation).toEqual(setup());
    expect(serializeProject(reloaded.project)).toBe(serialized);
  });

  it("rejects a setup whose root is not a Document of the Project", () => {
    const project = createEmptyProject("orphan", "Orphan");
    const candidate = {
      ...JSON.parse(serializeProject(project)),
      simulation: setup(),
    };

    const result = tryParseProjectWithMetadata(JSON.stringify(candidate));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual([
      {
        code: "INVALID_PROJECT",
        message: "Unknown simulation root document: testbench",
        path: ["simulation", "input", "rootDocumentId"],
      },
    ]);
  });
});
