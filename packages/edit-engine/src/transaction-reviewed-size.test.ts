import { createEmptyProject, type CircuitProject } from "@icm/model";
import { expect, it } from "vitest";

import { planSetDeviceModelTarget } from "./device-model-target-planner.js";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";

it("fits a 16 V part an edit resizes, keeping what the edit set where SKY130 allows (#1485)", () => {
  const project = createEmptyProject("project", "Project");
  project.documents[0]!.instances.push({
    id: "M1",
    symbolId: "ndmos",
    placement: null,
    reference: "M1",
    netlist: { parameters: {} },
  });
  const commit = (source: CircuitProject, edits: ProjectStructureEdit[]) => {
    const result = executeProjectTransaction(source, {
      transactionId: "edit",
      projectId: source.id,
      expectedStructureRevision: source.structureRevision,
      actor: { kind: "human", id: "test" },
      edits,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.project;
  };
  const choose = (source: CircuitProject) =>
    planSetDeviceModelTarget(
      source,
      source.topDocumentId,
      "M1",
      "sky130_fd_pr__nfet_g5v0d16v0",
    );
  const type = (source: CircuitProject, set: Record<string, string>) => {
    const document = source.documents[0]!;
    const typed = commit(source, [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: [
          {
            kind: "bulk_patch_instance_netlist",
            assignments: [{ instanceId: "M1", set }],
          },
        ],
      },
    ]);
    const { w, l } = typed.documents[0]!.instances[0]!.netlist!.parameters;
    return { typed, size: `${w} ${l}` };
  };
  const bound = commit(project, choose(project));
  // W 55 µm at L 0.7 µm is a 16 V size; L 2.2 µm is not with W 55 µm, so the
  // L just typed stays and W takes the device's own 5 µm.
  const wide = type(bound, { w: "55u" });
  expect(wide.size).toBe("55u 700n");
  const long = type(wide.typed, { l: "2.2u" });
  expect(long.size).toBe("5u 2.2u");
  // W 10 µm has no model at any L, so W returns to 5 µm; L stays.
  expect(type(long.typed, { w: "10u" }).size).toBe("5u 2.2u");
  // Choosing the device again changes nothing.
  expect(choose(long.typed)).toEqual([]);
});
