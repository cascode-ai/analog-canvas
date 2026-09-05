import { describe, expect, it } from "vitest";

import {
  estimateSimulationOutputBytes,
  outputVolumeWarning,
} from "./result-volume.js";

describe("simulation result volume estimate", () => {
  it("counts AC points by sweep semantics and every requested vector", () => {
    const linear = estimateSimulationOutputBytes(
      [
        {
          kind: "ac",
          sweep: "lin",
          points: 10,
          startHz: 1,
          stopHz: 1e6,
        },
      ],
      2,
    );
    const decade = estimateSimulationOutputBytes(
      [
        {
          kind: "ac",
          sweep: "dec",
          points: 10,
          startHz: 1,
          stopHz: 1e6,
        },
      ],
      2,
    );
    expect(decade).toBeGreaterThan(linear);
  });

  it("warns without refusing when a transient estimate exceeds the limit", () => {
    const warning = outputVolumeWarning(
      [
        {
          kind: "tran",
          stepSeconds: 1e-9,
          stopSeconds: 1e-3,
        },
      ],
      8,
      1024 * 1024,
    );
    expect(warning).toContain("run remains allowed");
    expect(warning).toContain("may be truncated");
  });
});
