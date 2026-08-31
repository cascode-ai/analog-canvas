import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { tryParseProjectWithMetadata } from "./load.js";
import { upgradeSchema33To34WithReport } from "./previous-to-current.js";

function schema33Project() {
  const current = createEmptyProject("project", "Project");
  const project = structuredClone(current) as unknown as Record<
    string,
    unknown
  >;
  project.schemaVersion = 33;
  const document = (project.documents as Array<Record<string, unknown>>)[0]!;
  document.nets = [
    { id: "local", terminals: [] },
    { id: "global", terminals: [] },
    { id: "legacy", terminals: [] },
  ];
  document.connectivityEvidence = [
    {
      id: "local-name",
      kind: "name-claim",
      netId: "local",
      name: "OUT",
      owner: { kind: "explicit-net-property" },
      scope: "local",
    },
    {
      id: "local-source",
      kind: "spice-source",
      netId: "local",
      sourceNetId: "source-out",
    },
    {
      id: "global-name",
      kind: "name-claim",
      netId: "global",
      name: "VSS",
      owner: { kind: "explicit-net-property" },
      scope: "global",
    },
    {
      id: "global-source",
      kind: "spice-source",
      netId: "global",
      sourceNetId: "source-vss",
    },
    {
      id: "legacy-name",
      kind: "name-claim",
      netId: "legacy",
      name: "BIAS",
      owner: { kind: "explicit-net-property" },
      scope: "local",
    },
  ];
  return project;
}

describe("schema 33 to 34 migration (Net name provenance)", () => {
  it("separates imported and legacy hints from explicit global identity", () => {
    const migrated = upgradeSchema33To34WithReport(schema33Project());

    expect(migrated.report).toEqual({
      migratedImportedNameHints: 1,
      migratedLegacyNameHints: 1,
      materializedGlobalDeclarations: 1,
      materializedPowerOwners: 0,
      changed: true,
    });
    expect(migrated.project.schemaVersion).toBe(34);
    const document = (
      migrated.project.documents as Array<Record<string, unknown>>
    )[0]!;
    expect(document.connectivityEvidence).toEqual(
      expect.arrayContaining([
        {
          id: "local-name",
          kind: "net-name-hint",
          netId: "local",
          sourceName: "OUT",
          origin: "spice-import",
        },
        expect.objectContaining({
          id: "global-name",
          kind: "name-claim",
          owner: {
            kind: "global-declaration",
            sourceNetId: "source-vss",
          },
        }),
        {
          id: "legacy-name",
          kind: "net-name-hint",
          netId: "legacy",
          sourceName: "BIAS",
          origin: "legacy-explicit-net-property",
        },
      ]),
    );
  });

  it("loads schema 33 through the canonical schema 34 validator", () => {
    const result = tryParseProjectWithMetadata(
      JSON.stringify(schema33Project()),
    );
    expect(result).toMatchObject({
      ok: true,
      sourceSchemaVersion: 33,
      migrated: true,
      project: { schemaVersion: 34 },
    });
  });
});
