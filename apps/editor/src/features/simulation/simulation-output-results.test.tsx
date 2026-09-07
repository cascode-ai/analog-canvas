import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SimulationOutputResults } from "./simulation-output-results";

describe("Simulation Output Results", () => {
  it("uses a compact analysis heading and one trailing measurement summary", () => {
    const markup = renderToStaticMarkup(
      <SimulationOutputResults
        resultKey="run-1"
        outputs={[]}
        data={{
          schemaVersion: 1,
          diagnostics: [],
          analyses: [
            {
              analysis: "op",
              plotName: "Bias point",
              outputs: [
                {
                  id: "out-v",
                  label: "VOUT",
                  unit: "V",
                  values: [1.5],
                },
              ],
            },
          ],
          measurements: [
            {
              id: "measurement-out-v",
              analysisIndex: 0,
              analysis: "op",
              plotName: "Bias point",
              outputId: "out-v",
              outputLabel: "VOUT",
              metric: "operating-point",
              label: "Operating point",
              unit: "V",
              status: "available",
              value: 1.5,
            },
          ],
        }}
      />,
    );

    expect(markup).toContain('class="simulation-output-results"');
    expect(markup).toContain('class="simulation-analysis-card"');
    expect(markup).toContain("Operating Point Analysis");
    expect(markup).not.toContain("<small>Bias point</small>");
    expect(markup).toContain("Measurements");
    expect(markup.indexOf("Measurements")).toBeGreaterThan(
      markup.indexOf("</section>"),
    );
  });
});
