import { describe, expect, it } from "vitest";

import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { hierarchicalSymbolId } from "@icm/symbols";

import { summarizeProjectCells } from "./cell-summary.js";

describe("Cell summary", () => {
  it("reports ports and every concrete caller without changing the Project", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("child", "Stage");
    child.netlist!.terminals.push({
      id: "terminal-in",
      name: "IN",
      netId: "net-in",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });
    child.netlist!.terminals.push({
      id: "terminal-in-elsewhere",
      name: "in",
      netId: "net-in-elsewhere",
      direction: "input",
      interfaceInstanceIds: ["P2"],
    });
    project.documents.push(child);
    for (const id of ["X1", "X2"]) {
      project.documents[0]!.instances.push({
        id,
        symbolId: hierarchicalSymbolId("Stage"),
        placement: null,
        netlist: {
          reference: id,
          parameters: {},
          binding: {
            kind: "subcircuit",
            childDocumentId: child.id,
          },
        },
      });
    }

    expect(summarizeProjectCells(project)).toEqual([
      expect.objectContaining({
        id: "document-main",
        isTop: true,
        callers: [],
      }),
      expect.objectContaining({
        id: "child",
        portCount: 2,
        callers: [
          expect.objectContaining({ instanceId: "X1" }),
          expect.objectContaining({ instanceId: "X2" }),
        ],
      }),
    ]);
  });
});
