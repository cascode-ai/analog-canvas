import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

import { parseProjectWithMetadata, upgradeSchema46To47 } from "./index.js";

describe("schema 46 to 47 MOS operating-point migration", () => {
  it("advances without selecting devices implicitly", () => {
    const previous = structuredClone(
      createEmptyProject("project", "Project"),
    ) as unknown as Record<string, unknown>;
    previous.schemaVersion = 46;
    previous.simulationSetups = [];

    const upgraded = upgradeSchema46To47(previous);

    expect(upgraded).toMatchObject({ schemaVersion: 47 });
    expect(upgraded.simulationSetups).toEqual([]);
  });

  it("loads schema 46 through the complete chain", () => {
    const previous = structuredClone(createEmptyProject("project", "Project"));
    previous.schemaVersion = 46 as typeof previous.schemaVersion;

    const result = parseProjectWithMetadata(
      JSON.stringify({ ...previous, simulationSetups: [] }),
    );

    expect(result.sourceSchemaVersion).toBe(46);
    expect(result.migrated).toBe(true);
    expect(result.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
  });
});
