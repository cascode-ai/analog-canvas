import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { buildProjectInstanceIndex } from "./project-instance-index.js";

describe("ProjectInstanceIndex", () => {
  it("has one definition row per document and instance with reference evidence", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("child", "Child");
    project.documents.push(child);
    project.documents[0]!.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
      netlist: { parameters: { value: "10k" } },
    });
    child.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "C1",
      netlist: { parameters: {} },
    });

    const index = buildProjectInstanceIndex(project);

    expect(index.rows).toHaveLength(2);
    expect(index.row("child", "R1")).toMatchObject({
      reference: "C1",
      referenceIssues: [{ code: "WRONG_REFERENCE_PREFIX" }],
    });
    expect(index.search("10K").map((row) => row.key)).toEqual([
      "document-main\u0000R1",
    ]);
  });

  it("keeps internal ID, authored Reference, and master distinct", () => {
    const project = createEmptyProject("project", "Project");
    project.externalSubcircuitDefinitions.push({
      id: "master-sky130-nfet",
      name: "sky130_fd_pr__nfet_01v8",
      terminals: [],
      formalParameters: [],
      interfaceStatus: "declared",
    });
    project.documents[0]!.instances.push({
      id: "imported-instance-4c3b",
      symbolId: "generic-block-2",
      placement: null,
      reference: "XBIAS",
      netlist: {
        binding: {
          kind: "external-subcircuit",
          definitionId: "master-sky130-nfet",
        },
        parameters: {},
      },
    });

    const row = buildProjectInstanceIndex(project).row(
      "document-main",
      "imported-instance-4c3b",
    );
    expect(row).toMatchObject({
      instanceId: "imported-instance-4c3b",
      reference: "XBIAS",
      masterName: "sky130_fd_pr__nfet_01v8",
    });
    expect(buildProjectInstanceIndex(project).search("XBIAS")).toHaveLength(1);
  });
});
