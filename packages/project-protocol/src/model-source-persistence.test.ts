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
  it("preserves authoring candidates without executable changes and requires their portable schema", () => {
    const project = fixture();
    project.modelSources![0]!.draft!.authoring = [
      {
        definitionId: "amp",
        entry: "unfinished",
        symbolMode: "custom",
        artworkText: "{ unfinished JSON",
        portMaps: { amp: { A: "IN" } },
      },
    ];
    project.componentAuthoringDrafts = [
      { id: "artwork-draft", text: "{ unfinished artwork" },
    ];
    const saved = serializeProject(project);
    expect(JSON.parse(saved).schemaVersion).toBe(68);
    const reopened = parseProject(saved);
    expect(reopened.modelSources).toEqual(project.modelSources);
    expect(reopened.componentAuthoringDrafts).toEqual(
      project.componentAuthoringDrafts,
    );
    const old = JSON.parse(saved);
    old.schemaVersion = 67;
    expect(() => parseProject(JSON.stringify(old))).toThrow(/schema 68/);
  });
  it("round trips applied and unfinished bytes in the current schema and rejects competing interface facts", () => {
    const project = fixture();
    const text = serializeProject(project);
    expect(JSON.parse(text).schemaVersion).toBe(68);
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
  it("round trips a native Spectre owner and independently saved SPICE draft while retaining schema 66 compatibility", () => {
    const project = fixture();
    const legacy = JSON.parse(serializeProject(project));
    legacy.schemaVersion = 66;
    expect(parseProject(JSON.stringify(legacy)).modelSources).toEqual(
      project.modelSources,
    );
    const source = project.modelSources![0]!;
    source.language = "spectre";
    source.files[0]!.text =
      "subckt amp (A B)\nparameters gain=3\nE1 (B 0 A 0) vcvs gain=gain\nends amp\n";
    source.draft!.language = "spice";
    const text = serializeProject(project);
    expect(parseProject(text).modelSources).toEqual(project.modelSources);
    expect(serializeProject(parseProject(text))).toBe(text);
    const wrong = JSON.parse(text);
    wrong.schemaVersion = 66;
    expect(() => parseProject(JSON.stringify(wrong))).toThrow(/schema 67/);
  });
});
