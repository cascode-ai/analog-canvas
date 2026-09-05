import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

import { tryParseProjectWithMetadata } from "./load.js";
import {
  upgradeSchema37To38,
  upgradeSchema37To38WithReport,
} from "./transforms/structured-tran.js";

describe("schema 37 to 38 migration (structured TRAN)", () => {
  it("advances the version without inventing an analysis", () => {
    const previous = {
      ...createEmptyProject("project", "Project"),
      schemaVersion: 37,
    } as unknown as Record<string, unknown>;

    expect(upgradeSchema37To38(previous)).toMatchObject({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    });
    expect(upgradeSchema37To38WithReport(previous).report).toEqual({
      changed: false,
    });
  });

  it("loads an existing schema-37 setup unchanged", () => {
    const project = createEmptyProject("project", "Project", "tb");
    const previous = {
      ...project,
      schemaVersion: 37,
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
      sourceSchemaVersion: 37,
      migrated: true,
      project: { schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION },
    });
  });
});
