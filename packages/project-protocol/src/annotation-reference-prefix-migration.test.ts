import { describe, expect, it } from "vitest";

import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

import { parseProjectWithMetadata } from "./load.js";
import { serializeProject } from "./save.js";
import {
  upgradeSchema36To37,
  upgradeSchema36To37WithReport,
} from "./transforms/annotation-reference-prefix.js";

describe("schema 36 to 37 migration (Reference prefix display)", () => {
  const schema36Project = (): Record<string, unknown> => {
    const project = createEmptyProject("prefix", "Prefix");
    const raw = JSON.parse(serializeProject(project)) as Record<
      string,
      unknown
    >;
    const document = (raw.documents as Record<string, unknown>[])[0]!;
    (document.instances as unknown[]).push({
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      reference: "RG1",
      netlist: { parameters: { value: "1k" } },
    });
    (document.annotations as unknown[]).push({
      id: "label-R1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 100, y: 80 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    raw.schemaVersion = 36;
    return raw;
  };

  it("changes only the version stamp", () => {
    const previous = schema36Project();

    expect(upgradeSchema36To37(previous)).toEqual({
      ...previous,
      schemaVersion: 37,
    });
    expect(upgradeSchema36To37WithReport(previous).report).toEqual({
      changed: false,
    });
  });

  it("loads schema 36 with every Reference still drawn whole", () => {
    const result = parseProjectWithMetadata(JSON.stringify(schema36Project()));

    expect(result.sourceSchemaVersion).toBe(36);
    expect(result.migrated).toBe(true);
    expect(result.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(result.project.documents[0]!.instances[0]!.reference).toBe("RG1");
    expect(
      result.project.documents[0]!.annotations.every(
        (annotation) => annotation.referencePrefixHidden === undefined,
      ),
    ).toBe(true);
    expect(serializeProject(result.project)).not.toContain(
      "referencePrefixHidden",
    );
  });

  it("round-trips a hidden prefix without touching the Reference", () => {
    const project = createEmptyProject("prefix-round-trip", "Prefix");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "RG1",
      netlist: { parameters: { value: "1k" } },
    });
    document.annotations.push({
      id: "label-R1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
      anchor: { kind: "free", position: { x: 100, y: 80 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
      referencePrefixHidden: true,
    });

    const reloaded = parseProjectWithMetadata(serializeProject(project));

    expect(reloaded.migrated).toBe(false);
    expect(
      reloaded.project.documents[0]!.annotations[0]!.referencePrefixHidden,
    ).toBe(true);
    expect(reloaded.project.documents[0]!.instances[0]!.reference).toBe("RG1");
  });
});
