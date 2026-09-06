import { describe, expect, it } from "vitest";
import {
  responsiveWaveformHeight,
  waveformTicks,
  waveformTickLabel,
} from "./waveform-interaction";
import { layoutAcPlot } from "./ac-response-plot";

describe("waveform axes", () => {
  it("grows docked plots with their panel without becoming unbounded", () => {
    expect(responsiveWaveformHeight(400)).toBe(320);
    expect(responsiveWaveformHeight(760)).toBe(395);
    expect(responsiveWaveformHeight(1200)).toBe(440);
  });

  it("adapts tick spacing to nanoseconds and a zoomed small signal", () => {
    expect(waveformTickLabel(1.8000005, 5e-7, "V")).not.toBe(
      waveformTickLabel(1.800001, 5e-7, "V"),
    );
    expect(waveformTicks(0, 1e-9, 5)).toEqual([
      0, 2e-10, 4e-10, 6e-10, 8e-10, 1e-9,
    ]);
    const ticks = waveformTicks(1.799999, 1.800001, 5);
    expect(ticks.length).toBeGreaterThan(2);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(waveformTicks(2, 2)).toEqual([]);
  });
  it("keeps frequency ticks inside a sub-decade zoom and respects explicit Y zoom", () => {
    const result = layoutAcPlot(
      [
        {
          label: "out",
          points: [
            { frequency: 100, magnitudeDb: 1, phaseDeg: 0 },
            { frequency: 1000, magnitudeDb: 5, phaseDeg: 10 },
          ],
        },
      ],
      { width: 500, height: 280 },
      [240, 280],
      { kind: "magnitude", range: [2, 3] },
    )!;
    expect(result.frequency.ticks.length).toBeGreaterThan(2);
    expect(
      result.frequency.ticks.every((tick) => tick >= 240 && tick <= 280),
    ).toBe(true);
    expect(result.magnitude.min).toBe(2);
    expect(result.magnitude.max).toBe(3);
  });
});
