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
      {
        id: `0:out:minimum:${id}`,
        analysisIndex: 0,
        analysis: "tran",
        plotName: "Transient",
        outputId: "out",
        outputLabel: "Vout",
        metric: "minimum",
        label: "Minimum",
        unit: "V",
        status: "available",
        value: value / 2,
      },
      {
        id: `0:out:peak-to-peak:${id}`,
        analysisIndex: 0,
        analysis: "tran",
        plotName: "Transient",
        outputId: "out",
        outputLabel: "Vout",
        metric: "peak-to-peak",
        label: "Peak to peak",
        unit: "V",
        status: "available",
        value: value / 2,
      },
      {
        id: `1:out:maximum:${id}`,
        analysisIndex: 1,
        analysis: "ac",
        plotName: "AC",
        outputId: "out",
        outputLabel: "Vout",
        metric: "maximum",
        label: "Maximum",
        unit: "V",
        status: "available",
        value: value * 2,
      },
    ],
  };
}

describe("SimulationRunComparison", () => {
  it("pivots each run into signal rows and metric columns", () => {
    const markup = renderToStaticMarkup(
      <SimulationRunComparison
        runs={[
          run("before", "Before", 1, false),
          run("after", "After", 1.2, true),
        ]}
        onRemove={() => undefined}
      />,
    );
    expect(markup).toContain("Previous 1");
    expect(markup).toContain("Current");
    expect(markup).toContain(
      "<th>Signal</th><th>Maximum</th><th>Minimum</th><th>Peak to peak</th>",
    );
    expect(markup).toContain(">Transient<");
    expect(markup).toContain(">AC<");
    expect(markup).toContain(
      'aria-label="Transient comparison for previous run 1"',
    );
    expect(markup).toContain('aria-label="AC comparison for current run"');
    expect(markup).toContain("<th>Vout</th>");
    expect(markup).toContain("1 V");
    expect(markup).toContain("1.2 V");
    expect(markup).toContain("Remove Before from comparison");
    expect(markup).not.toContain("Remove After from comparison");
  });

  it("keeps distinct saved rules as additional signal-table columns", () => {
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
    expect(markup).toContain("<th>Early peak</th>");
    expect(markup).toContain("<th>Late peak</th>");
    expect(markup.match(/<th>Vout<\/th>/g)).toHaveLength(1);
  });
});
