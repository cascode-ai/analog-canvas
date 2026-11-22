import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";
import { serializeProject } from "./save.js";

import { parseProject } from "./index.js";
import { upgradeSchema28To29WithReport } from "./transforms/annotation-grid.js";
import { upgradeSchema30To31WithReport } from "./transforms/signal-flow-parameters.js";
import { upgradeSchema33To34WithReport } from "./transforms/net-name-provenance.js";

describe("schema migrations through hidden Net-name retirement", () => {
  it("reports the non-rewriting 28→29, 30→31 and 33→34 upgrades as unchanged", () => {
    expect(
      upgradeSchema28To29WithReport({ schemaVersion: 28 }).report.changed,
    ).toBe(false);
    expect(
      upgradeSchema30To31WithReport({ schemaVersion: 30 }).report.changed,
    ).toBe(false);
    expect(
      upgradeSchema33To34WithReport({ schemaVersion: 33 }).report.changed,
    ).toBe(false);
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
