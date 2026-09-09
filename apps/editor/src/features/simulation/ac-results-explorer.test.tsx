import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AcResultsExplorer,
  complexAcPoint,
  referenceAcTrace,
  unwrapPhaseDegrees,
} from "./ac-results-explorer";

describe("AC Results Explorer", () => {
  it("unwraps phase without inventing 360-degree discontinuities", () => {
    expect(unwrapPhaseDegrees([170, 179, -178, -165])).toEqual([
      170, 179, 182, 195,
    ]);
    expect(unwrapPhaseDegrees([-170, -179, 178, 165])).toEqual([
      -170, -179, -182, -195,
    ]);
  });

  it("defaults a voltage Output to linear magnitude and offers AC views", () => {
    const markup = renderToStaticMarkup(
      <AcResultsExplorer
        analysis={{
          analysis: "ac",
          plotName: "AC Analysis",
          frequencyHz: [10, 100],
          probes: [
            {
              name: "v(out)",
              quantity: "voltage",
              unit: "V",
              real: [1, 0.5],
              imag: [0, -0.5],
            },
          ],
        }}
        vectors={[
          { probeId: "probe-out", vector: "v(out)", quantity: "voltage" },
        ]}
        probes={[
          {
            id: "probe-out",
            kind: "voltage",
            documentId: "tb",
            anchor: { kind: "base-net", netId: "out" },
            occurrence: [],
          },
        ]}
        labels={{ "probe-out": "VOUT" }}
      />,
    );

    expect(markup).toContain("VOUT");
    expect(markup).toContain("Voltage Magnitude");
    expect(markup).not.toContain("Voltage Phase");
    expect(markup).not.toContain("<h4>Voltage</h4>");
    expect(markup).toContain('aria-label="AC magnitude"');
    expect(markup).not.toContain('aria-label="AC phase"');
    expect(markup.match(/data-trace-index="0"/gu)).toHaveLength(1);
    expect(markup).toContain('aria-label="Voltage display"');
    expect(markup).toContain('aria-pressed="true">Magnitude');
    expect(markup).toContain("magnitude/V");
    expect(markup).toContain('aria-label="Plot tools"');
    expect(markup).toContain('class="waveform-tools-hint"');
    expect(markup).toContain('class="waveform-tool-actions"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).not.toContain('aria-label="More plot tools"');
    expect(markup).not.toContain("<strong>Voltage</strong>");
    expect(markup).toContain('aria-label="Open plot"');
    expect(markup).toContain('class="ac-axis-title"');
    expect(markup).toContain(">freq/Hz</text>");
    expect(markup).not.toContain("Wheel to zoom");
  });

  it("uses another complex trace as a presentation-only reference", () => {
    const trace = {
      id: "out",
      label: "Vout",
      unit: "V",
      quantity: "voltage",
      points: [complexAcPoint(1e3, 2, 2)],
    };
    const reference = {
      id: "in",
      label: "Vin",
      unit: "V",
      quantity: "voltage",
      points: [complexAcPoint(1e3, 1, 1)],
    };

    const relative = referenceAcTrace(trace, reference);

    expect(relative.unit).toBe("1");
    expect(relative.points[0]?.real).toBeCloseTo(2);
    expect(relative.points[0]?.imaginary).toBeCloseTo(0);
    expect(relative.points[0]?.magnitudeDb).toBeCloseTo(20 * Math.log10(2));
  });
});
