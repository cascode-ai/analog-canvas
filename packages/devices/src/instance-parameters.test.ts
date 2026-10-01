import { describe, expect, it } from "vitest";

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
    ).toEqual([["value"], true]);
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
