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

  it("keeps successful detail compact behind a visible summary", () => {
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
        ]}
      />,
    );
    expect(markup).toContain("Measurements");
    expect(markup).toContain("1 value");
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
    expect(markup).toContain("1 unavailable");
    expect(markup).toContain("At least two samples are required");
  });
});
