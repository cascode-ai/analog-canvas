import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SimulationRunComparison,
  type SimulationComparisonRun,
} from "./simulation-run-comparison";

function run(
  id: string,
  label: string,
  value: number,
  current: boolean,
): SimulationComparisonRun {
  return {
    id,
    label,
    inputRevision: `revision-${id}`,
    environment: { profileId: "sky130", corner: "tt", temperatureC: 27 },
    current,
    measurements: [
      {
        id: `0:out:maximum:${id}`,
        analysisIndex: 0,
        analysis: "tran",
        plotName: "Transient",
        outputId: "out",
        outputLabel: "Vout",
        metric: "maximum",
        label: "Maximum",
        unit: "V",
        status: "available",
        value,
      },
    ],
  };
}

describe("SimulationRunComparison", () => {
  it("aligns measurements by stable output identity, analysis, metric and unit", () => {
    const markup = renderToStaticMarkup(
      <SimulationRunComparison
        runs={[
          run("before", "Before", 1, false),
          run("after", "After", 1.2, true),
        ]}
        onRemove={() => undefined}
      />,
    );
    expect(markup).toContain("Before");
    expect(markup).toContain("After");
    expect(markup).toContain("TRAN · Maximum");
    expect(markup).toContain("1 V");
    expect(markup).toContain("1.2 V");
    expect(markup).toContain("Remove Before from comparison");
    expect(markup).not.toContain("Remove After from comparison");
  });

  it("keeps distinct saved rules even when they use the same output and metric", () => {
    const base = run("current", "Current", 1.2, true);
    const current: SimulationComparisonRun = {
      ...base,
      measurements: [
        {
          ...base.measurements[0]!,
          id: "authored:early",
          origin: "authored",
          measurementId: "early",
          label: "Early peak",
        },
        {
          ...base.measurements[0]!,
          id: "authored:late",
          origin: "authored",
          measurementId: "late",
          label: "Late peak",
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <SimulationRunComparison runs={[current]} />,
    );
    expect(markup).toContain("Early peak");
    expect(markup).toContain("Late peak");
  });
});
