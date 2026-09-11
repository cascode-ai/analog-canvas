import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

import { parseProjectWithMetadata, upgradeSchema45To46 } from "./index.js";

describe("schema 45 to 46 simulation Noise migration", () => {
  it("advances without inventing Noise intent", () => {
    const previous = structuredClone(
      createEmptyProject("project", "Project"),
    ) as unknown as Record<string, unknown>;
    previous.schemaVersion = 45;
    previous.simulationSetups = [];
    const upgraded = upgradeSchema45To46(previous);

    expect(upgraded).toMatchObject({ schemaVersion: 46 });
    expect(upgraded.simulationSetups).toEqual([]);
  });

  it("loads schema 45 through the complete chain", () => {
    const previous = structuredClone(createEmptyProject("project", "Project"));
    previous.schemaVersion = 45 as typeof previous.schemaVersion;
    const result = parseProjectWithMetadata(
      JSON.stringify({ ...previous, simulationSetups: [] }),
    );

    expect(result.sourceSchemaVersion).toBe(45);
    expect(result.migrated).toBe(true);
    expect(result.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
  });
});
