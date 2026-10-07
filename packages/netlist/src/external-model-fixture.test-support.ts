import { createEmptyProject, type ProjectModelSource } from "@icm/model";
import { externalSubcircuitSymbolId } from "@icm/symbols";
import { expect } from "vitest";
import type { ProjectModelSourceLocation } from "./project-model-source.js";

export function expectModelSourceMapping(
  text: string,
  segments: readonly ProjectModelSourceLocation[],
  source: ProjectModelSource,
) {
  expect(segments.length).toBeGreaterThan(0);
  for (const segment of segments) {
    const original = source.files.find((file) => file.path === segment.path)!;
    expect(text.slice(segment.startOffset, segment.endOffset)).toBe(
      original.text.slice(
        segment.sourceOffset,
        segment.sourceOffset + segment.endOffset - segment.startOffset,
      ),
    );
  }
}

export function externalModelFixture() {
  const project = createEmptyProject("owned-model", "Owned model");
  project.modelSources = [
    {
      id: "source",
      language: "spice",
      revision: 1,
      entry: "gain.spice",
      dependencies: [],
      files: [
        {
          path: "gain.spice",
          text: '.include "helper.spice"\n.subckt gain_block A B params: gain=2\nBOUT B A V={gain*v(A,B)}\nXHELP A B helper\n.ends gain_block\n',
        },
        {
          path: "helper.spice",
          text: ".subckt helper A B\nRHELP A B 1Meg\n.ends helper\n",
        },
      ],
    },
  ];
  project.externalSubcircuitDefinitions = [
    {
      id: "gain",
      name: "gain_block",
      interfaceStatus: "declared",
      terminals: [
        { id: "a", name: "A", direction: "input" },
        { id: "b", name: "B", direction: "output" },
      ],
      formalParameters: [{ name: "gain", defaultValue: "2" }],
      implementation: {
        kind: "source",
        sourceId: "source",
        entry: "gain_block",
      },
    },
  ];
  const document = project.documents[0]!;
  for (const id of ["X1", "X2"]) {
    document.instances.push({
      id,
      reference: id,
      symbolId: externalSubcircuitSymbolId("gain"),
      placement: {
        position: { x: 200, y: id === "X1" ? 160 : 280 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "gain" },
        parameters: {},
      },
    });
    for (const pinName of ["A", "B"])
      document.noConnects.push({
        id: id + pinName,
        endpoint: { kind: "terminal", instanceId: id, pinName },
      });
  }
  return project;
}
