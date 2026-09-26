import { createEmptyProject, createRoutePath } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { planCellSelectionDeletion } from "./cell-selection-deletion.js";
import { planRemoveCellTerminals } from "./hierarchy-planner.js";
import { executeProjectTransaction } from "./project-transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** A three-segment VDD Rail whose far-end label is the Cell's VDD Pin. */
function railWithVddPin() {
  const project = createEmptyProject("rail", "Rail");
  const document = project.documents[0]!;
  document.nets.push({ id: "net-vdd", terminals: [] });
  document.junctions.push(
    { id: "rail-0", netId: "net-vdd", position: { x: 0, y: 0 } },
    { id: "rail-1", netId: "net-vdd", position: { x: 100, y: 0 } },
    { id: "rail-2", netId: "net-vdd", position: { x: 200, y: 0 } },
    { id: "rail-3", netId: "net-vdd", position: { x: 300, y: 0 } },
  );
  for (const [id, start, end] of [
    ["rail-a", "rail-0", "rail-1"],
    ["rail-b", "rail-1", "rail-2"],
    ["rail-c", "rail-2", "rail-3"],
  ] as const) {
    document.routes.push(
      createRoutePath({
        id,
        netId: "net-vdd",
        start: { kind: "junction", junctionId: start },
        end: { kind: "junction", junctionId: end },
        bends: [],
        modes: ["manual"],
        presentation: "power-rail",
      }),
    );
  }
  document.netlist!.terminals.push({
    id: "terminal-vdd",
    name: "VDD",
    netId: "net-vdd",
    direction: "inout",
    interfaceInstanceIds: [],
    interfaceAnnotationId: "label-vdd",
  });
  document.annotations.push({
    id: "label-vdd",
    kind: "power-label",
    binding: { kind: "cell-terminal-name", terminalId: "terminal-vdd" },
    netId: "net-vdd",
    anchor: {
      kind: "object",
      objectId: "rail-3",
      localOffset: { x: 10, y: 10 },
      fallbackPosition: { x: 310, y: 10 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.connectivityEvidence.push({
    id: "claim-vdd",
    kind: "name-claim",
    netId: "net-vdd",
    name: "VDD",
    owner: { kind: "power-marker", objectId: "label-vdd" },
    scope: "local",
    powerDomain: "vdd",
  });
  return project;
}

describe("Cell selection deletion", () => {
  // Only rail-c touches the junction the label sits on; any segment deletes
  // the whole rail, so every one of them owns the Pin its label is.
  it.each(["rail-a", "rail-b", "rail-c"])(
    "deleting Power Rail segment %s takes the VDD Pin along",
    (routeId) => {
      const project = railWithVddPin();
      const document = project.documents[0]!;
      const { routing, terminalIds } = planCellSelectionDeletion(
        document,
        resolver,
        { instanceIds: [], routeIds: [routeId], junctionIds: [] },
        1,
      );
      expect(terminalIds).toEqual(["terminal-vdd"]);

      const result = executeProjectTransaction(project, {
        transactionId: "delete-rail",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: planRemoveCellTerminals(project, document.id, terminalIds, [
          ...routing.edits,
        ]),
      });
      if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
      const after = result.project.documents[0]!;
      expect(after.routes).toEqual([]);
      expect(after.annotations).toEqual([]);
      expect(after.netlist?.terminals).toEqual([]);
      expect(after.connectivityEvidence).toEqual([]);
    },
  );
});
