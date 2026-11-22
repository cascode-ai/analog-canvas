import { describe, expect, it } from "vitest";

import { CircuitIRSchema } from "./ir.js";

const span = {
  fileId: "source-main",
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 20, line: 1, column: 21 },
};

const minimalIr = {
  dialect: "ngspice",
  topCells: ["top"],
  cells: [
    {
      id: "cell-top",
      name: "top",
      ports: [{ name: "in", position: 0, netId: "net-in", sourceRef: span }],
      nets: [{ id: "net-in", name: "in", scope: "local" as const }],
      instances: [],
      parameters: [],
      sourceRef: span,
    },
  ],
  parameters: [],
  models: [],
  preservedStatements: [],
  unresolvedStatements: [
    { kind: "opaque" as const, rawText: ".vendor foo", sourceRef: span },
  ],
};

describe("transient Circuit IR", () => {
  it("rejects renderer placement leaking into the import boundary", () => {
    expect(
      CircuitIRSchema.safeParse({
        ...minimalIr,
        cells: [{ ...minimalIr.cells[0], placement: { x: 10, y: 20 } }],
      }).success,
    ).toBe(false);
  });
});
