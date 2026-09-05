import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AcResultsExplorer, unwrapPhaseDegrees } from "./ac-results-explorer";

describe("AC Results Explorer", () => {
  it("unwraps phase without inventing 360-degree discontinuities", () => {
    expect(unwrapPhaseDegrees([170, 179, -178, -165])).toEqual([
      170, 179, 182, 195,
    ]);
    expect(unwrapPhaseDegrees([-170, -179, 178, 165])).toEqual([
      -170, -179, -182, -195,
    ]);
  });

  it("presents one Output with separate magnitude and phase plots", () => {
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
            kind: "net-voltage",
            documentId: "tb",
            anchor: { kind: "base-net", netId: "out" },
            occurrence: [],
          },
        ]}
        labels={{ "probe-out": "VOUT" }}
      />,
    );

    expect(markup).toContain("VOUT");
    expect(markup).toContain('aria-label="AC magnitude"');
    expect(markup).toContain('aria-label="AC phase"');
    expect(markup.match(/data-trace-index="0"/gu)).toHaveLength(2);
  });
});
