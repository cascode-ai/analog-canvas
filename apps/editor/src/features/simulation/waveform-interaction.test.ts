import { describe, expect, it } from "vitest";
import {
  responsiveWaveformHeight,
  waveformTicks,
  waveformTickLabel,
  waveformAxisLabels,
} from "./waveform-interaction";
import { layoutAcPlot } from "./ac-response-plot";

describe("waveform axes", () => {
  it("grows docked plots with their panel without becoming unbounded", () => {
    expect(responsiveWaveformHeight(400)).toBe(320);
    expect(responsiveWaveformHeight(760)).toBe(395);
    expect(responsiveWaveformHeight(1000)).toBe(520);
    expect(responsiveWaveformHeight(1200)).toBe(600);
    expect(responsiveWaveformHeight(2400)).toBe(600);
    expect(responsiveWaveformHeight(1200, 800)).toBe(352);
    expect(responsiveWaveformHeight(1200, 600)).toBe(320);
  });

  it("adapts tick spacing to nanoseconds and a zoomed small signal", () => {
    expect(waveformTickLabel(1.8000005, 5e-7)).not.toBe(
      waveformTickLabel(1.800001, 5e-7),
    );
    expect(waveformTicks(0, 1e-9, 5)).toEqual([
      0, 2e-10, 4e-10, 6e-10, 8e-10, 1e-9,
    ]);
    const ticks = waveformTicks(1.799999, 1.800001, 5);
    expect(ticks.length).toBeGreaterThan(2);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(waveformTicks(2, 2)).toEqual([]);
  });
  it("uses a shared axis unit and numeric-only ticks including zero and log decades", () => {
    const time = waveformAxisLabels(0, 8e-9, "s");
    expect(time.unit).toBe("ns");
    expect([0, 2e-9, 4e-9].map((value) => time.tick(value, 2e-9))).toEqual([
      "0",
      "2",
      "4",
    ]);
    const frequency = waveformAxisLabels(1, 1e9, "Hz", true);
    expect(frequency.unit).toBe("Hz");
    expect(frequency.tick(1e9, 1e6)).toBe("1e+9");
    expect(frequency.tick(0.01, 0.00001)).toBe("0.01");
    expect(waveformAxisLabels(-180, 180, "°").unit).toBe("°");
  });
  it("keeps frequency ticks inside a sub-decade zoom and respects explicit Y zoom", () => {
    const result = layoutAcPlot(
      [
        {
          label: "out",
          unit: "V",
          points: [
            {
              frequency: 100,
              real: 1,
              imaginary: 0,
              magnitude: 1,
              magnitudeDb: 0,
              phaseDeg: 0,
            },
            {
              frequency: 1000,
              real: 5,
              imaginary: 0,
              magnitude: 5,
              magnitudeDb: 20 * Math.log10(5),
              phaseDeg: 0,
            },
          ],
        },
      ],
      { width: 500, height: 280 },
      "magnitude",
      [240, 280],
      [2, 3],
    )!;
    expect(result.frequency.ticks.length).toBeGreaterThan(2);
    expect(
      result.frequency.ticks.every((tick) => tick >= 240 && tick <= 280),
    ).toBe(true);
    expect(result.value.min).toBe(2);
    expect(result.value.max).toBe(3);
  });
});
