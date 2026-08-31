import { createRoutePath } from "@icm/model";
import { describe, expect, it } from "vitest";

import { createEmptyDocument, createEmptyProject } from "@icm/model";

import { DocumentHistory } from "./history.js";
import { planCellReset } from "./cell-reset-planner.js";

function fixture() {
  const project = createEmptyProject("project", "Project", "top");
  const child = createEmptyDocument("child", "Child");
  child.instances.push(
    {
      id: "P1",
      symbolId: "port",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    },
    {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      schematicReference: "R1",
      netlist: {
        reference: "R1",
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: {},
      },
    },
  );
  child.nets.push({
    id: "net-in",

    terminals: [
      { instanceId: "P1", pinName: "P" },
      { instanceId: "R1", pinName: "P" },
    ],
  });
  child.nets.push({ id: "net-body", terminals: [] });
  child.connectivityEvidence.push(
    {
      id: "source-interface",
      kind: "spice-source",
      netId: "net-in",
      sourceNetId: "source-in",
    },
    {
      id: "claim-body",
      kind: "net-name-hint",
      netId: "net-body",
      sourceName: "BODY",
      origin: "legacy-explicit-net-property",
    },
    {
      id: "claim-route",
      kind: "name-claim",
      netId: "net-in",
      name: "IN",
      owner: { kind: "power-marker", objectId: "route-in" },
      scope: "local",
    },
  );
  child.routes.push(
    createRoutePath({
      id: "route-in",
      netId: "net-in",
      start: { kind: "terminal", instanceId: "P1", pinName: "P" },
      end: { kind: "terminal", instanceId: "R1", pinName: "P" },
      bends: [],
      modes: ["manual"],
    }),
  );
  child.drafting = {
    objects: [
      {
        id: "note-1",
        kind: "text",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 20, y: 30 } },
        content: { runs: [{ kind: "text", value: "note" }] },
        alignment: "start",
        rotation: 0,
      },
    ],
  };
  child.netlist = {
    name: "Child",
    formalParameters: [],
    terminals: [
      {
        id: "terminal-in",
        name: "IN",
        netId: "net-in",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
    ],
  };
  project.documents.push(child);
  project.documents[0]!.instances.push({
    id: "X1",
    symbolId: "hierarchical-child",
    placement: null,
    netlist: {
      reference: "X1",
      parameters: {},
      binding: { kind: "subcircuit", childDocumentId: child.id },
    },
  });
  return { project, child };
}

function applyPlan(
  document: ReturnType<typeof createEmptyDocument>,
  edits: ReturnType<typeof planCellReset>["edits"],
) {
  const history = new DocumentHistory(document);
  const result = history.transact({
    transactionId: "cell-reset",
    documentId: document.id,
    expectedRevision: document.revision,
    actor: { kind: "human", id: "test" },
    edits: [...edits],
  });
  expect(result.ok).toBe(true);
  return history;
}

describe("Cell reset lifecycle planner", () => {
  it("clears drawing geometry without deleting logical objects", () => {
    const { project, child } = fixture();
    const plan = planCellReset(project, child.id, "clear-drawing");
    expect(plan).toMatchObject({
      preconditionToken: "child:0",
      affectedObjectIds: ["claim-route", "note-1", "route-in"],
      rollback: { kind: "document-undo" },
      edits: [{ kind: "clear_cell_drawing" }],
    });

    const history = applyPlan(child, plan.edits);
    expect(history.document.routes).toEqual([]);
    expect(history.document.drafting?.objects).toEqual([]);
    expect(history.document.instances).toHaveLength(2);
    expect(history.document.nets[0]?.terminals).toHaveLength(2);
    expect(
      history.document.connectivityEvidence.some(
        (evidence) => evidence.id === "claim-route",
      ),
    ).toBe(false);

    const undone = history.transact({
      transactionId: "undo-reset",
      documentId: child.id,
      expectedRevision: history.document.revision,
      actor: { kind: "human", id: "test" },
      edits: [{ kind: "undo" }],
    });
    expect(undone.ok).toBe(true);
    expect(history.document.routes).toHaveLength(1);
  });

  it("returns placements to the tray while preserving devices and Nets", () => {
    const { project, child } = fixture();
    const plan = planCellReset(project, child.id, "reset-placement");
    const history = applyPlan(child, plan.edits);

    expect(history.document.instances).toHaveLength(2);
    expect(
      history.document.instances.every((item) => item.placement === null),
    ).toBe(true);
    expect(history.document.routes).toEqual([]);
    expect(history.document.nets[0]?.terminals).toHaveLength(2);
    expect(history.document.netlist?.terminals).toHaveLength(1);
    expect(
      history.document.connectivityEvidence.some(
        (evidence) => evidence.id === "claim-route",
      ),
    ).toBe(false);
  });

  it("resets a referenced Cell body while retaining its formal interface", () => {
    const { project, child } = fixture();
    const plan = planCellReset(project, child.id, "reset-body");
    expect(plan.diagnostics).toEqual([
      expect.objectContaining({ code: "CELL_CALLERS_PRESERVED" }),
    ]);
    expect(plan.affectedObjectIds).toEqual(
      expect.arrayContaining(["claim-body", "net-body"]),
    );

    const history = applyPlan(child, plan.edits);
    expect(history.document.instances.map((item) => item.id)).toEqual(["P1"]);
    expect(history.document.nets).toEqual([
      expect.objectContaining({
        id: "net-in",
        terminals: [{ instanceId: "P1", pinName: "P" }],
      }),
    ]);
    expect(history.document.netlist).toEqual(child.netlist);
    expect(history.document.routes).toEqual([]);
    expect(history.document.drafting?.objects).toEqual([]);
    expect(
      history.document.connectivityEvidence.map((item) => item.id),
    ).toEqual(["source-interface"]);
  });
});
