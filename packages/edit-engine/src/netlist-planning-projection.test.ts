import { describe, expect, it } from "vitest";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { reviewedExternalBindingForMaster } from "@icm/devices";
import { createNetlistPlanningProjection } from "./netlist-planning-projection.js";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";
import { planSetDeviceModelTarget } from "./device-model-target-planner.js";
import type { SchematicEdit } from "./edit-schema.js";

function fixture() {
  const project = createEmptyProject("planning", "Planning");
  project.documents[0]!.instances.push({
    id: "R1",
    reference: "R1",
    symbolId: "resistor",
    placement: null,
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { value: "1k" },
    },
  });
  return project;
}
function full(project: CircuitProject, edits: ProjectStructureEdit[]) {
  const result = executeProjectTransaction(project, {
    transactionId: "planning-oracle",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.project;
}
function documentEdits(
  project: CircuitProject,
  edits: SchematicEdit[],
): ProjectStructureEdit[] {
  const document = project.documents[0]!;
  return [
    {
      kind: "transact_document",
      documentId: document.id,
      expectedRevision: document.revision,
      edits,
    },
  ];
}

describe("ordered netlist planning projection", () => {
  it("matches real intermediate transactions without mutating the source", () => {
    const source = fixture(),
      before = structuredClone(source);
    const projection = createNetlistPlanningProjection(source);
    let authoritative = source;
    const target = "sky130_fd_pr__res_high_po";
    const stage = (edits: ProjectStructureEdit[]) => {
      authoritative = full(authoritative, edits);
      projection.stage(edits);
      expect(projection.project).toEqual(authoritative);
      expect(source).toEqual(before);
    };
    stage(
      planSetDeviceModelTarget(
        authoritative,
        source.topDocumentId,
        "R1",
        target,
      ),
    );
    const property = reviewedExternalBindingForMaster(target)!.terminals.find(
      (item) => item.interaction === "property",
    )!;
    const cached = projection.logicalNets(source.topDocumentId);
    stage(
      documentEdits(authoritative, [
        { kind: "create_base_net", netId: "substrate" },
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "supply-label",
            kind: "net-label",
            netId: "substrate",
            binding: { kind: "net-name", netId: "substrate" },
            visible: false,
            anchor: {
              kind: "object",
              objectId: "R1",
              localOffset: { x: 0, y: 0 },
              fallbackPosition: { x: 0, y: 0 },
            },
            alignment: "start",
            rotation: 0,
            locked: false,
          },
        },
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: "supply-claim",
            kind: "name-claim",
            netId: "substrate",
            name: "0",
            scope: "global",
            powerDomain: "ground",
            owner: { kind: "net-label", annotationId: "supply-label" },
          },
        },
        {
          kind: "set_property_terminal_net",
          instanceId: "R1",
          pinName: property.pinName,
          netId: "substrate",
        },
      ]),
    );
    expect(projection.logicalNets(source.topDocumentId)).not.toBe(cached);
    expect(
      projection.logicalNets(source.topDocumentId).byBaseNetId.get("substrate")
        ?.powerDomain,
    ).toBe("ground");
    stage(
      planSetDeviceModelTarget(authoritative, source.topDocumentId, "R1", ""),
    );
  });

  it("keeps metadata edits on one private copy and retains logical facts", () => {
    const source = fixture();
    const projection = createNetlistPlanningProjection(source);
    const first = projection.project;
    const logical = projection.logicalNets(source.topDocumentId);
    const edits = documentEdits(source, [
      {
        kind: "bulk_patch_instance_netlist",
        assignments: [{ instanceId: "R1", set: { value: "2k" } }],
      },
    ]);
    projection.stage(edits);
    expect(projection.project).toBe(first);
    expect(projection.project).toEqual(full(source, edits));
    expect(projection.logicalNets(source.topDocumentId)).toBe(logical);
    expect(source.documents[0]!.instances[0]!.netlist!.parameters.value).toBe(
      "1k",
    );
  });

  it("uses the authoritative path for geometry edits", () => {
    const source = fixture();
    source.documents[0]!.instances[0]!.placement = {
      position: { x: 100, y: 100 },
      rotation: 0,
      mirror: "none",
    };
    const projection = createNetlistPlanningProjection(source);
    const edits = documentEdits(source, [
      { kind: "move_instance", instanceId: "R1", position: { x: 200, y: 100 } },
    ]);
    projection.stage(edits);
    expect(projection.project).toEqual(full(source, edits));
    expect(source.documents[0]!.instances[0]!.placement!.position.x).toBe(100);
  });

  it("retains local rejection and never changes the real Project on failure", () => {
    const source = fixture(),
      before = structuredClone(source);
    const edits = documentEdits(source, [
      {
        kind: "bulk_patch_instance_netlist",
        assignments: [
          { instanceId: "R1", set: { value: "2k" }, unset: ["VALUE"] },
        ],
      },
    ]);
    expect(() => createNetlistPlanningProjection(source).stage(edits)).toThrow(
      "cannot set and unset value",
    );
    expect(() => full(source, edits)).toThrow("cannot set and unset value");
    expect(source).toEqual(before);
  });
});
