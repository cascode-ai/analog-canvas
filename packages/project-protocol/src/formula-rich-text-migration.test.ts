import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

import {
  upgradeSchema29To30,
  upgradeSchema29To30WithReport,
} from "./transforms/formula-rich-text.js";

describe("schema 29 to 30 migration (formula RichText)", () => {
  it("changes only the version stamp", () => {
    const current = JSON.parse(
      JSON.stringify(createEmptyProject("formula", "Formula")),
    ) as Record<string, unknown>;
    const previous = { ...current, schemaVersion: 29 };

    expect(upgradeSchema29To30(previous)).toEqual({
      ...previous,
      schemaVersion: 30,
    });
    expect(upgradeSchema29To30WithReport(previous).report).toEqual({
      changed: false,
    });
  });
});
