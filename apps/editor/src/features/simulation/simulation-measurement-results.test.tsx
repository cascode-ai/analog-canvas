import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SimulationMeasurementResults } from "./simulation-measurement-results";

describe("SimulationMeasurementResults", () => {
  const base = {
    analysisIndex: 0,
    analysis: "tran" as const,
    plotName: "Transient",
    outputId: "out",
    outputLabel: "Vout",
    unit: "V",
  };

  it("groups one Output's measurements behind its own summary", () => {
    const markup = renderToStaticMarkup(
      <SimulationMeasurementResults
        measurements={[
          {
            ...base,
            id: "0:out:maximum",
            metric: "maximum",
            label: "Maximum",
            status: "available",
            value: 1.25,
          },
          {
            ...base,
            id: "0:out:minimum",
            metric: "minimum",
            label: "Minimum",
            status: "available",
            value: 0.25,
          },
        ]}
      />,
    );
    expect(markup).toContain("Measurements");
    expect(markup).toContain("2 values");
    expect(markup.match(/simulation-measurement-output"/gu)).toHaveLength(1);
    expect(markup.match(/<strong>Vout<\/strong>/gu)).toHaveLength(1);
    expect(markup).toContain("Maximum");
    expect(markup).toContain("Minimum");
    expect(markup).not.toContain("<details open");
  });

  it("opens automatically so an unavailable measurement is not hidden", () => {
    const markup = renderToStaticMarkup(
      <SimulationMeasurementResults
        measurements={[
          {
            ...base,
            id: "0:out:time-rms",
            metric: "time-rms",
            label: "Time-weighted RMS",
            status: "unavailable",
            reason: "At least two samples are required",
          },
        ]}
      />,
    );
    expect(markup).toContain('open=""');
    expect(markup).toContain('class="simulation-measurement-output" open=""');
    expect(markup).toContain("1 unavailable");
    expect(markup).toContain("At least two samples are required");
  });
});
