import { withProjectComponentDefinitions } from "@icm/symbols";
import {
  AnnotationSchema,
  CURRENT_PROJECT_SCHEMA_VERSION,
  createEmptyProject,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "./index.js";

function fixture() {
  const project = createEmptyProject("magnetic", "Magnetic display");
  project.documents[0]!.instances.push({
    id: "T1",
    symbolId: "xfmr",
    reference: "T1",
    netlist: { parameters: { k: "0.8", lp: "2n", ls: "4n" } },
    placement: {
      position: { x: 100, y: 100 },
      rotation: 45,
      mirror: "horizontal",
    },
  });
  return project;
}

const annotation = {
  id: "k-T1",
  kind: "instance-value" as const,
  binding: {
    kind: "instance-value" as const,
    instanceId: "T1",
    parameter: "k",
  },
  anchor: {
    kind: "object" as const,
    objectId: "T1",
    localOffset: { x: 50, y: 0 },
    fallbackPosition: { x: 150, y: 100 },
  },
  rotation: 0 as const,
  alignment: "start" as const,
  locked: false,
  visible: false,
};

describe("schema 54 named parameter annotations", () => {
  it("advances schema 53 without creating parameter displays or changing the circuit", () => {
    const previous = fixture();
    previous.schemaVersion = 53 as typeof previous.schemaVersion;
    expect(parseProject(JSON.stringify(previous))).toEqual({
      ...previous,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    });
  });
  it("round-trips live selectors, hidden state and custom placement", () => {
    const project = fixture();
    project.documents[0]!.annotations.push(annotation);
    const text = serializeProject(project);
    expect(parseProject(text)).toEqual(
      withProjectComponentDefinitions(project),
    );
    expect(serializeProject(parseProject(text))).toBe(text);
  });
  it("accepts named and aggregate bindings but rejects invalid parameter names and unknown fields", () => {
    expect(AnnotationSchema.safeParse(annotation).success).toBe(true);
    expect(
      AnnotationSchema.safeParse({
        ...annotation,
        binding: { kind: "instance-value", instanceId: "T1" },
      }).success,
    ).toBe(true);
    for (const binding of [
      { ...annotation.binding, parameter: "" },
      { ...annotation.binding, parameter: "p".repeat(129) },
      { ...annotation.binding, parameter: 4 },
      { ...annotation.binding, extra: true },
    ])
      expect(
        AnnotationSchema.safeParse({ ...annotation, binding }).success,
      ).toBe(false);
  });
});
