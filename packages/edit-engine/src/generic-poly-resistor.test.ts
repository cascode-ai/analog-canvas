import { createEmptyProject, type CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { expect, it } from "vitest";

import { planSetDeviceModelTarget } from "./device-model-target-planner.js";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";

function resistorProject() {
  const project = createEmptyProject("poly", "Poly");
  const document = project.documents[0]!;
  for (const id of ["R1", "R2"]) {
    document.instances.push({
      id,
      reference: id,
      symbolId: "resistor",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    });
  }
  document.nets.push(
    {
      id: "net-a",
      terminals: [
        { instanceId: "R1", pinName: "1" },
        { instanceId: "R2", pinName: "1" },
      ],
    },
    {
      id: "net-b",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "2" },
      ],
    },
  );
  return project;
}

function run(project: CircuitProject, edits: ProjectStructureEdit[]) {
  const result = executeProjectTransaction(project, {
    transactionId: "generic-poly",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "agent", id: "test" },
    edits,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.project;
}

function bind(project: CircuitProject, instanceId: string) {
  return run(
    project,
    planSetDeviceModelTarget(
      project,
      project.topDocumentId,
      instanceId,
      "sky130_fd_pr__res_generic_po",
    ),
  );
}

it("sets a generic poly target and reopens it as a two-terminal PDK call at its defaults", () => {
  const bound = bind(bind(resistorProject(), "R1"), "R2");
  const restored = parseProject(serializeProject(bound));
  expect(restored.externalSubcircuitDefinitions).toHaveLength(1);
  expect(
    restored.externalSubcircuitDefinitions[0]!.terminals.map(
      ({ name }) => name,
    ),
  ).toEqual(["t1", "t2"]);
  expect(restored.documents[0]!.instances[0]!.netlist?.parameters).toEqual({
    w: "1u",
    l: "1u",
  });
  const exported = createDesignNetlistExport(restored, { format: "spice" });
  if (exported.status !== "ready")
    throw new Error(JSON.stringify(exported.diagnostics));
  expect(exported.file.text).toMatch(
    /^XR1 net0 net1 sky130_fd_pr__res_generic_po w=1 l=1$/mu,
  );
  expect(exported.file.text).not.toMatch(
    /^\.subckt sky130_fd_pr__res_generic_po\b/mu,
  );
});

it.each([
  [
    "spice",
    "XR1 net0 net1 sky130_fd_pr__res_generic_po w=1000 l=0.35",
    "XR2 net0 net1 sky130_fd_pr__res_generic_po w=1.2 l=0.35",
  ],
  [
    "spectre",
    "R1 (net0 net1) sky130_fd_pr__res_generic_po w=1000 l=0.35",
    "R2 (net0 net1) sky130_fd_pr__res_generic_po w=1.2 l=0.35",
  ],
] as const)(
  "exports authored generic poly geometry in %s micrometres",
  (format, first, second) => {
    const bound = bind(bind(resistorProject(), "R1"), "R2");
    const document = bound.documents[0]!;
    const sized = run(bound, [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: [
          {
            kind: "bulk_patch_instance_netlist",
            assignments: [
              { instanceId: "R1", set: { w: "1000u", l: "350n" } },
              { instanceId: "R2", set: { w: "1.2u", l: "350n" } },
            ],
          },
        ],
      },
    ]);
    const restored = parseProject(serializeProject(sized));
    const exported = createDesignNetlistExport(restored, { format });
    if (exported.status !== "ready")
      throw new Error(JSON.stringify(exported.diagnostics));
    expect(exported.file.text.split("\n")).toEqual(
      expect.arrayContaining([first, second]),
    );
    expect(exported.file.text).not.toMatch(
      /^(?:\.subckt|subckt) sky130_fd_pr__res_generic_po\b/mu,
    );
  },
);

it.each(["", "Rauth t1 t2 2k\n"])(
  "refuses to replace a same-name authored source, preserving its body %j",
  (body) => {
    const project = resistorProject();
    project.externalSubcircuitDefinitions.push({
      id: "authored-poly",
      name: "sky130_fd_pr__res_generic_po",
      terminals: [
        { id: "t1", name: "t1", direction: "passive" },
        { id: "t2", name: "t2", direction: "passive" },
      ],
      formalParameters: [
        { name: "w", defaultValue: "1" },
        { name: "l", defaultValue: "1" },
      ],
      interfaceStatus: "declared",
      implementation: {
        kind: "source",
        sourceId: "authored-source",
        entry: "sky130_fd_pr__res_generic_po",
      },
    });
    project.modelSources = [
      {
        id: "authored-source",
        language: "spice",
        entry: "poly.spi",
        files: [
          {
            path: "poly.spi",
            text: `.subckt sky130_fd_pr__res_generic_po t1 t2 w=1 l=1\n${body}.ends\n`,
          },
        ],
        dependencies: [],
        revision: 0,
      },
    ];
    const saved = serializeProject(project);
    expect(() => bind(project, "R1")).toThrow(
      "Existing external definition sky130_fd_pr__res_generic_po does not match its reviewed public terminal order",
    );
    expect(serializeProject(project)).toBe(saved);
  },
);
