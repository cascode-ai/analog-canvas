import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";
import { serializeProject } from "./save.js";

import { parseProject, tryParseProjectWithMetadata } from "./index.js";
import {
  upgradeSchema28To29,
  upgradeSchema28To29WithReport,
} from "./transforms/annotation-grid.js";
import {
  upgradeSchema29To30,
  upgradeSchema29To30WithReport,
} from "./transforms/formula-rich-text.js";
import {
  upgradeSchema30To31,
  upgradeSchema30To31WithReport,
} from "./transforms/signal-flow-parameters.js";
import {
  upgradeSchema31To32,
  upgradeSchema31To32WithReport,
} from "./transforms/annotation-text-color.js";
import {
  upgradeSchema32To33,
  upgradeSchema32To33WithReport,
} from "./transforms/explicit-equivalence.js";
import {
  upgradeSchema33To34,
  upgradeSchema33To34WithReport,
} from "./transforms/net-name-provenance.js";
import { upgradeSchema34To35 } from "./transforms/instance-reference.js";
import { upgradeSchema35To36 } from "./transforms/instance-reference-annotation.js";
import { upgradeSchema36To37 } from "./transforms/annotation-reference-prefix.js";

describe("schema migrations through hidden Net-name retirement", () => {
  it("keeps each retained historical transform independently usable", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("test", "Test")),
    ) as Record<string, unknown>;
    const v29 = upgradeSchema28To29({ ...current, schemaVersion: 28 });
    const v30 = upgradeSchema29To30(v29);
    const v31 = upgradeSchema30To31(v30);
    const v32 = upgradeSchema31To32(v31);
    const v33 = upgradeSchema32To33(v32);
    const v34 = upgradeSchema33To34(v33);
    const v35 = upgradeSchema34To35(v34);
    const v36 = upgradeSchema35To36(v35);
    const v37 = upgradeSchema36To37(v36);

    expect(v29.schemaVersion).toBe(29);
    expect(v30.schemaVersion).toBe(30);
    expect(v31.schemaVersion).toBe(31);
    expect(v32.schemaVersion).toBe(32);
    expect(v33.schemaVersion).toBe(33);
    expect(v34.schemaVersion).toBe(34);
    expect(v35.schemaVersion).toBe(35);
    expect(v36.schemaVersion).toBe(36);
    expect(v37.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
  });

  it("reports non-rewriting 28→29 through 32→33 upgrades as unchanged", () => {
    expect(
      upgradeSchema28To29WithReport({ schemaVersion: 28 }).report.changed,
    ).toBe(false);
    expect(
      upgradeSchema29To30WithReport({ schemaVersion: 29 }).report.changed,
    ).toBe(false);
    expect(
      upgradeSchema30To31WithReport({ schemaVersion: 30 }).report.changed,
    ).toBe(false);
    expect(
      upgradeSchema31To32WithReport({ schemaVersion: 31 }).report.changed,
    ).toBe(false);
    expect(
      upgradeSchema32To33WithReport({ schemaVersion: 32 }).report.changed,
    ).toBe(false);
    expect(
      upgradeSchema33To34WithReport({ schemaVersion: 33 }).report.changed,
    ).toBe(false);
  });

  it("migrates schema 31 through the current schema at the project boundary", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("test", "Test")),
    ) as Record<string, unknown>;
    const v31 = JSON.stringify({ ...current, schemaVersion: 31 });
    const result = tryParseProjectWithMetadata(v31);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceSchemaVersion).toBe(31);
    expect(result.migrated).toBe(true);
    expect(result.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
  });

  it("keeps schema 30 loadable through the upgrade chain", () => {
    const current = JSON.parse(
      serializeProject(createEmptyProject("test", "Test")),
    ) as Record<string, unknown>;
    const v30 = JSON.stringify({ ...current, schemaVersion: 30 });
    expect(tryParseProjectWithMetadata(v30)).toMatchObject({
      ok: true,
      sourceSchemaVersion: 30,
      migrated: true,
    });
  });

  it("round-trips style, Signal Flow, and Annotation presentation independently from netlist data", () => {
    const project = createEmptyProject("test", "Test");
    project.documents[0]!.instances.push({
      id: "inst-1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      reference: "R1",
      netlist: { parameters: { value: "10k" } },
      styleOverride: {
        foreground: "#DC2626",
        background: "#2563EB",
      },
      signalFlowParameters: {
        formula: "1 - z^-1",
        coefficient: "c0",
        bodyWidth: 100,
        bodyHeight: 50,
      },
    });
    project.documents[0]!.annotations.push({
      id: "label-inst-1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "inst-1" },
      anchor: {
        kind: "object",
        objectId: "inst-1",
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 0, y: -20 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
      textColor: "#224488",
    });

    const serialized = serializeProject(project);
    const parsed = parseProject(serialized);
    expect(parsed.documents[0]!.instances[0]).toMatchObject({
      reference: "R1",
      netlist: { parameters: { value: "10k" } },
      styleOverride: {
        foreground: "#DC2626",
        background: "#2563EB",
      },
      signalFlowParameters: {
        formula: "1 - z^-1",
        coefficient: "c0",
        bodyWidth: 100,
        bodyHeight: 50,
      },
    });
    expect(parsed.documents[0]!.annotations[0]).toMatchObject({
      textColor: "#224488",
    });
    expect(serializeProject(parsed)).toBe(serialized);
  });
});
