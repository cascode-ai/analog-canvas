import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

import { tryParseProjectWithMetadata } from "./load.js";
import { serializeProject } from "./save.js";
import {
  upgradeSchema38To39,
  upgradeSchema38To39WithReport,
} from "./transforms/raw-simulation-setup.js";

describe("schema 38 to 39 migration (raw SimulationSetup)", () => {
  it("advances the version without inventing a setup", () => {
    const previous = {
      ...createEmptyProject("project", "Project"),
      schemaVersion: 38,
    } as unknown as Record<string, unknown>;

    expect(upgradeSchema38To39(previous)).toMatchObject({ schemaVersion: 39 });
    expect(upgradeSchema38To39WithReport(previous).report).toEqual({
      changed: false,
    });
    expect(upgradeSchema38To39(previous)).not.toHaveProperty("simulation");
  });

  it("loads a schema-38 structured setup unchanged", () => {
    const project = createEmptyProject("project", "Project", "tb");
    const previous = {
      ...project,
      schemaVersion: 38,
      simulation: {
        version: 1,
        input: {
          kind: "structured",
          rootDocumentId: "tb",
          analyses: [{ kind: "op" }],
          probes: [],
          environment: { profileId: "profile" },
        },
      },
    };
    const loaded = tryParseProjectWithMetadata(JSON.stringify(previous));
    expect(loaded).toMatchObject({
      ok: true,
      sourceSchemaVersion: 38,
      migrated: true,
      project: {
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        simulation: previous.simulation,
      },
    });
  });

  it("round-trips raw authored files byte-identically", () => {
    const project = createEmptyProject("raw", "Raw");
    project.simulation = {
      version: 1,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [
          {
            path: "dut.spi",
            text: ".subckt DUT in out\nR1 in out 1k\n.ends DUT\n",
          },
          { path: "tb.cir", text: ".include dut.spi\nX1 in out DUT\n.end\n" },
        ],
        dependencies: [
          {
            id: "models/sky130-core",
            mountPath: "models/sky130.lib.spice",
            sha256: "a".repeat(64),
          },
        ],
        environment: { profileId: "custom-ngspice46-v1" },
      },
    };

    const serialized = serializeProject(project);
    const loaded = tryParseProjectWithMetadata(serialized);
    expect(loaded).toMatchObject({ ok: true, migrated: false });
    if (!loaded.ok) return;
    expect(loaded.project.simulation).toEqual(project.simulation);
    expect(serializeProject(loaded.project)).toBe(serialized);
  });
});
