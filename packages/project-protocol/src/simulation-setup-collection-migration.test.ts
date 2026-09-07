import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { tryParseProjectWithMetadata } from "./load.js";
import {
  upgradeSchema41To42,
  upgradeSchema41To42WithReport,
} from "./transforms/simulation-setup-collection.js";

const setup = {
  version: 1,
  input: {
    kind: "structured",
    rootDocumentId: "document-main",
    analyses: [{ kind: "op" }],
    probes: [],
    environment: { profileId: "test" },
  },
};

describe("schema 41 to 42 named simulation setup migration", () => {
  it("names the legacy singleton deterministically", () => {
    const previous = {
      ...createEmptyProject("p", "P"),
      schemaVersion: 41,
      simulation: setup,
    } as unknown as Record<string, unknown>;
    delete previous.simulationSetups;

    expect(upgradeSchema41To42(previous)).toMatchObject({
      schemaVersion: 42,
      simulationSetups: [
        { id: "simulation-setup-1", name: "Setup 1", ...setup },
      ],
    });
    expect(upgradeSchema41To42WithReport(previous).report).toEqual({
      changed: true,
      migratedSetupCount: 1,
    });
    expect(upgradeSchema41To42(previous)).not.toHaveProperty("simulation");
  });

  it("loads a legacy Project without inventing authored intent", () => {
    const previous = {
      ...createEmptyProject("p", "P"),
      schemaVersion: 41,
    } as unknown as Record<string, unknown>;
    delete previous.simulationSetups;
    const loaded = tryParseProjectWithMetadata(JSON.stringify(previous));
    expect(loaded).toMatchObject({
      ok: true,
      sourceSchemaVersion: 41,
      migrated: true,
      project: { schemaVersion: 46, simulationSetups: [] },
    });
  });
});
