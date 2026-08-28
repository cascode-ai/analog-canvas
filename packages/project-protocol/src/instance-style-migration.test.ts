import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";
import { serializeProject } from "./save.js";

import { parseProject, tryParseProjectWithMetadata } from "./index.js";
import {
  upgradeSchema28To29,
  upgradeSchema28To29WithReport,
} from "./transforms/annotation-grid.js";

describe("schema 28 to 29 migration (instance style override)", () => {
  it("upgrades schemaVersion from 28 to 29 without changing data", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("test", "Test")),
    ) as Record<string, unknown>;
    const v28 = { ...current, schemaVersion: 28 };
    const upgraded = upgradeSchema28To29(v28);
    expect(upgraded.schemaVersion).toBe(29);
  });

  it("migration report says changed: false", () => {
    const { report } = upgradeSchema28To29WithReport({
      schemaVersion: 28,
      extra: "preserved",
    });
    expect(report.changed).toBe(false);
  });

  it("does not keep schema 28 in the rolling read window", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("test", "Test")),
    ) as Record<string, unknown>;
    const v28 = JSON.stringify({ ...current, schemaVersion: 28 });
    const result = tryParseProjectWithMetadata(v28);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "UNSUPPORTED_SCHEMA_VERSION" }],
    });
  });

  it("round-trips instance color overrides through canonical project JSON", () => {
    const project = createEmptyProject("test", "Test");
    project.documents[0]!.instances.push({
      id: "inst-1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      styleOverride: {
        foreground: "#DC2626",
        background: "#2563EB",
      },
    });

    const serialized = serializeProject(project);
    const parsed = parseProject(serialized);
    expect(parsed.documents[0]!.instances[0]!.styleOverride).toEqual({
      foreground: "#DC2626",
      background: "#2563EB",
    });
    expect(serializeProject(parsed)).toBe(serialized);
  });

  it("keeps the historical transform independently usable", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("test", "Test")),
    ) as Record<string, unknown>;
    const doc = (current.documents as Array<Record<string, unknown>>)[0]!;
    doc.instances = [
      {
        id: "inst-1",
        symbolId: "resistor",
        placement: {
          position: { x: 0, y: 0 },
          rotation: 0,
          mirror: "none",
        },
        netlist: { reference: "R1", parameters: {} },
      },
    ];
    const v28 = { ...current, schemaVersion: 28 };
    expect(upgradeSchema28To29(v28).schemaVersion).toBe(29);
  });
});
