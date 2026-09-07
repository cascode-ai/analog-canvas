import type { SimulationFocusTarget } from "./simulation-focus-target";
import {
  simulationExpressionDependencies,
  type SimulationOutputSpec,
} from "@icm/model";
import type { SimulationOutputData } from "@icm/simulation-service/contract";

import {
  ComplexResultsExplorer,
  unwrapPhaseDegrees,
} from "./ac-results-explorer";
import { ScalarResultsExplorer } from "./transient-results-explorer";
import { SimulationMeasurementResults } from "./simulation-measurement-results";

function focusProbe(
  output: SimulationOutputSpec,
): SimulationFocusTarget | null {
  const dependency = simulationExpressionDependencies(output.expression)[0];
  if (!dependency) return null;
  return { ...dependency, id: output.id };
}

export function SimulationOutputResults({
  resultKey,
  data,
  outputs,
  onFocusProbe,
}: {
  resultKey: string;
  data: SimulationOutputData;
  outputs: readonly SimulationOutputSpec[];
  onFocusProbe?(probe: SimulationFocusTarget): void;
}) {
  const authored = new Map(outputs.map((output) => [output.id, output]));
  const probes = outputs.flatMap((output) => {
    const probe = focusProbe(output);
    return probe ? [probe] : [];
  });
  const visibleAnalyses = new Set(
    data.analyses.map((analysis) => analysis.analysis),
  );

  return (
    <>
      {data.analyses.map((analysis, analysisIndex) => {
        if (analysis.analysis === "op")
          return (
            <section
              key={`op-${analysisIndex}`}
              aria-label="Derived OP results"
            >
              <h3>{analysis.plotName}</h3>
              <table>
                <thead>
                  <tr>
                    <th>Output</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.outputs.map((output) => (
                    <tr key={output.id}>
                      <td>{output.label}</td>
                      <td>
                        {output.values[0]?.toPrecision(6) ?? "—"}{" "}
                        {output.unit === "1" ? "" : output.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        if (!analysis.domain) return null;
        const complex = analysis.outputs.filter((output) => output.imaginary);
        const scalar = analysis.outputs.filter((output) => !output.imaginary);
        const scalarByUnit = new Map<string, typeof scalar>();
        for (const output of scalar)
          scalarByUnit.set(output.unit, [
            ...(scalarByUnit.get(output.unit) ?? []),
            output,
          ]);
        return (
          <section key={`${analysis.analysis}-${analysisIndex}`}>
            {analysis.analysis === "ac" && complex.length > 0 ? (
              <ComplexResultsExplorer
                resultKey={`${resultKey}:complex:${analysisIndex}`}
                plotName={analysis.plotName}
                traces={complex.map((output, colorIndex) => {
                  const phases = unwrapPhaseDegrees(
                    output.values.map(
                      (value, i) =>
                        (Math.atan2(
                          output.imaginary![i] ?? Number.NaN,
                          value ?? Number.NaN,
                        ) *
                          180) /
                        Math.PI,
                    ),
                  );
                  const probe = probes.find((probe) => probe.id === output.id);
                  return {
                    id: output.id,
                    label: output.label,
                    colorIndex,
                    quantity:
                      output.unit === "V"
                        ? "voltage"
                        : output.unit === "A"
                          ? "current"
                          : output.unit === "1"
                            ? "ratio"
                            : output.unit,
                    ...(probe ? { probe } : {}),
                    points: analysis.domain!.values.map((frequency, i) => ({
                      frequency,
                      magnitudeDb:
                        20 *
                        Math.log10(
                          Math.max(
                            Math.hypot(
                              output.values[i] ?? Number.NaN,
                              output.imaginary![i] ?? Number.NaN,
                            ),
                            1e-30,
                          ),
                        ),
                      phaseDeg: phases[i] ?? Number.NaN,
                    })),
                  };
                })}
                {...(onFocusProbe ? { onFocusProbe } : {})}
              />
            ) : null}
            {[...scalarByUnit.entries()].map(([unit, unitOutputs]) => {
              return (
                <ScalarResultsExplorer
                  key={unit}
                  resultKey={`${resultKey}:${analysis.analysis}:${analysisIndex}:${unit}`}
                  plotName={analysis.plotName}
                  domain={analysis.domain!.values}
                  analysisLabel={
                    analysis.analysis === "tran"
                      ? "Transient"
                      : analysis.analysis.toUpperCase()
                  }
                  domainLabel={analysis.domain!.name}
                  domainUnit={analysis.domain!.unit}
                  logarithmicX={analysis.analysis === "ac"}
                  traces={unitOutputs.map((output, colorIndex) => ({
                    id: output.id,
                    label: output.label,
                    colorIndex,
                    quantity:
                      unit === "V"
                        ? "voltage"
                        : unit === "A"
                          ? "current"
                          : unit === "1"
                            ? "Value"
                            : unit,
                    unit: unit === "1" ? null : unit,
                    values: output.values.map((value) => value ?? Number.NaN),
                    ...(probes.find((probe) => probe.id === output.id)
                      ? {
                          probe: probes.find(
                            (probe) => probe.id === output.id,
                          )!,
                        }
                      : {}),
                  }))}
                  {...(onFocusProbe ? { onFocusProbe } : {})}
                />
              );
            })}
          </section>
        );
      })}
      {data.diagnostics.length > 0 ? (
        <div className="simulation-output-diagnostics" role="status">
          {data.diagnostics.map((diagnostic) => (
            <p key={`${diagnostic.outputId}:${diagnostic.code}`}>
              <strong>
                {authored.get(diagnostic.outputId)?.label ??
                  diagnostic.outputId}
              </strong>
              : {diagnostic.message}
            </p>
          ))}
        </div>
      ) : null}
      <SimulationMeasurementResults
        measurements={(data.measurements ?? []).filter((measurement) =>
          visibleAnalyses.has(measurement.analysis),
        )}
      />
    </>
  );
}
