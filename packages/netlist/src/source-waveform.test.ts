import { describe, expect, it } from "vitest";

import { normalizeIndependentSource } from "./source-waveform.js";

describe("independent source waveform normalization", () => {
  it("projects a descriptor default without guessing from timing fields", () => {
    const normalized = normalizeIndependentSource(
      [
        { name: "dc", rawValue: "1" },
        { name: "period", rawValue: "10ns" },
      ],
      "dc",
    );
    expect(normalized.transient).toEqual({ kind: "dc" });
    expect(normalized.parameters).toContainEqual({
      name: "waveform",
      rawValue: "dc",
    });
  });

  it("returns recoverable diagnostics for invalid or incomplete waveforms", () => {
    expect(
      normalizeIndependentSource(
        [{ name: "waveform", rawValue: "triangle" }],
        "dc",
      ).issues,
    ).toContainEqual(
      expect.objectContaining({ code: "INVALID_SOURCE_WAVEFORM" }),
    );
    expect(
      normalizeIndependentSource(
        [
          { name: "waveform", rawValue: "pulse" },
          { name: "period", rawValue: "10ns" },
        ],
        "dc",
      ).issues.map((issue) => issue.parameter),
    ).toEqual(["low", "high", "delay", "rise", "fall", "width"]);
  });

  it("defaults optional SIN timing fields without inventing required values", () => {
    const normalized = normalizeIndependentSource([
      { name: "waveform", rawValue: "sin" },
      { name: "offset", rawValue: "0.9" },
      { name: "amplitude", rawValue: "10m" },
      { name: "frequency", rawValue: "1Meg" },
    ]);
    expect(normalized.issues).toEqual([]);
    expect(normalized.transient).toEqual({
      kind: "sin",
      offset: "0.9",
      amplitude: "10m",
      frequency: "1Meg",
      delay: "0",
      damping: "0",
      phase: "0",
    });
  });
});
