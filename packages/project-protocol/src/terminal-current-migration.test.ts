import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { parseProjectWithMetadata } from "./load.js";
import { upgradeSchema43To44WithReport } from "./previous-to-current.js";

describe("schema 43 to 44 terminal-current migration", () => {
  it("adds the source-positive terminal to every current expression", () => {
    const project = createEmptyProject("project", "Project");
    const raw = {
      ...project,
      schemaVersion: 43,
      simulationSetups: [
        {
          id: "setup",
          name: "Setup",
          version: 2,
          input: {
            kind: "structured",
            rootDocumentId: project.topDocumentId,
            analyses: [{ kind: "op" }],
            outputs: [
              {
                id: "direct",
                label: "Direct",
                expression: {
                  kind: "current",
                  documentId: project.topDocumentId,
                  instanceId: "V1",
                  occurrence: [],
                },
              },
              {
                id: "derived",
                label: "Derived",
                expression: {
                  kind: "negate",
                  operand: {
                    kind: "current",
                    documentId: project.topDocumentId,
                    instanceId: "I1",
                    occurrence: [],
                  },
                },
              },
            ],
            environment: { profileId: "profile" },
          },
        },
      ],
    };

    const migrated = upgradeSchema43To44WithReport(raw);

    expect(migrated.project.schemaVersion).toBe(44);
    expect(migrated.report).toEqual({
      changed: true,
      migratedOutputIds: ["direct", "derived"],
    });
    const outputs = (
      migrated.project.simulationSetups as Array<{
        input: { outputs: Array<{ expression: unknown }> };
      }>
    )[0]!.input.outputs;
    expect(outputs).toMatchObject([
      { expression: { kind: "current", pinName: "+" } },
      {
        expression: {
          kind: "negate",
          operand: { kind: "current", pinName: "+" },
        },
      },
    ]);
  });

  it("loads a schema-43 setup through the public compatibility boundary", () => {
    const project = createEmptyProject("project", "Project");
    const raw = structuredClone(project) as unknown as Record<string, unknown>;
    raw.schemaVersion = 43;
    raw.simulationSetups = [];

    const result = parseProjectWithMetadata(JSON.stringify(raw));

    expect(result.sourceSchemaVersion).toBe(43);
    expect(result.migrated).toBe(true);
    expect(result.project.schemaVersion).toBe(44);
  });
});
