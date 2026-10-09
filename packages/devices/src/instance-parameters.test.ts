import { describe, expect, it } from "vitest";
import { createEmptyProject, createEmptyDocument } from "@icm/model";

import { instanceParameterContract } from "./instance-parameters.js";
import {
  canonicalParameterValues,
  validateDeviceParameters,
} from "./parameter-validation.js";

const definitions = [
  {
    id: "def-res",
    name: "sky130_fd_pr__res_high_po",
    terminals: ["R0", "R1", "B"].map((name) => ({ name })),
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
      // Only the single-ended op-amp has output limits (#1463).
      expect(contract?.definitions).toMatchObject([
        { name: "gain", defaultValue: "1e6" },
        ...(symbolId === "opamp-differential"
          ? []
          : [
              { name: "vhigh", defaultValue: "VDD" },
              { name: "vlow", defaultValue: "VSS" },
            ]),
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
  it("gives the adder a + or - choice per input, both + by default", () => {
    const contract = instanceParameterContract({}, { symbolId: "adder" });
    expect(contract?.definitions).toMatchObject([
      { name: "signA", editor: "select", defaultValue: "+" },
      { name: "signB", editor: "select", defaultValue: "+" },
    ]);
    expect(
      contract?.definitions[1]?.options?.map((option) => option.value),
    ).toEqual(["+", "-"]);
    // The choice is checked as the GUI and an Agent check it.
    const check = (parameters: Record<string, string>) =>
      validateDeviceParameters(
        { parameters: contract!.definitions },
        parameters,
        { open: contract!.open },
      );
    expect(check({ signA: "+", signB: "-" })).toEqual([]);
    // #1324 spells the minus as U+2212: it is taken, and stored as -.
    expect(check({ signB: "−" })).toEqual([]);
    expect(
      canonicalParameterValues(
        { parameters: contract!.definitions },
        { signA: "+", SIGNB: "−" },
      ),
    ).toEqual({ signA: "+", SIGNB: "-" });
    // Anything else is still refused, an en dash too, with the choices named.
    for (const value of ["minus", "–", "+-"])
      expect(check({ signB: value }), value).toMatchObject([
        { kind: "select", name: "signB", value, allowed: ["+", "-"] },
      ]);
  });

  it("takes VDD or a number as the ideal comparator's high level (#1306)", () => {
    const contract = instanceParameterContract(
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
    );
    const check = (parameters: Record<string, string>) =>
      validateDeviceParameters(
        { parameters: contract!.definitions },
        parameters,
        { open: contract!.open },
      );
    for (const vhigh of ["VDD", "vdd", " Vdd ", "3.3", "1"])
      expect(check({ vhigh }), vhigh).toEqual([]);
    // VDD is stored as typed.
    expect(
      canonicalParameterValues(
        { parameters: contract!.definitions },
        { vhigh: "vdd" },
      ),
    ).toEqual({ vhigh: "vdd" });
    // Anything else is refused, with what it takes named. Export checks the
    // levels are numbers, so an expression in braces is refused as well, and
    // vlow stays a number.
    for (const vhigh of ["VSS", "VDD2", "{vdd/2}"])
      expect(check({ vhigh }), vhigh).toEqual([
        {
          kind: "number",
          name: "vhigh",
          value: vhigh,
          keywords: ["VDD"],
          expressions: false,
        },
      ]);
    expect(check({ vlow: "VDD" })).toEqual([
      { kind: "number", name: "vlow", value: "VDD", expressions: false },
    ]);
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
