import type { SimulationMeasurementSpec } from "@icm/model";
import { describe, expect, it } from "vitest";

import type { SimulationOutputData } from "./contract.js";
import { deriveAuthoredMeasurements } from "./authored-measurements.js";

const transient: SimulationOutputData["analyses"][number] = {
  analysis: "tran",
  plotName: "Transient",
  domain: { name: "Time", unit: "s", values: [0, 1, 3] },
  outputs: [{ id: "out", label: "Vout", unit: "V", values: [0, 2, 2] }],
};

function spec(
  id: string,
  method: SimulationMeasurementSpec["method"],
): SimulationMeasurementSpec {
  return { id, label: id, analysis: "tran", outputId: "out", method };
}

describe("authored simulation measurements", () => {
  it("interpolates point values on ascending and descending domains", () => {
    const forward = deriveAuthoredMeasurements(
      [transient],
      [spec("at-half", { kind: "sample-at", coordinate: 0.5 })],
    );
    const reverse = deriveAuthoredMeasurements(
      [
        {
          ...transient,
          domain: { name: "Sweep", unit: "V", values: [3, 1, 0] },
          outputs: [{ id: "out", label: "Vout", unit: "V", values: [2, 2, 0] }],
        },
      ],
      [spec("at-half", { kind: "sample-at", coordinate: 0.5 })],
    );

    expect(forward[0]).toMatchObject({
      origin: "authored",
      measurementId: "at-half",
      metric: "sample-at",
      status: "available",
      value: 1,
      evidence: { kind: "point", coordinate: 0.5 },
    });
    expect(reverse[0]).toMatchObject({ status: "available", value: 1 });
  });

  it("uses interpolated window boundaries and time-weighted integration", () => {
    const results = deriveAuthoredMeasurements(
      [transient],
      [
        spec("maximum", {
          kind: "maximum",
          window: { start: 0.5, stop: 2 },
        }),
        spec("mean", { kind: "mean", window: { start: 0, stop: 3 } }),
        spec("rms", { kind: "rms", window: { start: 0, stop: 3 } }),
      ],
    );

    expect(results[0]).toMatchObject({ status: "available", value: 2 });
    expect(results[1]).toMatchObject({
      status: "available",
      value: 5 / 3,
      evidence: { kind: "window", start: 0, stop: 3 },
    });
    expect(results[2]).toMatchObject({
      status: "available",
      value: Math.sqrt(10 / 3),
    });
  });

  it("keeps an unavailable rule local to its own row", () => {
    const [outside, complex] = deriveAuthoredMeasurements(
      [
        transient,
        {
          analysis: "ac",
          plotName: "AC",
          domain: { name: "Frequency", unit: "Hz", values: [1, 10] },
          outputs: [
            {
              id: "gain",
              label: "Gain",
              unit: "1",
              values: [1, 2],
              imaginary: [0, 1],
            },
          ],
        },
      ],
      [
        spec("outside", { kind: "sample-at", coordinate: 4 }),
        {
          id: "complex",
          label: "Complex",
          analysis: "ac",
          outputId: "gain",
          method: { kind: "maximum" },
        },
      ],
    );

    expect(outside).toMatchObject({ status: "unavailable" });
    expect(complex).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("explicit mag"),
    });
  });
});
