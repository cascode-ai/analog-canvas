import { createEmptyProject, type CircuitProject } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { evaluateSubmissionGates } from "./submission-gates.js";

const dual = {
  schemaVersion: 1 as const,
  id: "dual",
  name: "Dual",
  viewBox: { x: -20, y: -20, width: 40, height: 40 },
  pins: [
    {
      name: "L",
      role: "passive",
      at: { x: -20, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "R",
      role: "passive",
      at: { x: 20, y: 0 },
      direction: "east" as const,
      presentation: { visibility: "visible" as const },
    },
  ],
  primitives: [
    { kind: "line" as const, from: { x: -10, y: 0 }, to: { x: 10, y: 0 } },
  ],
  variants: [],
};

const mos = {
  ...dual,
  id: "mos",
  name: "MOS",
  pins: [
    {
      name: "G",
      role: "gate",
      at: { x: -20, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "D",
      role: "drain",
      at: { x: 0, y: -20 },
      direction: "north" as const,
      presentation: { visibility: "visible" as const },
    },
    {
      name: "S",
      role: "source",
      at: { x: 0, y: 20 },
      direction: "south" as const,
      presentation: { visibility: "visible" as const },
    },
  ],
  variants: [],
};

const resolver = new InMemorySymbolResolver([dual, mos]);

function project(): CircuitProject {
  return createEmptyProject("gates", "Gates", "doc");
}

function dualInstance(id: string, reference?: string) {
  return {
    id,
    symbolId: "dual",
    placement: {
      position: { x: 0, y: 0 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    ...(reference ? { netlist: { reference, parameters: {} } } : {}),
  };
}

function gates(target: CircuitProject) {
  return evaluateSubmissionGates(target, resolver);
}

function failureCodes(target: CircuitProject): string[] {
  return gates(target).failures.map((failure) => failure.code);
}

describe("evaluateSubmissionGates", () => {
  it("passes a clean, fully wired two-instance schematic", () => {
    const target = project();
    const document = target.documents[0]!;
    document.instances = [dualInstance("I1", "R1"), dualInstance("I2", "R2")];
    document.nets = [
      {
        id: "n1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
      {
        id: "n2",

        terminals: [
          { instanceId: "I1", pinName: "R" },
          { instanceId: "I2", pinName: "R" },
        ],
      },
    ];
    expect(gates(target)).toEqual({ ok: true, failures: [] });
  });

  it("blocks floating pins with terminal examples, released by NoConnect", () => {
    const target = project();
    const document = target.documents[0]!;
    document.instances = [dualInstance("I1", "R1"), dualInstance("I2", "R2")];
    document.nets = [
      {
        id: "n1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
    ];
    const report = gates(target);
    expect(report.ok).toBe(false);
    const floating = report.failures.find(
      (failure) => failure.code === "floating-endpoints",
    );
    expect(floating?.count).toBe(2);
    expect(floating?.examples).toContain("I1.R");

    document.noConnects = [
      {
        id: "nc1",
        endpoint: { kind: "terminal", instanceId: "I1", pinName: "R" },
      },
      {
        id: "nc2",
        endpoint: { kind: "terminal", instanceId: "I2", pinName: "R" },
      },
    ];
    expect(gates(target).ok).toBe(true);
  });

  it("keeps a named singleton gate floating until it has a sanctioned boundary", () => {
    const target = project();
    const document = target.documents[0]!;
    document.instances = [
      { ...dualInstance("M1", "M1"), symbolId: "mos" },
      { ...dualInstance("M2", "M2"), symbolId: "mos" },
    ];
    document.nets = [
      {
        id: "channel",

        terminals: [
          { instanceId: "M1", pinName: "D" },
          { instanceId: "M1", pinName: "S" },
          { instanceId: "M2", pinName: "G" },
          { instanceId: "M2", pinName: "D" },
          { instanceId: "M2", pinName: "S" },
        ],
      },
      {
        id: "gate-net",

        terminals: [{ instanceId: "M1", pinName: "G" }],
      },
    ];
    expect(failureCodes(target)).toEqual(["floating-endpoints"]);

    document.connectivityEvidence.push({
      id: "claim-clk",
      kind: "name-claim",
      netId: "gate-net",
      name: "CLK",
      scope: "local",
      owner: { kind: "net-label", annotationId: "test-net-label-1" },
    });
    expect(failureCodes(target)).toEqual(["floating-endpoints"]);
  });

  it("reports ERC errors such as duplicate instance names", () => {
    const target = project();
    const document = target.documents[0]!;
    document.instances = [dualInstance("I1", "X1"), dualInstance("I2", "X1")];
    document.nets = [
      {
        id: "n1",

        terminals: [
          { instanceId: "I1", pinName: "L" },
          { instanceId: "I2", pinName: "L" },
        ],
      },
      {
        id: "n2",

        terminals: [
          { instanceId: "I1", pinName: "R" },
          { instanceId: "I2", pinName: "R" },
        ],
      },
    ];
    const report = gates(target);
    expect(report.ok).toBe(false);
    expect(report.failures.map((failure) => failure.code)).toEqual([
      "erc-errors",
    ]);
    expect(report.failures[0]?.examples[0]).toContain(
      "ERC_DUPLICATE_INSTANCE_NAME",
    );
  });

  it("blocks near-empty projects but accepts a substantial block diagram", () => {
    const empty = project();
    expect(failureCodes(empty)).toEqual(["empty-project"]);

    const diagram = project();
    diagram.documents[0]!.drafting = {
      objects: [
        { kind: "text" },
        { kind: "rectangle" },
        { kind: "arrow" },
      ] as never,
    } as never;
    expect(gates(diagram).ok).toBe(true);
  });
});
