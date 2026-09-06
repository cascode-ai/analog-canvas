import { describe, expect, it } from "vitest";
import {
  commitWaveformView,
  initialWaveformState,
  travelWaveformView,
  parseWaveformRange,
  zoomWaveformRange,
} from "./waveform-view";

describe("waveform views", () => {
  it("restores both axes and Auto, then discards the forward branch on a new edit", () => {
    const initial = initialWaveformState();
    const first = commitWaveformView(initial, {
      x: [1, 2],
      y: { voltage: [0, 1] },
    });
    const second = commitWaveformView(first, {
      x: [1.2, 1.4],
      y: { voltage: [0.2, 0.3] },
    });
    const back = travelWaveformView(second, -1);
    expect(back.history[back.index]).toEqual(first.history[first.index]);
    expect(travelWaveformView(back, 1)).toEqual(second);
    const branch = commitWaveformView(back, { x: undefined, y: {} });
    expect(branch.history).toHaveLength(3);
    expect(branch.history[branch.index]).toEqual(initial.history[0]);
    expect(travelWaveformView(branch, 1).index).toBe(branch.index);
    expect(commitWaveformView(branch, { x: undefined, y: {} })).toBe(branch);
  });
  it("bounds navigation history without dropping unrelated markers or hidden traces", () => {
    let state = {
      ...initialWaveformState(),
      markers: { A: 1, B: 2 },
      hidden: new Set(["out"]),
    };
    for (let i = 0; i < 70; i++)
      state = {
        ...commitWaveformView(state, { x: [i, i + 1], y: {} }),
        markers: state.markers,
        hidden: state.hidden,
      };
    expect(state.history).toHaveLength(50);
    expect(state.markers).toEqual({ A: 1, B: 2 });
    expect(state.hidden.has("out")).toBe(true);
  });
  it("accepts scientific notation and returns recoverable errors for invalid axis limits", () => {
    expect(parseWaveformRange("1e-9", "2e-9")).toEqual([1e-9, 2e-9]);
    for (const range of [
      ["", "1"],
      ["2", "1"],
      ["0", "Infinity"],
      ["1", "1"],
    ])
      expect(typeof parseWaveformRange(range[0]!, range[1]!)).toBe("string");
    expect(typeof parseWaveformRange("0", "100", true)).toBe("string");
  });
  it("zooms linear and logarithmic axes about their correct centers", () => {
    expect(zoomWaveformRange([0, 10], 0.6)).toEqual([2, 8]);
    const log = zoomWaveformRange([1, 1e6], 0.5, true);
    expect(log[0] * log[1]).toBeCloseTo(1e6, 4);
    expect(log[0]).toBeCloseTo(10 ** 1.5);
    expect(log[1]).toBeCloseTo(10 ** 4.5);
  });
});
