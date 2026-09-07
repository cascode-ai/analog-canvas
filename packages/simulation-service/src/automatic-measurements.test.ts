import { describe, expect, it } from "vitest";

import {
  automaticMeasurementsToCsv,
  deriveAutomaticMeasurements,
} from "./automatic-measurements.js";

describe("automatic simulation measurements", () => {
  it("uses time-weighted integration on a nonuniform transient grid", () => {
    const measurements = deriveAutomaticMeasurements([
      {
        analysis: "tran",
        plotName: "Transient",
        domain: { name: "Time", unit: "s", values: [0, 1, 3] },
        outputs: [
          {
            id: "out",
            label: "Vout",
            unit: "V",
            values: [0, 2, 2],
          },
        ],
      },
    ]);

    expect(
      measurements.find((item) => item.metric === "time-mean"),
    ).toMatchObject({ status: "available", value: 5 / 3, unit: "V" });
    expect(
      measurements.find((item) => item.metric === "time-rms"),
    ).toMatchObject({ status: "available", value: Math.sqrt(10 / 3) });
    expect(
      measurements.find((item) => item.metric === "peak-to-peak"),
    ).toMatchObject({ status: "available", value: 2 });
  });

  it("keeps an unavailable metric explicit without discarding other rows", () => {
    const measurements = deriveAutomaticMeasurements([
      {
        analysis: "tran",
        plotName: "Short",
        domain: { name: "Time", unit: "s", values: [0] },
        outputs: [{ id: "out", label: "Vout", unit: "V", values: [1] }],
      },
    ]);

    expect(
      measurements.find((item) => item.metric === "maximum"),
    ).toMatchObject({ status: "available", value: 1 });
    expect(
      measurements.find((item) => item.metric === "time-rms"),
    ).toMatchObject({
      status: "unavailable",
      reason: "At least two increasing finite time samples are required",
    });
    expect(automaticMeasurementsToCsv(measurements)).toContain(
      '"unavailable","At least two increasing finite time samples are required"',
    );
  });

  it("summarizes a complex AC output by magnitude", () => {
    const measurements = deriveAutomaticMeasurements([
      {
        analysis: "ac",
        plotName: "AC",
        domain: { name: "Frequency", unit: "Hz", values: [1, 10] },
        outputs: [
          {
            id: "out",
            label: "Vout",
            unit: "V",
            values: [3, 0],
            imaginary: [4, 2],
          },
        ],
      },
    ]);

    expect(
      measurements.map((item) => [
        item.metric,
        item.status === "available" ? item.value : undefined,
      ]),
    ).toEqual([
      ["minimum", 2],
      ["maximum", 5],
      ["peak-to-peak", 3],
    ]);
  });
});
