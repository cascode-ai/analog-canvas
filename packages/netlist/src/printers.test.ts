import { readFileSync } from "node:fs";

import { parseSpiceSource } from "@icm/spice";
import { describe, expect, it } from "vitest";

import type { DesignNetlistIR, DesignNetlistInstance } from "./ir.js";
import {
  printDesignNetlist,
  printDesignNetlistWithLocations,
  printSpectreNetlist,
  printSpiceNetlist,
  printSpiceWithLocations,
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
    invocationKind: deviceClass === "hierarchical" ? "subcircuit" : "primitive",
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
  it("preserves authored assignment values and the existing first/last scalar lookup rules", () => {
    const ir = structuralIr();
    ir.cells[1]!.instances = [
      device("r", "R1", "resistor", ["a", "0"], null, [
        ["value", "1"],
        ["VALUE", "2"],
        ["extra", "3"],
        ["EXTRA", "4"],
      ]),
      device("v", "V1", "voltage-source", ["a", "0"], null, [
        ["dc", "1"],
        ["DC", "2"],
        ["extra", "3"],
        ["EXTRA", "4"],
      ]),
    ];
    expect(printSpiceNetlist(ir)).toContain("R1 a 0 1 extra=3 EXTRA=4");
    expect(printSpiceNetlist(ir)).toContain("V1 a 0 DC 2 extra=3 EXTRA=4");
    expect(printSpectreNetlist(ir)).toContain(
      "R1 (a 0) resistor r=1 extra=3 EXTRA=4",
    );
    expect(printSpectreNetlist(ir)).toContain(
      "V1 (a 0) vsource dc=2 extra=3 EXTRA=4",
    );
  });
  it.each(["spice", "spectre"] as const)(
    "keeps field ownership when nodes, masters and wrapped values look identical (%s)",
    (format) => {
      const ir = structuralIr();
      const instance = ir.cells[0]!.instances[0]!;
      instance.reference = "M_SAME";
      instance.target = "SAME";
      instance.nodes.forEach((node) => (node.netName = "SAME"));
      instance.parameters = Array.from({ length: 12 }, (_, index) => ({
        name: `parameter_${index}`,
        rawValue: "SAME",
      }));
      instance.parameters.push({ name: "expression", rawValue: "{α + β}" });
      const { file, locations } = printDesignNetlistWithLocations(format, ir);
      expect(file).toEqual(printDesignNetlist(format, ir));
      const fields = locations.fields.filter((f) => f.instanceId === "m1");
      expect(
        fields.map((f) => [f.kind, f.parameter ?? null, f.rawValue]),
      ).toEqual([
        ["reference", null, "M_SAME"],
        ["target", null, "SAME"],
        ...instance.parameters.map((p) => ["parameter", p.name, p.rawValue]),
      ]);
      for (const field of locations.fields)
        expect(file.text.slice(field.startOffset, field.endOffset)).toBe(
          field.rawValue,
        );
      const card = locations.instances.find(
        (span) => span.instanceId === "m1",
      )!;
      expect(file.text.slice(card.startOffset, card.endOffset)).toMatch(
        /^M_SAME /u,
      );
      if (format === "spice") {
        expect(file.text.slice(card.startOffset, card.endOffset)).toContain(
          "\n+ ",
        );
        // Public Circuit parameter locations retain authored order, independently
        // of the print order of value-first primitive cards.
        const circuit = printSpiceWithLocations(ir, true);
        expect(
          circuit.parameters
            .filter((p) => p.instanceId === "r1")
            .map((p) => p.parameter),
        ).toEqual(["temp", "value"]);
      }
    },
  );

  it.each(["spice", "spectre"] as const)(
    "maps only reversible waveform and signed gain fields (%s)",
    (format) => {
      const ir = structuralIr();
      const root = ir.cells[1]!;
      root.instances = [
        device("pulse", "VP", "voltage-source", ["1", "0"], null, [
          ["waveform", "pulse"],
          ["low", "0"],
          ["high", "1"],
          ["delay", "1"],
          ["rise", "1"],
          ["fall", "1"],
          ["width", "1"],
          ["period", "1"],
          ["acMagnitude", " 1 "],
        ]),
        device("sin", "VS", "voltage-source", ["0", "0"], null, [
          ["waveform", "sin"],
          ["offset", "0"],
          ["amplitude", "1"],
          ["frequency", "1"],
        ]),
        device("pwl", "VW", "voltage-source", ["0", "0"], null, [
          ["waveform", "pwl"],
          ["pwlPoints", "0 0, 1 1"],
        ]),
        {
          ...device("gain", "F1", "cccs", ["0", "0"], null, [["gain", "2"]]),
          controlSourceReference: "VS",
          controlCurrentSign: -1,
        },
        {
          ...device("braced", "F2", "cccs", ["0", "0"], null, [
            ["gain", "{g + 1}"],
          ]),
          controlSourceReference: "VS",
          controlCurrentSign: -1,
        },
      ];
      const { file, locations } = printDesignNetlistWithLocations(format, ir);
      expect(file).toEqual(printDesignNetlist(format, ir));
      const parameters = (id: string) =>
        locations.fields
          .filter((f) => f.instanceId === id && f.kind === "parameter")
          .map((f) => f.parameter);
      expect(parameters("pulse")).toEqual([
        "low",
        "high",
        "delay",
        "rise",
        "fall",
        "width",
        "period",
      ]);
      expect(parameters("sin")).toEqual(["offset", "amplitude", "frequency"]);
      expect(parameters("pwl")).toEqual([]);
      expect(parameters("gain")).toEqual(["gain"]);
      expect(parameters("braced")).toEqual([]);
      for (const field of locations.fields)
        expect(file.text.slice(field.startOffset, field.endOffset)).toBe(
          field.rawValue,
        );
    },
  );

  it.each(["spice", "spectre"] as const)(
    "keeps compiler-owned model names protected and authored model names editable (%s)",
    (format) => {
      const ir = structuralIr();
      const cell = ir.cells[1]!;
      cell.models = [
        { name: "OWN", type: "D", parameters: [] },
        { name: "AUTHORED", type: "D", parameters: [], authoredName: true },
      ];
      cell.instances = [
        device("own", "D1", "diode", ["a", "0"], "OWN", []),
        device("authored", "D2", "diode", ["a", "0"], "AUTHORED", []),
      ];
      const { file, locations } = printDesignNetlistWithLocations(format, ir);
      expect(file).toEqual(printDesignNetlist(format, ir));
      expect(
        locations.fields
          .filter((f) => f.kind === "target")
          .map((f) => f.instanceId),
      ).toEqual(["m1", "authored"]);
      expect(
        locations.instances
          .filter((f) => f.documentId === "top")
          .map((f) => f.instanceId),
      ).toEqual(["own", "authored"]);
    },
  );

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
        ["waveform", "pulse"],
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

  it("prints formal PULSE and SIN waveforms for voltage and current sources", () => {
    const ir = structuralIr();
    ir.cells[1]!.instances.push(
      device("vp", "VP", "voltage-source", ["vin", "0"], null, [
        ["dc", "0"],
        ["acMagnitude", "1"],
        ["waveform", "pulse"],
        ["low", "0"],
        ["high", "1.8"],
        ["delay", "1ns"],
        ["rise", "2ps"],
        ["fall", "3ps"],
        ["width", "4ns"],
        ["period", "8ns"],
      ]),
      device("ip", "IP", "current-source", ["vout", "0"], null, [
        ["dc", "1u"],
        ["waveform", "pulse"],
        ["low", "0"],
        ["high", "10u"],
        ["delay", "2ns"],
        ["rise", "1ps"],
        ["fall", "1ps"],
        ["width", "3ns"],
        ["period", "6ns"],
      ]),
      device("vs", "VS", "voltage-source", ["vin", "0"], null, [
        ["dc", "0.9"],
        ["waveform", "sin"],
        ["offset", "0.9"],
        ["amplitude", "10m"],
        ["frequency", "1Meg"],
      ]),
      device("is", "IS", "current-source", ["vout", "0"], null, [
        ["dc", "2u"],
        ["waveform", "sin"],
        ["offset", "2u"],
        ["amplitude", "500n"],
        ["frequency", "10k"],
        ["delay", "1us"],
        ["damping", "2"],
        ["phase", "90"],
      ]),
    );

    const spice = printSpiceNetlist(ir);
    expect(spice).toContain(
      "VP vin 0 DC 0 AC 1 0 PULSE(0 1.8 1ns 2ps 3ps 4ns 8ns)",
    );
    expect(spice).toContain("IP vout 0 DC 1u PULSE(0 10u 2ns 1ps 1ps 3ns 6ns)");
    expect(spice).toContain("VS vin 0 DC 0.9 SIN(0.9 10m 1Meg 0 0 0)");
    expect(spice).toContain("IS vout 0 DC 2u SIN(2u 500n 10k 1us 2 90)");

    const spectre = printSpectreNetlist(ir);
    expect(spectre).toContain(
      "VP (vin 0) vsource type=pulse val0=0 val1=1.8 delay=1ns rise=2ps fall=3ps width=4ns period=8ns dc=0 mag=1 phase=0",
    );
    expect(spectre).toContain(
      "IP (vout 0) isource type=pulse val0=0 val1=10u delay=2ns rise=1ps fall=1ps width=3ns period=6ns dc=1u",
    );
    expect(spectre).toContain(
      "VS (vin 0) vsource type=sine dc=0.9 ampl=10m freq=1Meg delay=0 damp=0 sinephase=0",
    );
    expect(spectre).toContain(
      "IS (vout 0) isource type=sine dc=2u ampl=500n freq=10k delay=1us damp=2 sinephase=90",
    );
  });

  it("prints one canonical PWL waveform in SPICE and Spectre", () => {
    const ir = structuralIr();
    ir.cells[1]!.instances.push(
      device("vpwl", "VPWL", "voltage-source", ["vin", "0"], null, [
        ["dc", "0"],
        ["waveform", "pwl"],
        ["pwlPoints", "0s 0, 1ns 0, 2ns 1.8"],
      ]),
    );
    expect(printSpiceNetlist(ir)).toContain(
      "VPWL vin 0 DC 0 PWL(0s 0 1ns 0 2ns 1.8)",
    );
    expect(printSpectreNetlist(ir)).toContain(
      "VPWL (vin 0) vsource type=pwl wave=[0s 0 1ns 0 2ns 1.8] dc=0",
    );
  });

  it("does not infer PULSE from a period parameter", () => {
    const ir = structuralIr();
    ir.cells[1]!.instances.push(
      device("vdc", "VDC", "voltage-source", ["vin", "0"], null, [
        ["dc", "1"],
        ["waveform", "dc"],
        ["period", "10ns"],
      ]),
    );
    expect(printSpiceNetlist(ir)).toContain("\nVDC vin 0 DC 1\n");
    expect(printSpiceNetlist(ir)).not.toContain("VDC vin 0 PULSE");
  });

  it("prints only the selected waveform when inactive source fields remain stored", () => {
    const ir = structuralIr();
    ir.cells[1]!.instances.push(
      device("vselected", "VSELECTED", "voltage-source", ["vin", "0"], null, [
        ["dc", "0"],
        ["waveform", "sin"],
        ["low", "0"],
        ["high", "1.8"],
        ["rise", "1ps"],
        ["fall", "1ps"],
        ["width", "5ns"],
        ["period", "10ns"],
        ["offset", "0.9"],
        ["amplitude", "10m"],
        ["frequency", "1Meg"],
      ]),
    );

    const spice = printSpiceNetlist(ir);
    expect(spice).toContain("VSELECTED vin 0 DC 0 SIN(0.9 10m 1Meg 0 0 0)");
    expect(spice).not.toContain("VSELECTED vin 0 PULSE");

    const spectre = printSpectreNetlist(ir);
    expect(spectre).toContain(
      "VSELECTED (vin 0) vsource type=sine dc=0.9 ampl=10m freq=1Meg delay=0 damp=0 sinephase=0",
    );
    expect(spectre).not.toContain("VSELECTED (vin 0) vsource type=pulse");
  });

  it("prints an independent source's AC magnitude and phase after its DC value", () => {
    const ir = structuralIr();
    // The extractor sorts parameters by name, so `acMagnitude` precedes `dc`
    // in the IR; the card order is the printer's, not the author's.
    ir.cells[1]!.instances.push(
      device("vin", "VIN", "voltage-source", ["vin", "0"], null, [
        ["acMagnitude", "1"],
        ["dc", "0.9"],
      ]),
      device("iac", "IAC", "current-source", ["vout", "0"], null, [
        ["acMagnitude", "1u"],
        ["acPhase", "-90"],
        ["dc", "0"],
      ]),
    );

    const spice = printSpiceNetlist(ir);
    expect(spice).toContain("\nVIN vin 0 DC 0.9 AC 1 0\n");
    expect(spice).toContain("\nIAC vout 0 DC 0 AC 1u -90\n");
    expect(spice).not.toContain("acMagnitude=");
    expect(spice).not.toContain("acPhase=");
    const spectre = printSpectreNetlist(ir);
    expect(spectre).toContain("\nVIN (vin 0) vsource dc=0.9 mag=1 phase=0\n");
    expect(spectre).toContain("\nIAC (vout 0) isource dc=0 mag=1u phase=-90\n");
    expect(spectre).not.toContain("acMagnitude=");
    // The DC-only sources beside them print exactly as they always have.
    expect(spice).toContain("\nV1 vin 0 DC 1.2\n");
    expect(spice).toContain("\nI1 VDD 0 DC 10u\n");
    expect(spectre).toContain("\nV1 (vin 0) vsource dc=1.2\n");
    expect(spectre).toContain("\nI1 (VDD 0) isource dc=10u\n");
  });

  it("does not print an AC phase that has no magnitude to accompany", () => {
    const ir = structuralIr();
    ir.cells[1]!.instances.push(
      device("vphase", "VPHASE", "voltage-source", ["vin", "0"], null, [
        ["acPhase", "45"],
        ["dc", "1"],
        ["temp", "27"],
      ]),
    );

    expect(printSpiceNetlist(ir)).toContain("\nVPHASE vin 0 DC 1 temp=27\n");
    expect(printSpectreNetlist(ir)).toContain(
      "\nVPHASE (vin 0) vsource dc=1 temp=27\n",
    );
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
  it("preserves root Cell defaults when emitting an executable top-level circuit", () => {
    const ir = structuralIr();
    const root = ir.cells.find((cell) => cell.id === ir.topCellId)!;
    root.formalParameters = [
      { name: "RVAL", defaultValue: "1k" },
      { name: "RDOUBLE", defaultValue: "{RVAL * 2}" },
    ];
    const printed = printSpiceWithLocations(ir, true);
    expect(printed.text).toContain(".param RVAL=1k RDOUBLE={RVAL * 2}");
    expect(printed.text).not.toContain(`.subckt ${root.name}`);
    for (const span of printed.parameters)
      expect(printed.text.slice(span.startOffset, span.endOffset)).toBe(
        span.rawValue,
      );
    expect(printSpiceWithLocations(ir, false).text).toContain(
      "params: RVAL=1k RDOUBLE={RVAL * 2}",
    );
  });
});
