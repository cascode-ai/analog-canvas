import { describe, expect, it } from "vitest";

import {
  evaluateSimulationOutputs,
  simulationDeviceOperatingPointsToCsv,
} from "./output-evaluation.js";
import { SimulationOutputDataSchema } from "./contract.js";

describe("simulation output evaluation", () => {
  it("resolves ngspice46 typed raw names for hierarchical device parameters", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "op",
            plotName: "OP",
            probes: [
              {
                name: "i(@m.x1.m2[id])",
                quantity: "current",
                unit: "A",
                value: 0.000125,
              },
              {
                name: "v(@m.x1.m2[vgs])",
                quantity: "voltage",
                unit: "V",
                value: 1,
              },
            ],
          },
        ],
      },
      [
        { probeId: "id", vector: "@m.x1.m2[id]", quantity: "native" },
        { probeId: "vgs", vector: "@m.x1.m2[vgs]", quantity: "native" },
      ],
      [
        {
          id: "id",
          label: "ID",
          expression: {
            kind: "acquisition",
            acquisitionId: "id",
            quantity: "native",
          },
        },
        {
          id: "vgs",
          label: "VGS",
          expression: {
            kind: "acquisition",
            acquisitionId: "vgs",
            quantity: "native",
          },
        },
      ],
    );
    expect(result.analyses[0]?.outputs).toMatchObject([
      { unit: "A", values: [0.000125] },
      { unit: "V", values: [1] },
    ]);
    expect(result.diagnostics).toEqual([]);
  });
  it("only shows native Device OP quantities that the Code actually collected", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "op",
            plotName: "OP",
            probes: [
              {
                name: "@m1[gm]",
                quantity: "admittance",
                unit: "S",
                value: 0.002,
              },
            ],
          },
        ],
      },
      [
        { probeId: "gm", vector: "@m1[gm]", quantity: "native" },
        { probeId: "id", vector: "@m1[id]", quantity: "native" },
      ],
      [],
      [],
      [
        {
          id: "native-op:m1",
          documentId: "dut",
          instanceId: "M1",
          occurrence: [],
          reference: "M1",
          polarity: "nmos",
          values: [
            {
              parameter: "gm",
              label: "GM",
              unit: "S",
              expression: {
                kind: "acquisition",
                acquisitionId: "gm",
                quantity: "native",
              },
            },
            {
              parameter: "id",
              label: "ID",
              unit: "A",
              expression: {
                kind: "acquisition",
                acquisitionId: "id",
                quantity: "native",
              },
            },
          ],
        },
      ],
      true,
    );
    expect(result.deviceOperatingPoints?.[0]?.values).toEqual([
      {
        parameter: "gm",
        label: "GM",
        unit: "S",
        status: "available",
        value: 0.002,
      },
    ]);
    expect(SimulationOutputDataSchema.safeParse(result).success).toBe(true);
  });
  it("exposes saved native vectors alongside configured outputs with run-local names", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "op",
            plotName: "OP",
            probes: [
              { name: "v(out)", quantity: "voltage", unit: "V", value: 0.8 },
              { name: "v(in)", quantity: "voltage", unit: "V", value: 1 },
            ],
          },
        ],
      },
      [{ probeId: "input", vector: "v(in)", quantity: "voltage" }],
      [
        {
          id: "input-voltage",
          label: "Input",
          expression: {
            kind: "acquisition",
            acquisitionId: "input",
            quantity: "voltage",
          },
        },
      ],
      [],
      [],
      true,
      { "v(out)": "XDUT/Vout" },
    );
    expect(result.analyses[0]!.outputs.map((o) => o.label)).toEqual([
      "Input",
      "XDUT/Vout — v(out)",
    ]);
    expect(result.analyses[0]!.outputs[1]!.values).toEqual([0.8]);
  });
  it("keeps MOS terminal values and automatic/authored measurements for each raw OP record", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [1, 2].map((value, i) => ({
          analysis: "op",
          plotName: "Operating Point",
          rawPlotOrdinals: [i + 3],
          probes: [{ name: "v(g)", quantity: "voltage", unit: "V", value }],
        })),
      },
      [{ probeId: "gate", vector: "v(g)", quantity: "voltage" }],
      [
        {
          id: "gate-voltage",
          label: "Gate voltage",
          expression: {
            kind: "acquisition",
            acquisitionId: "gate",
            quantity: "voltage",
          },
        },
      ],
      [
        {
          id: "vg",
          label: "Gate",
          analysis: "op",
          outputId: "gate-voltage",
          method: { kind: "value" },
        },
      ],
      [
        {
          id: "mos",
          documentId: "dut",
          instanceId: "M1",
          occurrence: [],
          reference: "M1",
          polarity: "nmos",
          values: [
            {
              parameter: "vgs",
              label: "VGS",
              unit: "V",
              expression: {
                kind: "acquisition",
                acquisitionId: "gate",
                quantity: "voltage",
              },
            },
          ],
        },
      ],
    );
    expect(SimulationOutputDataSchema.safeParse(result).success).toBe(true);
    expect(result.analyses.map((a) => a.rawPlotOrdinals)).toEqual([[3], [4]]);
    expect(
      result.measurements?.filter((m) => m.origin === "authored"),
    ).toMatchObject([
      { rawPlotOrdinals: [3], value: 1 },
      { rawPlotOrdinals: [4], value: 2 },
    ]);
    expect(
      result.measurements?.filter((m) => m.origin === "automatic"),
    ).toMatchObject([
      { rawPlotOrdinals: [3], value: 1 },
      { rawPlotOrdinals: [4], value: 2 },
    ]);
    expect(result.deviceOperatingPoints).toMatchObject([
      { analysisIndex: 0, rawPlotOrdinals: [3], values: [{ value: 1 }] },
      { analysisIndex: 1, rawPlotOrdinals: [4], values: [{ value: 2 }] },
    ]);
    const csv = simulationDeviceOperatingPointsToCsv(
      result.deviceOperatingPoints!,
    );
    expect(csv).toContain('"Analysis index","Raw plot ordinals"');
    expect(csv).toContain('"1","4","M1","VGS","2"');
  });
  it("uses declared raw units for native vectors and never invents a unit", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "op",
            plotName: "Operating Point",
            probes: [
              {
                name: "custom",
                quantity: "resistance",
                value: 10,
                unit: "Ohm",
              },
              { name: "unknown", quantity: "other", value: 4, unit: null },
            ],
          },
        ],
      },
      [
        { probeId: "a", vector: "custom", quantity: "native" },
        { probeId: "b", vector: "unknown", quantity: "native" },
      ],
      [
        {
          id: "r",
          label: "Resistance",
          expression: {
            kind: "acquisition",
            acquisitionId: "a",
            quantity: "native",
          },
        },
        {
          id: "u",
          label: "Unknown quantity",
          expression: {
            kind: "acquisition",
            acquisitionId: "b",
            quantity: "native",
          },
        },
      ],
    );
    expect(result.analyses[0]!.outputs).toEqual([
      expect.objectContaining({ id: "r", unit: "Ohm", values: [10] }),
      expect.objectContaining({ id: "u", unit: "", values: [4] }),
    ]);
  });
  it("groups terminal-derived MOS values without exposing private vectors", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "op",
            plotName: "Operating Point",
            probes: [
              { name: "v(g)", quantity: "voltage", value: 1.2, unit: "V" },
              { name: "v(s)", quantity: "voltage", value: 0.2, unit: "V" },
              {
                name: "i(vsense)",
                quantity: "current",
                value: 0.001,
                unit: "A",
              },
            ],
          },
        ],
      },
      [
        { probeId: "vg", vector: "v(g)", quantity: "voltage" },
        { probeId: "vs", vector: "v(s)", quantity: "voltage" },
        { probeId: "id", vector: "i(vsense)", quantity: "current" },
      ],
      [],
      [],
      [
        {
          id: "op-m1",
          documentId: "dut",
          instanceId: "M1",
          occurrence: ["XDUT"],
          reference: "XM1",
          polarity: "nmos",
          values: [
            {
              parameter: "vgs",
              label: "VGS",
              unit: "V",
              expression: {
                kind: "subtract",
                left: {
                  kind: "acquisition",
                  acquisitionId: "vg",
                  quantity: "voltage",
                },
                right: {
                  kind: "acquisition",
                  acquisitionId: "vs",
                  quantity: "voltage",
                },
              },
            },
            {
              parameter: "id",
              label: "ID",
              unit: "A",
              expression: {
                kind: "acquisition",
                acquisitionId: "id",
                quantity: "current",
              },
            },
          ],
        },
      ],
    );

    expect(result.deviceOperatingPoints).toEqual([
      expect.objectContaining({
        reference: "XM1",
        values: [
          expect.objectContaining({
            parameter: "vgs",
            status: "available",
            value: 1,
          }),
          expect.objectContaining({
            parameter: "id",
            status: "available",
            value: 0.001,
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(result.deviceOperatingPoints)).not.toContain(
      "vsense",
    );
  });

  it("evaluates a dimensioned ground constant in terminal-derived voltage", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "op",
            plotName: "Operating Point",
            probes: [
              { name: "v(s)", quantity: "voltage", value: 0.2, unit: "V" },
            ],
          },
        ],
      },
      [{ probeId: "vs", vector: "v(s)", quantity: "voltage" }],
      [],
      [],
      [
        {
          id: "op-m1",
          documentId: "dut",
          instanceId: "M1",
          occurrence: ["XDUT"],
          reference: "XM1",
          polarity: "nmos",
          values: [
            {
              parameter: "vbs",
              label: "VBS",
              unit: "V",
              expression: {
                kind: "subtract",
                left: { kind: "constant", value: 0, unit: "V" },
                right: {
                  kind: "acquisition",
                  acquisitionId: "vs",
                  quantity: "voltage",
                },
              },
            },
          ],
        },
      ],
    );

    expect(result.deviceOperatingPoints?.[0]?.values[0]).toMatchObject({
      parameter: "vbs",
      status: "available",
      value: -0.2,
      unit: "V",
    });
  });

  it("publishes Noise density and integrated values without ngspice vector names", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "noise",
            plotName: "Noise Analysis",
            frequencyHz: [1, 10, 100],
            outputNoiseDensity: [2e-9, 3e-9, 4e-9],
            inputNoiseDensity: [4e-9, 6e-9, 8e-9],
            integratedOutputNoise: 9e-8,
            integratedInputNoise: 1.8e-7,
            units: {
              outputDensity: "V/sqrt(Hz)",
              inputDensity: "V/sqrt(Hz)",
              integratedOutput: "V",
              integratedInput: "V",
            },
          },
        ],
      },
      [],
      [],
      [
        {
          id: "noise-10hz",
          label: "Output noise at 10 Hz",
          analysis: "noise",
          outputId: "noise-output-density",
          method: { kind: "sample-at", coordinate: 10 },
        },
      ],
    );

    expect(result.analyses[0]).toMatchObject({
      analysis: "noise",
      domain: { name: "Frequency", unit: "Hz", values: [1, 10, 100] },
      outputs: [
        {
          id: "noise-output-density",
          unit: "V/sqrt(Hz)",
          values: [2e-9, 3e-9, 4e-9],
        },
        {
          id: "noise-input-density",
          unit: "V/sqrt(Hz)",
          values: [4e-9, 6e-9, 8e-9],
        },
      ],
      integrated: [
        { id: "noise-integrated-output", value: 9e-8, unit: "V" },
        { id: "noise-integrated-input", value: 1.8e-7, unit: "V" },
      ],
    });
    expect(result.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: "authored",
          measurementId: "noise-10hz",
          status: "available",
          value: 3e-9,
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("onoise_spectrum");
  });

  it("broadcasts a constant-only output across the analysis domain", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "tran",
            plotName: "Transient",
            timeSeconds: [0, 1, 2],
            probes: [],
          },
        ],
      },
      [],
      [
        {
          id: "constant",
          label: "Reference",
          expression: { kind: "constant", value: 2 },
        },
      ],
    );

    expect(result.analyses[0]?.outputs[0]?.values).toEqual([2, 2, 2]);
  });

  it("evaluates saved rules beside automatic summaries", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "tran",
            plotName: "Transient",
            timeSeconds: [0, 1, 2],
            probes: [],
          },
        ],
      },
      [],
      [
        {
          id: "constant",
          label: "Reference",
          expression: { kind: "constant", value: 2 },
        },
      ],
      [
        {
          id: "saved-rms",
          label: "Reference RMS",
          analysis: "tran",
          outputId: "constant",
          method: { kind: "rms", window: { start: 0, stop: 2 } },
        },
      ],
    );

    expect(result.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origin: "automatic", metric: "time-rms" }),
        expect.objectContaining({
          origin: "authored",
          measurementId: "saved-rms",
          label: "Reference RMS",
          status: "available",
          value: 2,
        }),
      ]),
    );
  });

  it("keeps a purely real AC acquisition complex for magnitude/phase plotting", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "ac",
            plotName: "AC",
            frequencyHz: [1, 10],
            probes: [
              {
                name: "v(out)",
                quantity: "voltage",
                unit: "V",
                real: [1, 0.5],
                imag: [0, 0],
              },
            ],
          },
        ],
      },
      [{ probeId: "out", vector: "v(out)", quantity: "voltage" }],
      [
        {
          id: "out",
          label: "Vout",
          expression: {
            kind: "acquisition",
            acquisitionId: "out",
            quantity: "voltage",
          },
        },
      ],
    );

    expect(result.analyses[0]?.outputs[0]?.imaginary).toEqual([0, 0]);
  });

  it("evaluates a complex voltage ratio and derived Bode views", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "ac",
            plotName: "AC",
            frequencyHz: [1, 10],
            probes: [
              {
                name: "v(in)",
                quantity: "voltage",
                unit: "V",
                real: [1, 1],
                imag: [0, 0],
              },
              {
                name: "v(out)",
                quantity: "voltage",
                unit: "V",
                real: [10, 0],
                imag: [0, 10],
              },
            ],
          },
        ],
      },
      [
        { probeId: "vin", vector: "v(in)", quantity: "voltage" },
        { probeId: "vout", vector: "v(out)", quantity: "voltage" },
      ],
      [
        {
          id: "gain",
          label: "Gain",
          expression: {
            kind: "divide",
            left: {
              kind: "acquisition",
              acquisitionId: "vout",
              quantity: "voltage",
            },
            right: {
              kind: "acquisition",
              acquisitionId: "vin",
              quantity: "voltage",
            },
          },
        },
        {
          id: "gain-db",
          label: "Gain_dB",
          expression: {
            kind: "db20",
            operand: {
              kind: "divide",
              left: {
                kind: "acquisition",
                acquisitionId: "vout",
                quantity: "voltage",
              },
              right: {
                kind: "acquisition",
                acquisitionId: "vin",
                quantity: "voltage",
              },
            },
          },
        },
      ],
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.analyses[0]?.outputs[0]).toMatchObject({
      id: "gain",
      unit: "1",
      values: [10, 0],
      imaginary: [0, 10],
    });
    expect(result.analyses[0]?.outputs[1]).toMatchObject({
      id: "gain-db",
      unit: "dB",
      values: [20, 20],
    });
  });

  it("isolates an invalid output without losing valid results", () => {
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "op",
            plotName: "OP",
            probes: [
              { name: "v(out)", quantity: "voltage", unit: "V", value: 1 },
            ],
          },
        ],
      },
      [{ probeId: "vout", vector: "v(out)", quantity: "voltage" }],
      [
        {
          id: "ok",
          label: "Vout",
          expression: {
            kind: "acquisition",
            acquisitionId: "vout",
            quantity: "voltage",
          },
        },
        {
          id: "bad",
          label: "Bad",
          expression: {
            kind: "acquisition",
            acquisitionId: "missing",
            quantity: "voltage",
          },
        },
      ],
    );
    expect(result.analyses[0]?.outputs.map((output) => output.id)).toEqual([
      "ok",
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        outputId: "bad",
        code: "SIMULATION_OUTPUT_EVALUATION_FAILED",
      }),
    ]);
  });
});
