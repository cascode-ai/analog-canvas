import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";
import { parseProject, serializeProject, validateProject } from "./index.js";

function fixture() {
  const project = createEmptyProject("model", "Model");
  project.modelSources = [
    {
      id: "native",
      language: "spice",
      entry: "model.spice",
      revision: 2,
      dependencies: [],
      files: [
        {
          path: "model.spice",
          text: ".subckt amp A B params: gain=3\nB1 B 0 V={gain*v(A)}\n.ends amp\n",
        },
      ],
      draft: {
        entry: "model.spice",
        baseRevision: 2,
        files: [{ path: "model.spice", text: ".subckt unfinished" }],
      },
    },
  ];
  project.externalSubcircuitDefinitions.push({
    id: "amp",
    name: "amp",
    terminals: [
      { id: "a", name: "A", direction: "input" },
      { id: "b", name: "B", direction: "output" },
    ],
    formalParameters: [{ name: "gain", defaultValue: "3" }],
    interfaceStatus: "declared",
    implementation: { kind: "source", sourceId: "native", entry: "amp" },
  });
  return project;
}
describe("Model source persistence", () => {
  it("round trips applied and unfinished bytes in schema 66 and rejects competing interface facts", () => {
    const project = fixture();
    const text = serializeProject(project);
    expect(JSON.parse(text).schemaVersion).toBe(66);
    expect(parseProject(text).modelSources).toEqual(project.modelSources);
    expect(serializeProject(parseProject(text))).toBe(text);
    const old = JSON.parse(text);
    old.schemaVersion = 65;
    expect(() => parseProject(JSON.stringify(old))).toThrow(/schema 66/);
    project.externalSubcircuitDefinitions[0]!.terminals.reverse();
    expect(() => validateProject(project)).toThrow(
      /authoritative model source/,
    );
  });
});
