import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { executeProjectTransaction } from "./project-transaction.js";
import { proposeUpsertExternalSubcircuitDefinition } from "./hierarchy-planner.js";
import { externalSubcircuitSymbolId } from "@icm/symbols";
import { reviewedExternalBindingForMaster } from "@icm/devices";

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
  it("refuses a new mixed amplifier alias set and allows repairing an existing one", () => {
    const project = createEmptyProject("project", "Project");
    const document = project.documents[0]!;
    const definition = {
      id: "gain",
      name: "gain_two",
      interfaceStatus: "declared" as const,
      formalParameters: [],
      terminals: ["INP", "INN", "OUT"].map((name, index) => ({
        id: `p${index}`,
        name,
        direction: "passive" as const,
      })),
    };
    project.externalSubcircuitDefinitions.push(definition);
    document.instances.push({
      id: "amp",
      reference: "XAMP",
      symbolId: "opamp",
      placement: null,
      netlist: {
        parameters: {},
        binding: { kind: "external-subcircuit", definitionId: "gain" },
      },
    });
    document.nets.push(
      { id: "positive", terminals: [{ instanceId: "amp", pinName: "IN+" }] },
      { id: "negative", terminals: [{ instanceId: "amp", pinName: "IN-" }] },
    );
    const wrongLocalSpelling = transaction(project, [
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: [
          {
            kind: "set_property_terminal_net",
            instanceId: "amp",
            pinName: "in+",
            netId: "negative",
          },
        ],
      },
    ]);
    expect(wrongLocalSpelling).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_RESULT",
        message: expect.stringContaining("XAMP.in+"),
      },
      project,
    });
    const mixed = {
      ...definition,
      terminals: [
        ...definition.terminals,
        { id: "alias", name: "VIP", direction: "passive" as const },
      ],
    };
    const withOdds = {
      ...mixed,
      terminals: [
        ...mixed.terminals,
        { id: "unknown", name: "BAD", direction: "passive" as const },
      ],
    };
    const refused = transaction(project, [
      { kind: "upsert_external_subcircuit_definition", definition: mixed },
    ]);
    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_RESULT",
        message: expect.stringContaining("XAMP"),
      },
    });
    project.externalSubcircuitDefinitions[0] = withOdds;
    const partial = transaction(project, [
      { kind: "upsert_external_subcircuit_definition", definition: mixed },
    ]);
    if (!partial.ok) throw new Error(partial.error.message);
    const repaired = transaction(partial.project, [
      { kind: "upsert_external_subcircuit_definition", definition },
    ]);
    expect(repaired).toMatchObject({ ok: true });
  });

  it("protects reviewed PDK identity and mapping but allows presentation updates", () => {
    const project = createEmptyProject("project", "Project");
    const reviewed = reviewedExternalBindingForMaster(
      "sky130_fd_pr__nfet_01v8",
    )!;
    const definition = {
      id: "pdk",
      name: reviewed.masterName,
      terminals: reviewed.terminals.map((terminal, index) => ({
        id: `p${index}`,
        name: terminal.targetName,
        direction: "passive" as const,
      })),
      formalParameters: [],
      interfaceStatus: "declared" as const,
    };
    project.externalSubcircuitDefinitions.push(definition);
    for (const change of [
      { name: "Other" },
      { terminals: [...definition.terminals].reverse() },
      { formalParameters: [{ name: "w", defaultValue: "2" }] },
    ]) {
      const proposal = proposeUpsertExternalSubcircuitDefinition(project, {
        ...definition,
        ...change,
      });
      expect(proposal.diagnostics).toEqual([
        expect.stringContaining("Reviewed PDK"),
      ]);
      expect(proposal.edits).toEqual([]);
    }
    expect(
      proposeUpsertExternalSubcircuitDefinition(project, {
        ...definition,
        presentation: { pinPlacements: [] },
      }).diagnostics,
    ).toEqual([]);
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
});
