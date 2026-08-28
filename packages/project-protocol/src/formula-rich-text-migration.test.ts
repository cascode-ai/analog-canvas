import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

import { parseProjectWithMetadata } from "./load.js";
import { serializeProject } from "./save.js";
import {
  upgradeSchema29To30,
  upgradeSchema29To30WithReport,
} from "./transforms/formula-rich-text.js";

describe("schema 29 to 30 migration (formula RichText)", () => {
  it("changes only the version stamp", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("formula", "Formula")),
    ) as Record<string, unknown>;
    const previous = { ...current, schemaVersion: 29 };

    expect(upgradeSchema29To30(previous)).toEqual({
      ...previous,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    });
    expect(upgradeSchema29To30WithReport(previous).report).toEqual({
      changed: false,
    });
  });

  it("loads a schema-29 project into the schema-30 runtime", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("formula", "Formula")),
    ) as Record<string, unknown>;
    const result = parseProjectWithMetadata(
      JSON.stringify({ ...current, schemaVersion: 29 }),
    );

    expect(result.sourceSchemaVersion).toBe(29);
    expect(result.migrated).toBe(true);
    expect(result.project.schemaVersion).toBe(30);
  });
});
