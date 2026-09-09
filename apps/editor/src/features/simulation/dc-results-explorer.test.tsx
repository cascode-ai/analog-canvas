import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DcResultsExplorer } from "./dc-results-explorer";

describe("DcResultsExplorer", () => {
  it("plots the simulator sweep axis and labels compiled probes", () => {
    const markup = renderToStaticMarkup(
      <DcResultsExplorer
        analysis={{
          analysis: "dc",
          plotName: "DC transfer characteristic",
          sweep: {
            name: "v-sweep",
            quantity: "voltage",
            unit: "V",
            values: [0, 0.5, 1],
          },
          probes: [
            {
              name: "v(out)",
              quantity: "voltage",
              unit: "V",
              value: [0, 0.25, 0.5],
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
        labels={{ "probe-out": "Output" }}
      />,
    );
    expect(markup).toContain('aria-label="DC sweep results"');
    expect(markup).toContain('aria-label="DC voltage"');
    expect(markup).not.toContain("Voltage DC sweep");
    expect(markup).toContain("3 points");
    expect(markup).toContain("Output");
    expect(markup).toContain('class="ac-axis-title"');
    expect(markup).toContain(">v-sweep/V</text>");
    expect(markup).toContain("<polyline");
    expect(markup).toContain(">-0.05</text>");
    expect(markup).toContain(">1.05</text>");
    expect(markup).toContain(">voltage/mV</text>");
  });
});
