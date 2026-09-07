import { describe, expect, it } from "vitest";

import { evaluateSimulationOutputs } from "./output-evaluation.js";

describe("simulation output evaluation", () => {
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
