import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { executeProjectTransaction } from "./project-transaction.js";
import {
  planRenameExternalSubcircuitTerminal,
  proposeSetCellFormalParameters,
  proposeUpsertExternalSubcircuitDefinition,
} from "./hierarchy-planner.js";
import { externalSubcircuitSymbolId } from "@icm/symbols";

function transaction(
  project: ReturnType<typeof createEmptyProject>,
  edits: unknown,
) {
  return executeProjectTransaction(project, {
    transactionId: "interface-change",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits,
  });
}

describe("subcircuit interface proposals", () => {
  it("edits ordered internal formal parameters through one project transaction", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("child", "Child");
    child.netlist = { name: "Child", terminals: [], formalParameters: [] };
    project.documents.push(child);
    const proposal = proposeSetCellFormalParameters(project, child.id, [
      { name: "gain", defaultValue: "10" },
      { name: "bias" },
    ]);

    expect(proposal.callers).toEqual([]);
    const result = transaction(project, proposal.edits);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.project.documents.find((document) => document.id === child.id)
        ?.netlist?.formalParameters,
    ).toEqual([{ name: "gain", defaultValue: "10" }, { name: "bias" }]);
  });

  it("reports caller impact before an external definition drops a connected pin", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    project.externalSubcircuitDefinitions.push({
      id: "external-ota",
      name: "OTA",
      terminals: [
        { id: "external-ota-in", name: "IN", direction: "passive" },
        { id: "external-ota-out", name: "OUT", direction: "passive" },
      ],
      formalParameters: [],
      interfaceStatus: "declared",
    });
    document.instances.push({
      id: "X1",
      symbolId: "external-ota",
      placement: null,
      reference: "X1",
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "external-ota" },
        parameters: {},
      },
    });
    document.nets.push({
      id: "net-out",

      terminals: [{ instanceId: "X1", pinName: "OUT" }],
    });

    const proposal = proposeUpsertExternalSubcircuitDefinition(project, {
      id: "external-ota",
      name: "OTA",
      terminals: [{ id: "external-ota-in", name: "IN", direction: "passive" }],
      formalParameters: [],
      interfaceStatus: "declared",
    });

    expect(proposal.callers).toEqual([
      { documentId: document.id, instanceId: "X1" },
    ]);
    expect(proposal.diagnostics).toEqual([
      `${document.id}.X1 references removed external terminal OUT`,
    ]);
    const result = transaction(project, proposal.edits);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_RESULT");
  });

  it("refreshes every bound black-box symbol when an external target is renamed", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    project.externalSubcircuitDefinitions.push({
      id: "external-ota",
      name: "OTA",
      terminals: [],
      formalParameters: [],
      interfaceStatus: "declared",
    });
    document.instances.push({
      id: "X1",
      symbolId: externalSubcircuitSymbolId("external-ota"),
      placement: null,
      reference: "X1",
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "external-ota" },
        parameters: {},
      },
    });

    const proposal = proposeUpsertExternalSubcircuitDefinition(project, {
      id: "external-ota",
      name: "OTA2",
      terminals: [],
      formalParameters: [],
      interfaceStatus: "declared",
    });
    const result = transaction(project, proposal.edits);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.documents[0]!.instances[0]!.symbolId).toBe(
      externalSubcircuitSymbolId("external-ota"),
    );
  });

  it("renames a stable external terminal and reconciles connected callers", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    project.externalSubcircuitDefinitions.push({
      id: "external-ota",
      name: "OTA",
      terminals: [{ id: "external-ota-out", name: "OUT", direction: "output" }],
      formalParameters: [],
      interfaceStatus: "declared",
    });
    document.instances.push({
      id: "X1",
      symbolId: externalSubcircuitSymbolId("external-ota"),
      placement: null,
      reference: "X1",
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "external-ota" },
        parameters: {},
      },
    });
    document.nets.push({
      id: "net-out",

      terminals: [{ instanceId: "X1", pinName: "OUT" }],
    });

    const result = transaction(
      project,
      planRenameExternalSubcircuitTerminal(
        project,
        "external-ota",
        "external-ota-out",
        "VOUT",
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.project.externalSubcircuitDefinitions[0]!.terminals[0],
    ).toMatchObject({
      id: "external-ota-out",
      name: "VOUT",
    });
    expect(result.project.documents[0]!.nets[0]!.terminals).toEqual([
      { instanceId: "X1", pinName: "VOUT" },
    ]);
  });
});
