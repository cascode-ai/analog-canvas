import { describe, expect, it } from "vitest";

import type { CellNetlistInterface } from "./schema.js";
import { projectCellInterface } from "./cell-interface-projection.js";

describe("Cell interface projection", () => {
  it("groups declarations by folded name without changing authored facts", () => {
    const netlist: CellNetlistInterface = {
      name: "Stage",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-vin-a",
          name: "VIN",
          netId: "net-vin-a",
          direction: "input",
          interfaceInstanceIds: ["P1"],
        },
        {
          id: "terminal-out",
          name: "OUT",
          netId: "net-out",
          direction: "output",
          interfaceInstanceIds: ["P2"],
        },
        {
          id: "terminal-vin-b",
          name: "vin",
          netId: "net-vin-b",
          direction: "input",
          interfaceInstanceIds: ["P3"],
        },
      ],
    };
    const before = structuredClone(netlist);

    expect(projectCellInterface(netlist)).toEqual({
      ports: [
        {
          id: "terminal-vin-a",
          key: "vin",
          name: "VIN",
          direction: "input",
          terminalIds: ["terminal-vin-a", "terminal-vin-b"],
          netIds: ["net-vin-a", "net-vin-b"],
          interfaceInstanceIds: ["P1", "P3"],
        },
        {
          id: "terminal-out",
          key: "out",
          name: "OUT",
          direction: "output",
          terminalIds: ["terminal-out"],
          netIds: ["net-out"],
          interfaceInstanceIds: ["P2"],
        },
      ],
    });
    expect(netlist).toEqual(before);
  });

  it("reads a port of mixed directions as passive and reports nothing", () => {
    const netlist: CellNetlistInterface = {
      name: "Stage",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-a",
          name: "BUS",
          netId: "net-a",
          direction: "input",
          interfaceInstanceIds: ["P1"],
        },
        {
          id: "terminal-b",
          name: "bus",
          netId: "net-b",
          direction: "output",
          interfaceInstanceIds: ["P2"],
        },
      ],
    };

    expect(projectCellInterface(netlist)).toEqual({
      ports: [
        {
          id: "terminal-a",
          key: "bus",
          name: "BUS",
          direction: "passive",
          terminalIds: ["terminal-a", "terminal-b"],
          netIds: ["net-a", "net-b"],
          interfaceInstanceIds: ["P1", "P2"],
        },
      ],
    });
  });

  it("projects a missing netlist as an empty interface", () => {
    expect(projectCellInterface(undefined)).toEqual({ ports: [] });
  });
});
