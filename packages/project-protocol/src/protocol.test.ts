import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

import { tryParseProjectWithMetadata } from "./index.js";

describe("Project protocol boundary", () => {
  it("returns diagnostics instead of throwing for invalid JSON", () => {
    expect(tryParseProjectWithMetadata("{")).toMatchObject({
      ok: false,
      diagnostics: [{ code: "INVALID_JSON" }],
    });
  });

  it("rejects projects older than the supported chain window", () => {
    const current = JSON.parse(
      JSON.stringify(createEmptyProject("protocol-project", "Protocol")),
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
});
