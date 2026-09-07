import type { SimulationOutputData } from "@icm/simulation-service/contract";

import { ScalarResultsExplorer } from "./transient-results-explorer";

type EvaluatedAnalysis = SimulationOutputData["analyses"][number];

function displayNumber(value: number): string {
  if (value === 0) return "0";
  return value.toExponential(5);
}

/**
 * Noise owns both spectral curves and integrated scalars. Keep them together
 * in one result surface so the two ngspice plots never leak into the UI as
 * unrelated analyses.
 */
export function NoiseResultsExplorer({
  analysis,
  resultKey,
}: {
  analysis: EvaluatedAnalysis;
  resultKey: string;
}) {
  if (analysis.analysis !== "noise" || !analysis.domain) return null;
  const byUnit = new Map<string, typeof analysis.outputs>();
  for (const output of analysis.outputs)
    byUnit.set(output.unit, [...(byUnit.get(output.unit) ?? []), output]);

  return (
    <div className="noise-results-explorer">
      {[...byUnit.entries()].map(([unit, outputs]) => (
        <ScalarResultsExplorer
          key={unit}
          resultKey={`${resultKey}:${unit}`}
          plotName={analysis.plotName}
          domain={analysis.domain!.values}
          analysisLabel="Noise"
          domainLabel={analysis.domain!.name}
          domainUnit={analysis.domain!.unit}
          logarithmicX
          traces={outputs.map((output, colorIndex) => ({
            id: output.id,
            label: output.label,
            colorIndex,
            quantity: "noise-density",
            unit,
            values: output.values.map((value) => value ?? Number.NaN),
          }))}
        />
      ))}
      {analysis.integrated?.length ? (
        <section
          className="simulation-integrated-results"
          aria-label="Integrated noise"
        >
          <h4>Integrated noise</h4>
          <table>
            <thead>
              <tr>
                <th>Quantity</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {analysis.integrated.map((item) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td>
                    {displayNumber(item.value)} {item.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
