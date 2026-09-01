import { describe, expect, it } from "vitest";

import {
  acResponseSvg,
  formatFrequency,
  layoutAcPlot,
  type AcTrace,
} from "./ac-response-plot";

/** A single-pole roll-off: flat 40 dB, corner at 1 kHz, -20 dB/decade after. */
function singlePole(): AcTrace {
  const points = [];
  for (let decade = 0; decade <= 6; decade += 1) {
    const frequency = 10 ** decade;
    const ratio = frequency / 1000;
    points.push({
      frequency,
      magnitudeDb: 40 - 10 * Math.log10(1 + ratio * ratio),
      phaseDeg: -(Math.atan(ratio) * 180) / Math.PI,
    });
  }
  return { label: "vdb(vout)", points };
}

describe("AC response plot", () => {
  it("puts whole decades on the frequency axis", () => {
    const layout = layoutAcPlot([singlePole()], { width: 600, height: 300 });
    expect(layout).not.toBeNull();
    // A sweep from 1 Hz to 1 MHz reads as decades, not as raw sample points.
    expect(layout!.frequency.ticks).toEqual([1, 10, 100, 1e3, 1e4, 1e5, 1e6]);
  });

  it("rounds the magnitude axis outward to readable steps", () => {
    const layout = layoutAcPlot([singlePole()], { width: 600, height: 300 })!;
    // The trace spans about -20 dB to 40 dB; the axis must contain it and
    // land on round gridlines rather than on the data's own extremes.
    expect(layout.magnitude.min).toBeLessThanOrEqual(-20);
    expect(layout.magnitude.max).toBeGreaterThanOrEqual(40);
    expect(layout.magnitude.ticks).toContain(0);
  });

  it("reads a frequency back from a position, for a crosshair", () => {
    const layout = layoutAcPlot([singlePole()], { width: 600, height: 300 })!;
    const left = layout.frequencyAt(layout.frame.x);
    const right = layout.frequencyAt(layout.frame.x + layout.frame.width);

    expect(left).toBeCloseTo(1, 6);
    expect(right).toBeCloseTo(1e6, 0);
    // Logarithmic, so the midpoint is the geometric mean, not the average.
    expect(layout.frequencyAt(layout.frame.x + layout.frame.width / 2)).toBeCloseTo(
      1e3,
      6,
    );
  });

  it("draws magnitude and phase as separate traces on one frame", () => {
    const svg = acResponseSvg([singlePole()], { width: 600, height: 300 })!;

    expect(svg.startsWith("<svg")).toBe(true);
    // One polyline for magnitude and one for phase, per trace.
    expect(svg.match(/<polyline/gu)).toHaveLength(2);
    expect(svg).toContain('class="ac-trace ac-trace-0 ac-phase"');
    expect(svg).toContain('aria-label="AC response"');
  });

  it("declines to invent a plot when there is nothing to draw", () => {
    // A DC-only result, or a failed run, must not produce an empty frame that
    // looks like a measurement.
    expect(layoutAcPlot([], { width: 600, height: 300 })).toBeNull();
    expect(
      layoutAcPlot([{ label: "vdb(vout)", points: [] }], {
        width: 600,
        height: 300,
      }),
    ).toBeNull();
    // A zero or negative frequency has no place on a log axis and is dropped
    // rather than silently plotted somewhere arbitrary.
    expect(
      layoutAcPlot(
        [
          {
            label: "vdb(vout)",
            points: [{ frequency: 0, magnitudeDb: 1, phaseDeg: 0 }],
          },
        ],
        { width: 600, height: 300 },
      ),
    ).toBeNull();
  });

  it("labels the frequency axis the way it is spoken", () => {
    expect(formatFrequency(1)).toBe("1 Hz");
    expect(formatFrequency(1e3)).toBe("1 kHz");
    expect(formatFrequency(2.5e6)).toBe("2.5 MHz");
  });
});
