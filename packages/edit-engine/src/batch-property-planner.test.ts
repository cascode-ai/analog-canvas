import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { planBatchProperty } from "./batch-property-planner.js";
import { executeProjectTransaction } from "./project-transaction.js";

describe("planBatchProperty", () => {
  it("groups compatible parameter assignments into one bulk edit per Cell", () => {
    const project = createEmptyProject("project", "Project");
    project.documents[0]!.instances.push(
      {
        id: "M1",
        symbolId: "nmos",
        placement: null,
        reference: "M1",
        netlist: { parameters: { l: "60n" } },
      },
      {
        id: "R1",
        symbolId: "resistor",
        placement: null,
        reference: "R1",
        netlist: { parameters: {} },
      },
    );
    const plan = planBatchProperty(
      project,
      [
        { documentId: project.topDocumentId, instanceId: "M1" },
        { documentId: project.topDocumentId, instanceId: "R1" },
      ],
      { kind: "parameter", name: "l" },
      "120n",
    );
    expect(plan.applicable).toHaveLength(1);
    expect(plan.incompatible).toMatchObject([
      { instanceId: "R1", reason: "l is not a descriptor parameter" },
    ]);
    expect(plan.edits).toEqual([
      {
        kind: "transact_document",
        documentId: project.topDocumentId,
        expectedRevision: 0,
        edits: [
          {
            kind: "bulk_patch_instance_netlist",
            assignments: [{ instanceId: "M1", set: { l: "120n" } }],
          },
        ],
      },
    ]);
  });

  it("applies one planned change atomically across Cells", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("child", "Child");
    project.documents.push(child);
    project.documents[0]!.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: null,
      reference: "M1",
      netlist: { parameters: { l: "60n" } },
    });
    child.instances.push({
      id: "M2",
      symbolId: "nmos",
      placement: null,
      reference: "M2",
      netlist: { parameters: { l: "60n" } },
    });

    const plan = planBatchProperty(
      project,
      [
        { documentId: project.topDocumentId, instanceId: "M1" },
        { documentId: child.id, instanceId: "M2" },
      ],
      { kind: "parameter", name: "l" },
      "120n",
    );
    const result = executeProjectTransaction(project, {
      transactionId: "batch-set-l",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: plan.edits,
    });

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      structureRevision: 1,
      project: {
        documents: [
          {
            revision: 1,
            instances: [{ netlist: { parameters: { l: "120n" } } }],
          },
          {
            revision: 1,
            instances: [{ netlist: { parameters: { l: "120n" } } }],
          },
        ],
      },
    });
  });
});
