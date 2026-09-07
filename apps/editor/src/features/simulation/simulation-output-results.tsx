import type { SimulationFocusTarget } from "./simulation-focus-target";
import type { ReactNode } from "react";
import {
  simulationExpressionDependencies,
  type SimulationOutputSpec,
} from "@icm/model";
import type { SimulationOutputData } from "@icm/simulation-service/contract";

import {
  ComplexResultsExplorer,
  complexAcPoint,
  unwrapPhaseDegrees,
} from "./ac-results-explorer";
import { ScalarResultsExplorer } from "./transient-results-explorer";
import { SimulationMeasurementResults } from "./simulation-measurement-results";

export type SimulationAnalysisKind = "op" | "dc" | "ac" | "tran";

function simulationAnalysisTitle(kind: SimulationAnalysisKind): string {
  switch (kind) {
    case "op":
      return "Operating Point Analysis";
    case "dc":
      return "DC Analysis";
    case "ac":
      return "AC Analysis";
    case "tran":
      return "Transient Analysis";
  }
}

export function SimulationAnalysisCard({
  kind,
  plotName,
  children,
}: {
  kind: SimulationAnalysisKind;
  plotName?: string;
  children: ReactNode;
}) {
  const title = simulationAnalysisTitle(kind);
  return (
    <section
      className="simulation-analysis-card"
      aria-label={kind === "op" ? "OP results" : `${title} results`}
    >
      <header className="simulation-analysis-card-header">
        <h3>{title}</h3>
        {plotName && plotName !== title ? <small>{plotName}</small> : null}
      </header>
      <div className="simulation-analysis-card-body">{children}</div>
    </section>
  );
}

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
  return (
    <div className="simulation-output-results">
      {data.analyses.map((analysis, analysisIndex) => {
        if (analysis.analysis === "op")
          return (
            <SimulationAnalysisCard
              key={`op-${analysisIndex}`}
              kind="op"
              plotName={analysis.plotName}
            >
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
              <SimulationMeasurementResults
                measurements={(data.measurements ?? []).filter(
                  (measurement) =>
                    measurement.analysis === analysis.analysis &&
                    measurement.plotName === analysis.plotName,
                )}
              />
            </SimulationAnalysisCard>
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
          <SimulationAnalysisCard
            key={`${analysis.analysis}-${analysisIndex}`}
            kind={analysis.analysis}
            plotName={analysis.plotName}
          >
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
                    unit: output.unit,
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
                      ...complexAcPoint(
                        frequency,
                        output.values[i] ?? Number.NaN,
                        output.imaginary![i] ?? Number.NaN,
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
            <SimulationMeasurementResults
              measurements={(data.measurements ?? []).filter(
                (measurement) =>
                  measurement.analysis === analysis.analysis &&
                  measurement.plotName === analysis.plotName,
              )}
            />
          </SimulationAnalysisCard>
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
    </div>
  );
}
