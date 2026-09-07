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

  it("keeps Noise spectra and integrated totals in one dedicated result", () => {
    const markup = renderToStaticMarkup(
      <SimulationOutputResults
        resultKey="run-noise"
        outputs={[]}
        data={{
          schemaVersion: 1,
          diagnostics: [],
          analyses: [
            {
              analysis: "noise",
              plotName: "Noise Analysis",
              domain: { name: "Frequency", unit: "Hz", values: [1, 10] },
              outputs: [
                {
                  id: "noise-output-density",
                  label: "Output noise density",
                  unit: "V/sqrt(Hz)",
                  values: [1e-9, 2e-9],
                },
                {
                  id: "noise-input-density",
                  label: "Input-referred noise density",
                  unit: "V/sqrt(Hz)",
                  values: [3e-9, 4e-9],
                },
              ],
              integrated: [
                {
                  id: "noise-integrated-output",
                  label: "Integrated output noise",
                  unit: "V",
                  value: 9e-8,
                },
                {
                  id: "noise-integrated-input",
                  label: "Integrated input-referred noise",
                  unit: "V",
                  value: 1.8e-7,
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("Noise Analysis");
    expect(markup).toContain('class="noise-results-explorer"');
    expect(markup).toContain('aria-label="Integrated noise"');
    expect(markup).toContain("Output noise density");
    expect(markup).toContain("Integrated input-referred noise");
    expect(markup).toContain("1.80000e-7 V");
  });
});
