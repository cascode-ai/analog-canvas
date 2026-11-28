import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { SimulationService } from "./service.js";

describe("SimulationService batch signal summaries", () => {
  it("summarizes >130k-point transient waveforms without overflowing the call stack and computes AC magnitude", () => {
    const project = createEmptyProject("batch-summary", "Batch Summary");
    const service = new SimulationService(
      {} as ConstructorParameters<typeof SimulationService>[0],
      {} as ConstructorParameters<typeof SimulationService>[1],
      () => project,
    );
    const points = 135_000;
    const wave = new Array<number>(points);
    for (let i = 0; i < points; i += 1) {
      wave[i] = i === 10 ? -2.5 : i === points - 1 ? 1.25 : 0.5;
    }
    const summaries = (
      service as unknown as {
        batchSignalSummaries(result: unknown): Array<{
          signal: string;
          analysis: string;
          value: number;
          minimum?: number;
          maximum?: number;
        }>;
      }
    ).batchSignalSummaries({
      data: {
        analyses: [
          {
            analysis: "tran",
            probes: [{ name: "v(out)", unit: "V", value: wave }],
          },
          {
            analysis: "ac",
            probes: [
              {
                name: "v(out)",
                unit: "V",
                real: [3, 0],
                imag: [4, 2],
              },
            ],
          },
        ],
      },
    });
    expect(summaries).toEqual([
      {
        status: "available",
        signal: "v(out)",
        analysisIndex: 0,
        analysis: "tran",
        unit: "V",
        value: 1.25,
        aggregation: "final",
        minimum: -2.5,
        maximum: 1.25,
      },
      {
        status: "available",
        signal: "v(out)",
        analysisIndex: 1,
        analysis: "ac",
        unit: "V",
        value: 2,
        aggregation: "final",
        minimum: 2,
        maximum: 5,
      },
    ]);
  });
});
