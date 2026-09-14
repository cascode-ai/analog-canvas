import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoiseResultsExplorer } from "./noise-results-explorer";
import type { SimulationOutputData } from "@icm/simulation-service/contract";

describe("noise result presentation", () => {
  it("uses the shared derived-integral label and never renders a missing integral as zero", () => {
    const analysis: SimulationOutputData["analyses"][number] = {
      analysis: "noise",
      plotName: "Noise Analysis",
      domain: { name: "Frequency", unit: "Hz", values: [1, 10] },
      outputs: [
        {
          id: "noise-input-density",
          label: "Input noise",
          unit: "A/sqrt(Hz)",
          values: [null, 1e-12],
        },
      ],
      integrated: [
        {
          id: "noise-integrated-output",
          label: "Integrated output noise (sampled PSD)",
          unit: "V",
          value: 2e-9,
        },
      ],
    };
    const rendered = renderToStaticMarkup(
      <NoiseResultsExplorer analysis={analysis} resultKey="native-noise" />,
    );
    expect(rendered).toContain("Integrated output noise (sampled PSD)");
    expect(rendered).not.toContain("Integrated input-referred noise");
    const noIntegrals = renderToStaticMarkup(
      <NoiseResultsExplorer
        analysis={{ ...analysis, integrated: [] }}
        resultKey="native-single-frequency"
      />,
    );
    expect(noIntegrals).not.toContain('aria-label="Integrated noise"');
  });
});
