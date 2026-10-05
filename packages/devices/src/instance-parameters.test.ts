import { describe, expect, it } from "vitest";
import { createEmptyProject, createEmptyDocument } from "@icm/model";

import { instanceParameterContract } from "./instance-parameters.js";

const definitions = [
  {
    id: "def-res",
    name: "sky130_fd_pr__res_high_po",
    terminals: ["R0", "R1", "B"].map((name) => ({ name })),
    formalParameters: [],
  },
  {
    id: "def-own",
    name: "my_trim",
    terminals: ["A", "B"].map((name) => ({ name })),
    formalParameters: [],
  },
] as never;

const names = (
  contract: ReturnType<typeof instanceParameterContract>,
): [string[], boolean] | undefined =>
  contract && [contract.definitions.map((p) => p.name), contract.open];

describe("instanceParameterContract", () => {
  it("shares external and child formal defaults while keeping their parameter namespaces open", () => {
    const project = createEmptyProject("p", "Authored models", "root");
    const child = createEmptyDocument("child", "Child");
    child.netlist!.formalParameters = [{ name: "GAIN", defaultValue: "17" }];
    project.documents.push(child);
    project.externalSubcircuitDefinitions.push({
      id: "custom",
      name: "custom_amp",
      terminals: [],
      formalParameters: [{ name: "strength", defaultValue: "2" }],
      interfaceStatus: "declared",
    });
    for (const [binding, expected] of [
      [
        { kind: "subcircuit", childDocumentId: "child" },
        { name: "GAIN", defaultValue: "17" },
      ],
      [
        { kind: "external-subcircuit", definitionId: "custom" },
        { name: "strength", defaultValue: "2" },
      ],
    ] as const) {
      const contract = instanceParameterContract(project, {
        symbolId: "opamp",
        netlist: { binding },
      });
      expect(contract?.definitions).toMatchObject([expected]);
      expect(contract?.open).toBe(true);
      expect(contract?.model).toBeUndefined();
    }
  });
  it("shares model defaults across amplifier variants without closing custom arguments", () => {
    for (const symbolId of ["opamp", "opamp-wide", "opamp-differential"]) {
      const contract = instanceParameterContract({}, { symbolId });
      expect(contract?.definitions).toMatchObject([
        { name: "gain", defaultValue: "1e6" },
      ]);
      expect(contract?.open).toBe(true);
    }
  });

  it("describes the effective target, not the artwork of an externally retargeted block", () => {
    expect(
      names(
        instanceParameterContract(
          {},
          {
            symbolId: "opamp",
            netlist: {
              binding: {
                kind: "unresolved-subcircuit",
                name: "custom_amplifier",
              },
            },
          },
        ),
      ),
    ).toEqual([[], true]);
    expect(
      names(
        instanceParameterContract(
          {},
          {
            symbolId: "comparator",
            netlist: {
              binding: {
                kind: "unresolved-subcircuit",
                name: "icm_ideal_comparator",
              },
            },
          },
        ),
      ),
    ).toEqual([["vhigh", "vlow", "vtransition"], false]);
    expect(
      names(instanceParameterContract({}, { symbolId: "d-flip-flop-q" })),
    ).toEqual([["vt", "td"], true]);
  });
  it("gives a built-in part its descriptor", () => {
    expect(
      names(instanceParameterContract({}, { symbolId: "resistor" })),
    ).toEqual([["value"], false]);
  });

  it("gives a part bound to a reviewed SKY130 model that model's parameters", () => {
    expect(
      names(
        instanceParameterContract(
          { externalSubcircuitDefinitions: definitions },
          {
            symbolId: "resistor",
            netlist: {
              binding: { kind: "external-subcircuit", definitionId: "def-res" },
            },
          },
        ),
      ),
    ).toEqual([["w", "l", "mult"], false]);
  });

  it("leaves an unreviewed external subcircuit's names open", () => {
    expect(
      names(
        instanceParameterContract(
          { externalSubcircuitDefinitions: definitions },
          {
            symbolId: "resistor",
            netlist: {
              binding: { kind: "external-subcircuit", definitionId: "def-own" },
            },
          },
        ),
      ),
    ).toEqual([[], true]);
  });

  it("leaves a Cell call open and knows nothing of a symbol outside the registry", () => {
    expect(
      names(
        instanceParameterContract(
          {},
          {
            symbolId: "resistor",
            netlist: { binding: { kind: "subcircuit", definitionId: "x" } },
          },
        ),
      )?.[1],
    ).toBe(true);
    expect(
      instanceParameterContract({}, { symbolId: "no-such-symbol" }),
    ).toBeUndefined();
  });
});
