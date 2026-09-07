import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

import { tryParseProjectWithMetadata } from "./load.js";
import {
  upgradeSchema44To45,
  upgradeSchema44To45WithReport,
} from "./transforms/simulation-measurements.js";

describe("schema 44 to 45 migration (simulation measurements)", () => {
  it("advances the version without inventing measurement intent", () => {
    const previous = {
      ...createEmptyProject("project", "Project"),
      schemaVersion: 44,
    } as unknown as Record<string, unknown>;

    expect(upgradeSchema44To45(previous)).toMatchObject({ schemaVersion: 45 });
    expect(upgradeSchema44To45WithReport(previous).report).toEqual({
      changed: false,
    });
  });

  it("loads a schema-44 structured setup without adding measurements", () => {
    const project = createEmptyProject("project", "Project", "tb");
    const previous = {
      ...project,
      schemaVersion: 44,
      simulationSetups: [
        {
          id: "setup-op",
          name: "OP",
          version: 2,
          input: {
            kind: "structured",
            rootDocumentId: "tb",
            analyses: [{ kind: "op" }],
            outputs: [],
            environment: { profileId: "profile" },
          },
        },
      ],
    };
    const loaded = tryParseProjectWithMetadata(JSON.stringify(previous));
    expect(loaded).toMatchObject({
      ok: true,
      sourceSchemaVersion: 44,
      migrated: true,
      project: { schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION },
    });
    if (!loaded.ok) throw new Error("Expected migration to succeed");
    expect(loaded.project.simulationSetups[0]?.input).not.toHaveProperty(
      "measurements",
    );
  });
});
