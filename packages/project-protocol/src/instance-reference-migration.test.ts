import {
  createEmptyProject,
  CURRENT_PROJECT_SCHEMA_VERSION,
  flattenRichText,
} from "@icm/model";
import { describe, expect, it } from "vitest";

import { parseProjectWithMetadata } from "./load.js";
import { upgradeSchema34To35WithReport } from "./previous-to-current.js";

function schema34Project(): Record<string, unknown> {
  const project = createEmptyProject(
    "instance-reference",
    "Instance Reference",
  );
  const raw = structuredClone(project) as unknown as Record<string, unknown>;
  raw.schemaVersion = 34;
  const document = (raw.documents as Record<string, unknown>[])[0]!;
  document.instances = [
    {
      id: "opaque-mos",
      symbolId: "nmos",
      placement: null,
      schematicReference: "M_VISIBLE",
      schematicName: { runs: [{ kind: "text", value: "Bias device" }] },
      importProvenance: {
        kind: "model",
        name: "nch",
        sourceTarget: "nch",
      },
      netlist: {
        reference: "M7",
        binding: { kind: "model", deviceClass: "mos", name: "nch" },
        parameters: { w: "2u" },
      },
    },
    {
      id: "opaque-resistor",
      symbolId: "resistor",
      placement: null,
      schematicReference: "R2",
      netlist: { reference: "R2", parameters: { value: "10k" } },
    },
    {
      id: "ground-marker",
      symbolId: "ground",
      placement: null,
      schematicReference: "GND1",
      netlist: { reference: "GND1", parameters: {} },
    },
  ];
  document.annotations = [
    {
      id: "label-mos",
      kind: "instance-label",
      binding: { kind: "instance-schematic-name", instanceId: "opaque-mos" },
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
    {
      id: "label-resistor",
      kind: "instance-label",
      binding: {
        kind: "instance-schematic-name",
        instanceId: "opaque-resistor",
      },
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
  ];
  return raw;
}

describe("schema 34 to 35 Instance Reference migration", () => {
  it("unifies emitted and canvas references without retaining hidden authorities", () => {
    const result = upgradeSchema34To35WithReport(schema34Project());
    const document = (
      result.project.documents as Record<string, unknown>[]
    )[0]!;
    const instances = document.instances as Record<string, unknown>[];
    const mos = instances[0]!;
    const resistor = instances[1]!;
    const marker = instances[2]!;

    expect(result.project.schemaVersion).toBe(35);
    expect(mos.reference).toBe("M7");
    expect(mos).not.toHaveProperty("schematicReference");
    expect(mos).not.toHaveProperty("schematicName");
    expect(mos.netlist).not.toHaveProperty("reference");
    expect(mos.importProvenance).toEqual({
      kind: "model",
      sourceMasterName: "nch",
      sourceTarget: "nch",
    });
    expect(resistor.reference).toBe("R2");
    expect(marker).not.toHaveProperty("reference");
    expect(marker).not.toHaveProperty("netlist");

    const annotations = document.annotations as Record<string, unknown>[];
    expect(flattenRichText(annotations[0]!.content as never)).toBe(
      "Bias device",
    );
    expect(annotations[0]).not.toHaveProperty("binding");
    expect(annotations[1]!.binding).toEqual({
      kind: "instance-reference",
      instanceId: "opaque-resistor",
    });
    expect(result.report).toMatchObject({
      unifiedReferences: 2,
      materializedSchematicLabels: 1,
      migratedReferenceBindings: 1,
      removedMarkerReferences: 1,
      migratedImportProvenance: 1,
    });
  });

  it("preserves emitted tokens and deterministically disambiguates old cross-domain collisions", () => {
    const raw = schema34Project();
    const document = (raw.documents as Record<string, unknown>[])[0]!;
    (document.instances as Record<string, unknown>[]).push({
      id: "schematic-only",
      symbolId: "ideal-switch",
      placement: null,
      schematicReference: "m7",
    });

    const result = upgradeSchema34To35WithReport(raw);
    const instances = documentInstances(result.project);
    expect(
      instances.find((instance) => instance.id === "opaque-mos")?.reference,
    ).toBe("M7");
    expect(
      instances.find((instance) => instance.id === "schematic-only")?.reference,
    ).toBe("m7_2");
    expect(result.report.renamedConflictingReferences).toBe(1);
    expect(
      parseProjectWithMetadata(JSON.stringify(result.project)).project
        .schemaVersion,
    ).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
  });

  it("loads schema 34 through the contiguous chain into the strict current schema", () => {
    const parsed = parseProjectWithMetadata(JSON.stringify(schema34Project()));
    expect(parsed.sourceSchemaVersion).toBe(34);
    expect(parsed.migrated).toBe(true);
    expect(parsed.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(parsed.project.documents[0]!.instances[0]).toMatchObject({
      id: "opaque-mos",
      reference: "M7",
      netlist: { parameters: { w: "2u" } },
    });
  });
});

function documentInstances(
  project: Record<string, unknown>,
): Record<string, unknown>[] {
  const document = (project.documents as Record<string, unknown>[])[0]!;
  return document.instances as Record<string, unknown>[];
}
