import { describe, expect, it } from "vitest";
import { CURRENT_PROJECT_SCHEMA_VERSION, createEmptyProject } from "@icm/model";

import { parseProjectWithMetadata } from "./load.js";
import {
  upgradeSchema40To41,
  upgradeSchema40To41WithReport,
} from "./previous-to-current.js";

describe("schema 40 to 41", () => {
  it("changes only the version because existing simulation setups remain valid", () => {
    const current = createEmptyProject("project", "Project", "main");
    const previous = { ...current, schemaVersion: 40 };
    expect(upgradeSchema40To41(previous)).toEqual({
      ...previous,
      schemaVersion: 41,
    });
  });

  it("loads an existing schema-40 Project through the explicit chain", () => {
    const current = createEmptyProject("project", "Project", "main");
    const result = parseProjectWithMetadata(
      JSON.stringify({ ...current, schemaVersion: 40 }),
    );
    expect(result.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(result.sourceSchemaVersion).toBe(40);
    expect(result.migrated).toBe(true);
  });

  it("reports that the version-only migration rewrites no authored data", () => {
    expect(upgradeSchema40To41WithReport({ schemaVersion: 40 }).report).toEqual(
      { changed: false },
    );
  });
});
