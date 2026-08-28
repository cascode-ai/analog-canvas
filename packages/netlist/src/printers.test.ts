import { readFileSync } from "node:fs";

import { parseSpiceSource } from "@icm/spice";
import { describe, expect, it } from "vitest";

import type { DesignNetlistIR, DesignNetlistInstance } from "./ir.js";
import {
  printDesignNetlist,
  printSpectreNetlist,
  printSpiceNetlist,
} from "./printers.js";

function device(
  id: string,
  reference: string,
  deviceClass: DesignNetlistInstance["deviceClass"],
  nodeNames: string[],
  target: string | null,
  parameters: Array<[string, string]>,
): DesignNetlistInstance {
  return {
    id,
    reference,
    deviceClass,
    target,
    nodes: nodeNames.map((netName, index) => ({
      pinName: `p${index + 1}`,
      netName,
    })),
    parameters: parameters.map(([name, rawValue]) => ({ name, rawValue })),
  };
}

function structuralIr(): DesignNetlistIR {
  return {
    topCellId: "top",
    globals: ["0", "VDD"],
    cells: [
      {
        id: "leaf",
        name: "leaf",
        ports: ["d", "g", "s", "b"].map((name) => ({
          id: `leaf-${name}`,
          name,
          netName: name,
        })),
        nets: [],
        formalParameters: [{ name: "scale", defaultValue: "1" }],
        instances: [
          device("m1", "M1", "mos", ["d", "g", "s", "b"], "nch", [
            ["l", "60n"],
            ["w", "2u"],
          ]),
        ],
      },
      {
        id: "top",
        name: "top",
        ports: ["vin", "vout"].map((name) => ({
          id: `top-${name}`,
          name,
          netName: name,
        })),
        nets: [],
        instances: [
          device("c1", "C1", "capacitor", ["vin", "vout"], null, [
            ["value", "2p"],
          ]),
          device("d1", "D1", "diode", ["vout", "0"], "dmod", [["area", "2"]]),
          device("i1", "I1", "current-source", ["VDD", "0"], null, [
            ["dc", "10u"],
          ]),
          device("l1", "L1", "inductor", ["vout", "0"], null, [
            ["value", "3n"],
          ]),
          device("q1", "Q1", "bjt", ["vout", "vin", "0"], "npnmod", []),
          device("r1", "R1", "resistor", ["vin", "vout"], null, [
            ["temp", "27"],
            ["value", "10k"],
          ]),
          device("v1", "V1", "voltage-source", ["vin", "0"], null, [
            ["dc", "1.2"],
          ]),
          device(
            "x1",
            "X1",
            "hierarchical",
            ["vout", "vin", "0", "0"],
            "leaf",
            [["scale", "2"]],
          ),
        ],
      },
    ],
  };
}

function fixture(name: string): string {
  return readFileSync(
    new URL(`./__fixtures__/${name}`, import.meta.url),
    "utf8",
  );
}

describe("design netlist printers", () => {
  it("prints stable SPICE structural output accepted by the SPICE parser", () => {
    const text = printSpiceNetlist(structuralIr());
    expect(text).toBe(fixture("structural.spi"));
    expect(printSpiceNetlist(structuralIr())).toBe(text);
    const syntax = parseSpiceSource({
      id: "generated",
      path: "structural.spi",
      hash: "sha256:test",
      encoding: "utf-8",
      text,
    });
    expect(
      syntax.statements.some((statement) => statement.kind === "opaque"),
    ).toBe(false);
    expect(
      syntax.statements.find((statement) => statement.kind === "subckt_start"),
    ).toMatchObject({
      name: "leaf",
      parameters: [{ name: "scale", rawText: "1" }],
    });
    expect(text).not.toMatch(/^\.(?:include|lib|tran|ac|dc|end)\b/imu);
  });

  it("prints stable Spectre structural output without deck directives", () => {
    const text = printSpectreNetlist(structuralIr());
    expect(text).toBe(fixture("structural.scs"));
    expect(printSpectreNetlist(structuralIr())).toBe(text);
    expect(text).not.toMatch(/^\s*(?:include|section|save|tran|ac|dc)\b/imu);
  });

  it("returns explicit browser file metadata", () => {
    expect(printDesignNetlist("spice", structuralIr())).toMatchObject({
      extension: ".spi",
      mediaType: "application/x-spice",
    });
    expect(printDesignNetlist("spectre", structuralIr())).toMatchObject({
      extension: ".scs",
      mediaType: "application/x-spectre",
    });
  });

  it("prints Digital Clock compatibility fields in both supported dialects", () => {
    const ir = structuralIr();
    ir.cells[1]!.instances.push(
      device("vclock", "VCLOCK", "voltage-source", ["vin", "0"], null, [
        ["low", "0"],
        ["high", "1"],
        ["delay", "1ns"],
        ["rise", "1ps"],
        ["fall", "1ps"],
        ["width", "5ns"],
        ["period", "10ns"],
        ["dutyCycle", "50"],
        ["initial", "0"],
      ]),
    );

    expect(printSpiceNetlist(ir)).toContain(
      "VCLOCK vin 0 PULSE(0 1 1ns 1ps 1ps 5ns 10ns)",
    );
    expect(printSpectreNetlist(ir)).toContain(
      "VCLOCK (vin 0) vsource type=pulse val0=0 val1=1 delay=1ns rise=1ps fall=1ps width=5ns period=10ns",
    );
    expect(printSpiceNetlist(ir)).not.toContain("dutyCycle=");
    expect(printSpectreNetlist(ir)).not.toContain("initial=");
  });

  it("prints a voltage-controlled switch as its four-node S card", () => {
    const ir = structuralIr();
    ir.cells[1]!.instances.push(
      device("s1", "S1", "switch", ["vout", "0", "vctrl", "0"], "SW_RLY", []),
    );

    // The card a simulator reads: two switched nodes, two control nodes, then
    // the model. Node order is the descriptor's pin order, so nothing is
    // reordered on the way out.
    expect(printSpiceNetlist(ir)).toContain("S1 vout 0 vctrl 0 SW_RLY");
    expect(printSpectreNetlist(ir)).toContain("S1 (vout 0 vctrl 0) SW_RLY");
  });

  it("wraps long SPICE instance records with continuation lines", () => {
    const ir = structuralIr();
    ir.cells[1]!.instances[0]!.parameters = Array.from(
      { length: 12 },
      (_, index) => ({ name: `parameter_${index}`, rawValue: "1234567890" }),
    );
    ir.cells[1]!.instances[0]!.parameters.push({
      name: "value",
      rawValue: "2p",
    });
    expect(printSpiceNetlist(ir)).toContain("\n+ parameter_");
  });
});
