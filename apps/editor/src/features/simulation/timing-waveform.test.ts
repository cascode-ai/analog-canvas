import { DraftingObjectSchema } from "@icm/model";
import type { DigitalSimulationResult } from "@icm/simulation";
import { describe, expect, it } from "vitest";

import {
  parseSimulationTimePs,
  timingWaveformSvg,
  traceStepPoints,
  waveformDraftingObjects,
} from "./timing-waveform";

const result: DigitalSimulationResult = {
  documentId: "main",
  documentRevision: 4,
  inputFingerprint: "test-fingerprint",
  stopTimePs: 20_000,
  completed: true,
  diagnostics: [],
  traces: [
    {
      netId: "clock",
      baseNetIds: ["clock"],
      name: "CK",
      transitions: [
        { timePs: 0, value: "0" },
        { timePs: 5_000, value: "1" },
        { timePs: 10_000, value: "0" },
      ],
    },
  ],
};

describe("timing waveform presentation", () => {
  it("parses explicit simulation time units into integer picoseconds", () => {
    expect(parseSimulationTimePs("40ns")).toBe(40_000);
    expect(parseSimulationTimePs("1.5 us")).toBe(1_500_000);
    expect(parseSimulationTimePs("0ns")).toBeNull();
    expect(parseSimulationTimePs("40")).toBeNull();
  });

  it("builds square-step points without interpolating digital edges", () => {
    expect(
      traceStepPoints(result.traces[0]!, 20_000, 100, 400, 20, 20),
    ).toEqual([
      { x: 100, y: 40 },
      { x: 200, y: 40 },
      { x: 200, y: 20 },
      { x: 300, y: 20 },
      { x: 300, y: 40 },
      { x: 500, y: 40 },
    ]);
  });

  it("exports a self-contained Razavi-style SVG with guides and time axis", () => {
    const svg = timingWaveformSvg(result);
    expect(svg).toContain('aria-label="Digital timing waveform"');
    expect(svg).toContain("stroke-dasharray:5 5");
    expect(svg).toContain(">CK</text>");
    expect(svg).toContain(">20 ns</text>");
    expect(svg).toContain('marker-end="url(#time-arrow)"');
  });

  it("converts a temporary run into valid editable vector drafting objects", () => {
    let suffix = 0;
    const objects = waveformDraftingObjects(
      result,
      { x: 20, y: 30 },
      10,
      (prefix) => `${prefix}-${++suffix}`,
    );
    expect(objects.map((object) => object.kind)).toEqual([
      "text",
      "text",
      "construction-line",
      "construction-line",
      "construction-line",
      "arrow",
      "text",
    ]);
    for (const object of objects) {
      expect(DraftingObjectSchema.parse(object)).toEqual(object);
    }
  });
});
