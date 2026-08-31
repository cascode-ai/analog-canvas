import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

import {
  parseProject,
  serializeProject,
  tryParseProjectWithMetadata,
} from "./index.js";

describe("Project protocol boundary", () => {
  it("returns diagnostics instead of throwing for invalid JSON", () => {
    expect(tryParseProjectWithMetadata("{")).toMatchObject({
      ok: false,
      diagnostics: [{ code: "INVALID_JSON" }],
    });
  });

  it("upgrades the previous schema to the current schema", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("protocol-project", "Protocol")),
    ) as Record<string, unknown>;
    const result = tryParseProjectWithMetadata(
      JSON.stringify({
        ...current,
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION - 1,
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      sourceSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION - 1,
      migrated: true,
      project: {
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        structureRevision: 0,
      },
    });
  });

  it("rejects projects older than the supported chain window", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("protocol-project", "Protocol")),
    ) as Record<string, unknown>;
    expect(
      tryParseProjectWithMetadata(
        JSON.stringify({ ...current, schemaVersion: 23 }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: "UNSUPPORTED_SCHEMA_VERSION" }],
    });
  });

  it("serializes only the current schema", () => {
    const project = createEmptyProject("protocol-project", "Protocol");
    expect(parseProject(serializeProject(project))).toEqual(project);
  });
});
