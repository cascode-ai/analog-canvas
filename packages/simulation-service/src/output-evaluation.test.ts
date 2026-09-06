import { describe, expect, it } from "vitest";

import { evaluateSimulationOutputs } from "./output-evaluation.js";

describe("simulation output evaluation", () => {
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
