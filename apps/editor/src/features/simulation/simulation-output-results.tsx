import {
  simulationExpressionDependencies,
  type SimulationOutputSpec,
  type SimulationProbeSpec,
} from "@icm/model";
import type { AcResult, TransientResult } from "@icm/spice-run";
import type {
  Prepared,
  SimulationOutputData,
} from "@icm/simulation-service/contract";

import { AcResultsExplorer } from "./ac-results-explorer";
import { TransientResultsExplorer } from "./transient-results-explorer";
import { SimulationMeasurementResults } from "./simulation-measurement-results";

function focusProbe(output: SimulationOutputSpec): SimulationProbeSpec | null {
  const dependency = simulationExpressionDependencies(output.expression)[0];
  if (!dependency) return null;
  return dependency.kind === "voltage"
    ? {
        id: output.id,
        kind: "net-voltage",
        documentId: dependency.documentId,
        anchor: structuredClone(dependency.anchor),
        occurrence: [...dependency.occurrence],
      }
    : {
        id: output.id,
        kind: "terminal-current",
        documentId: dependency.documentId,
        instanceId: dependency.instanceId,
        pinName: dependency.pinName,
        occurrence: [...dependency.occurrence],
      };
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
  onFocusProbe?(probe: SimulationProbeSpec): void;
}) {
  const authored = new Map(outputs.map((output) => [output.id, output]));
  const probes = outputs.flatMap((output) => {
    const probe = focusProbe(output);
    return probe ? [probe] : [];
  });
  const labels = Object.fromEntries(
    outputs.map((output) => [output.id, output.label]),
  );
  const vectors = (ids: readonly string[]): Prepared["vectors"] =>
    ids.map((id) => ({ probeId: id, vector: id, quantity: "voltage" }));
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
              <AcResultsExplorer
                resultKey={`${resultKey}:complex:${analysisIndex}`}
                analysis={
                  {
                    analysis: "ac",
                    plotName: analysis.plotName,
                    frequencyHz: analysis.domain.values,
                    probes: complex.map((output) => ({
                      name: output.id,
                      quantity: "derived",
                      unit: output.unit,
                      real: output.values.map((value) => value ?? Number.NaN),
                      imag: output.imaginary!.map(
                        (value) => value ?? Number.NaN,
                      ),
                    })),
                  } satisfies AcResult
                }
                vectors={vectors(complex.map((output) => output.id))}
                probes={probes.filter((probe) =>
                  complex.some((output) => output.id === probe.id),
                )}
                labels={labels}
                groups={Object.fromEntries(
                  complex.map((output) => [
                    output.id,
                    output.unit === "V"
                      ? "voltage"
                      : output.unit === "A"
                        ? "current"
                        : output.unit === "1"
                          ? "ratio"
                          : output.unit,
                  ]),
                )}
                {...(onFocusProbe ? { onFocusProbe } : {})}
              />
            ) : null}
            {[...scalarByUnit.entries()].map(([unit, unitOutputs]) => {
              const synthetic: TransientResult = {
                analysis: "tran",
                plotName: analysis.plotName,
                timeSeconds: analysis.domain!.values,
                probes: unitOutputs.map((output) => ({
                  name: output.id,
                  quantity: "derived",
                  unit: unit === "1" ? null : unit,
                  value: output.values.map((value) => value ?? Number.NaN),
                })),
              };
              return (
                <TransientResultsExplorer
                  key={unit}
                  resultKey={`${resultKey}:${analysis.analysis}:${analysisIndex}:${unit}`}
                  analysis={synthetic}
                  analysisLabel={
                    analysis.analysis === "tran"
                      ? "Transient"
                      : analysis.analysis.toUpperCase()
                  }
                  domainLabel={analysis.domain!.name}
                  domainUnit={analysis.domain!.unit}
                  logarithmicX={analysis.analysis === "ac"}
                  vectors={vectors(unitOutputs.map((output) => output.id))}
                  groups={Object.fromEntries(
                    unitOutputs.map((output) => [
                      output.id,
                      unit === "V"
                        ? "voltage"
                        : unit === "A"
                          ? "current"
                          : unit === "1"
                            ? "Value"
                            : unit,
                    ]),
                  )}
                  probes={probes.filter((probe) =>
                    unitOutputs.some((output) => output.id === probe.id),
                  )}
                  labels={labels}
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
