import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

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

  it("upgrades the previous schema to schema 28", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("protocol-project", "Protocol")),
    ) as Record<string, unknown>;
    const result = tryParseProjectWithMetadata(
      JSON.stringify({
        ...current,
        schemaVersion: 27,
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      sourceSchemaVersion: 27,
      migrated: true,
      project: { schemaVersion: 28, structureRevision: 0 },
    });
  });

  it("rejects projects older than the rolling compatibility window", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("protocol-project", "Protocol")),
    ) as Record<string, unknown>;
    expect(
      tryParseProjectWithMetadata(
        JSON.stringify({ ...current, schemaVersion: 24 }),
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
