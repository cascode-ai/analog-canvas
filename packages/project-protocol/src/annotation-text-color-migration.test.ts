import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

import { parseProjectWithMetadata } from "./load.js";
import { serializeProject } from "./save.js";
import {
  upgradeSchema31To32,
  upgradeSchema31To32WithReport,
} from "./transforms/annotation-text-color.js";

describe("schema 31 to 32 migration (Annotation text color)", () => {
  const schema31Project = (): Record<string, unknown> => {
    const project = createEmptyProject("text-color", "Text color");
    const raw = JSON.parse(serializeProject(project)) as Record<
      string,
      unknown
    >;
    const document = (raw.documents as Record<string, unknown>[])[0]!;
    (document.instances as unknown[]).push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      schematicReference: "R1",
      styleOverride: { foreground: "#DC2626", background: "#FFFFFF" },
      signalFlowParameters: { formula: "z^-1", bodyWidth: 80 },
    });
    (document.annotations as unknown[]).push(
      {
        id: "label-R1",
        kind: "instance-label",
        binding: { kind: "instance-designator", instanceId: "R1" },
        anchor: {
          kind: "object",
          objectId: "R1",
          localOffset: { x: 0, y: -20 },
          fallbackPosition: { x: 100, y: 80 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
      {
        id: "value-R1",
        kind: "instance-value",
        content: {
          runs: [
            {
              kind: "fraction",
              numerator: { runs: [{ kind: "text", value: "W" }] },
              denominator: { runs: [{ kind: "text", value: "L" }] },
            },
          ],
        },
        anchor: {
          kind: "object",
          objectId: "R1",
          localOffset: { x: 0, y: 30 },
          fallbackPosition: { x: 100, y: 130 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
    );
    raw.schemaVersion = 31;
    return raw;
  };

  it("changes only the version stamp", () => {
    const previous = schema31Project();

    expect(upgradeSchema31To32(previous)).toEqual({
      ...previous,
      schemaVersion: 32,
    });
    expect(upgradeSchema31To32WithReport(previous).report).toEqual({
      changed: false,
    });
  });

  it("loads schema 31 without materializing an annotation color", () => {
    const result = parseProjectWithMetadata(JSON.stringify(schema31Project()));

    expect(result.sourceSchemaVersion).toBe(31);
    expect(result.migrated).toBe(true);
    expect(result.project.schemaVersion).toBe(35);
    expect(result.project.documents[0]!.instances[0]).toMatchObject({
      styleOverride: {
        foreground: "#DC2626",
        background: "#FFFFFF",
      },
      signalFlowParameters: { formula: "z^-1", bodyWidth: 80 },
    });
    expect(result.project.documents[0]!.annotations).toHaveLength(2);
    expect(
      result.project.documents[0]!.annotations.every(
        (annotation) => annotation.textColor === undefined,
      ),
    ).toBe(true);
    expect(serializeProject(result.project)).not.toContain("labelColor");
    expect(serializeProject(result.project)).not.toContain("textColor");
  });
});
