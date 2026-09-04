import {
  createEmptyProject,
  CURRENT_PROJECT_SCHEMA_VERSION,
  flattenRichText,
  semanticTextDocument,
} from "@icm/model";
import { describe, expect, it } from "vitest";

import { parseProjectWithMetadata } from "./load.js";
import { upgradeSchema35To36WithReport } from "./previous-to-current.js";

function schema35Project(): Record<string, unknown> {
  const project = createEmptyProject(
    "reference-annotation",
    "Reference Annotation",
  );
  const raw = structuredClone(project) as unknown as Record<string, unknown>;
  raw.schemaVersion = 35;
  const document = (raw.documents as Record<string, unknown>[])[0]!;
  document.instances = [
    {
      id: "copied-mos",
      symbolId: "nmos",
      reference: "M15",
      placement: null,
      netlist: { parameters: {} },
    },
    {
      id: "tail-current",
      symbolId: "current-source",
      reference: "I1",
      placement: null,
      netlist: { parameters: {} },
    },
  ];
  document.annotations = [
    {
      id: "instance-label-copied-mos",
      kind: "instance-label",
      content: semanticTextDocument("M5", "instance-label"),
      anchor: {
        kind: "object",
        objectId: "copied-mos",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    },
    {
      id: "instance-label-tail-current",
      kind: "instance-label",
      content: semanticTextDocument("ISS", "instance-label"),
      anchor: {
        kind: "object",
        objectId: "tail-current",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    },
  ];
  return raw;
}

describe("schema 35 to 36 Instance Reference Annotation migration", () => {
  it("restores a copied designator mapping while retaining a descriptive label", () => {
    const result = upgradeSchema35To36WithReport(schema35Project());
    const document = (
      result.project.documents as Record<string, unknown>[]
    )[0]!;
    const annotations = document.annotations as Record<string, unknown>[];

    expect(result.project.schemaVersion).toBe(36);
    expect(annotations[0]).toMatchObject({
      binding: { kind: "instance-reference", instanceId: "copied-mos" },
    });
    expect(annotations[0]).not.toHaveProperty("content");
    expect(flattenRichText(annotations[0]!.formatOverride as never)).toBe(
      "M15",
    );
    expect(annotations[0]!.formatOverride).toMatchObject({
      runs: [
        { kind: "span", style: "italic" },
        { kind: "span", style: "subscript" },
      ],
    });
    expect(annotations[1]).not.toHaveProperty("binding");
    expect(flattenRichText(annotations[1]!.content as never)).toBe("ISS");
    expect(result.report).toEqual({
      repairedReferenceAnnotations: 1,
      retainedAttachedLabels: 1,
      changed: true,
    });
  });

  it("loads schema 35 through the contiguous chain into the current schema", () => {
    const parsed = parseProjectWithMetadata(JSON.stringify(schema35Project()));

    expect(parsed.sourceSchemaVersion).toBe(35);
    expect(parsed.migrated).toBe(true);
    expect(parsed.project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(parsed.project.documents[0]!.annotations[0]!.binding).toEqual({
      kind: "instance-reference",
      instanceId: "copied-mos",
    });
  });
});
