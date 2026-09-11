import type { SimulationFocusTarget } from "./simulation-focus-target";
import { useState, type ReactNode } from "react";
import {
  presentationDependencies as simulationExpressionDependencies,
  type SimulationPresentationExpression as SimulationExpression,
  type SimulationPresentationOutput as SimulationOutputSpec,
} from "./source-presentation";
import type {
  Prepared,
  SimulationOutputData,
} from "@icm/simulation-service/contract";

import {
  ComplexResultsExplorer,
  complexAcPoint,
  unwrapPhaseDegrees,
} from "./ac-results-explorer";
import { ScalarResultsExplorer } from "./transient-results-explorer";
import { SimulationMeasurementResults } from "./simulation-measurement-results";
import { NoiseResultsExplorer } from "./noise-results-explorer";

export type SimulationAnalysisKind = "op" | "dc" | "ac" | "tran" | "noise";

const PRESENTATION_KINDS = new Set<SimulationExpression["kind"]>([
  "magnitude",
  "db20",
  "phase",
  "real",
  "imaginary",
  "absolute",
]);

function presentationBase(expression: SimulationExpression) {
  let base = expression;
  while ("operand" in base && PRESENTATION_KINDS.has(base.kind))
    base = base.operand;
  return JSON.stringify(base);
}

function presentationMode(expression: SimulationExpression): string {
  return "operand" in expression && PRESENTATION_KINDS.has(expression.kind)
    ? expression.kind
    : "value";
}

function presentationModeLabel(mode: string): string {
  switch (mode) {
    case "magnitude":
      return "Magnitude";
    case "db20":
      return "dB";
    case "phase":
      return "Phase";
    case "real":
      return "Real";
    case "imaginary":
      return "Imag";
    case "absolute":
      return "Abs";
    default:
      return "Value";
  }
}

interface OutputPresentationFamily {
  readonly base: SimulationOutputSpec;
  readonly variants: readonly SimulationOutputSpec[];
}

function outputPresentationFamilies(
  outputs: readonly SimulationOutputSpec[],
): readonly OutputPresentationFamily[] {
  const candidates = new Map<string, SimulationOutputSpec[]>();
  for (const output of outputs) {
    const key = presentationBase(output.expression);
    candidates.set(key, [...(candidates.get(key) ?? []), output]);
  }
  return [...candidates.values()].flatMap((variants) => {
    const base = variants.find(
      (output) => presentationMode(output.expression) === "value",
    );
    return base && variants.length > 1 ? [{ base, variants }] : [];
  });
}

function scalarQuantity(unit: string): string {
  return unit === "V"
    ? "voltage"
    : unit === "A"
      ? "current"
      : unit === "1"
        ? "Value"
        : unit;
}

function ScalarPresentationFamilyResults({
  family,
  variants,
  resultKey,
  plotName,
  analysisLabel,
  domain,
  domainLabel,
  domainUnit,
  logarithmicX,
  probes,
  onFocusProbe,
}: {
  family: OutputPresentationFamily;
  variants: readonly {
    spec: SimulationOutputSpec;
    result: {
      readonly id: string;
      readonly label: string;
      readonly unit: string;
      readonly values: readonly (number | null)[];
    };
  }[];
  resultKey: string;
  plotName: string;
  analysisLabel: string;
  domain: readonly number[];
  domainLabel: string;
  domainUnit: string;
  logarithmicX: boolean;
  probes: readonly SimulationFocusTarget[];
  onFocusProbe?: (probe: SimulationFocusTarget) => void;
}) {
  const [selectedId, setSelectedId] = useState(family.base.id);
  const selected =
    variants.find(({ spec }) => spec.id === selectedId) ?? variants[0]!;
  const probe = probes.find((candidate) => candidate.id === family.base.id);
  return (
    <div className="simulation-expression-family">
      <div className="ac-view-alignment">
        <div className="ac-view-toolbar">
          <div role="group" aria-label={`${family.base.label} display`}>
            {variants.map(({ spec }) => (
              <button
                key={spec.id}
                type="button"
                aria-pressed={selected.spec.id === spec.id}
                onClick={() => setSelectedId(spec.id)}
              >
                {presentationModeLabel(presentationMode(spec.expression))}
              </button>
            ))}
          </div>
        </div>
      </div>
      <ScalarResultsExplorer
        resultKey={`${resultKey}:${family.base.id}`}
        plotName={plotName}
        domain={domain}
        analysisLabel={analysisLabel}
        domainLabel={domainLabel}
        domainUnit={domainUnit}
        logarithmicX={logarithmicX}
        traces={[
          {
            id: family.base.id,
            label: family.base.label,
            colorIndex: 0,
            quantity: scalarQuantity(selected.result.unit),
            unit: selected.result.unit === "1" ? null : selected.result.unit,
            values: selected.result.values.map((value) => value ?? Number.NaN),
            ...(probe ? { probe } : {}),
          },
        ]}
        {...(onFocusProbe ? { onFocusProbe } : {})}
      />
    </div>
  );
}

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
    case "noise":
      return "Noise Analysis";
  }
}

export function SimulationAnalysisCard({
  kind,
  children,
}: {
  kind: SimulationAnalysisKind;
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
  signalTargets,
  onFocusProbe,
}: {
  resultKey: string;
  data: SimulationOutputData;
  outputs: readonly SimulationOutputSpec[];
  signalTargets?: Prepared["signalTargets"];
  onFocusProbe?(probe: SimulationFocusTarget): void;
}) {
  const authored = new Map(outputs.map((output) => [output.id, output]));
  const presentationFamilies = outputPresentationFamilies(outputs);
  const probes = outputs.flatMap((output) => {
    const probe = focusProbe(output);
    return probe ? [probe] : [];
  });
  for (const [vector, targets] of Object.entries(signalTargets ?? {})) {
    const target = targets[0];
    if (!target) continue;
    probes.push({
      id: `native:${vector.toLowerCase()}`,
      kind: "voltage",
      rootDocumentId: target.rootDocumentId,
      documentId: target.documentId,
      occurrence: target.occurrence,
      anchor: { kind: "base-net", netId: target.netId },
    });
  }
  const visibleAnalyses = new Set(
    data.analyses.map((analysis) => analysis.analysis),
  );
  return (
    <div className="simulation-output-results">
      {data.analyses.map((analysis, analysisIndex) => {
        if (analysis.analysis === "op")
          return (
            <SimulationAnalysisCard key={`op-${analysisIndex}`} kind="op">
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
            </SimulationAnalysisCard>
          );
        if (analysis.analysis === "noise")
          return (
            <SimulationAnalysisCard key={`noise-${analysisIndex}`} kind="noise">
              <NoiseResultsExplorer
                analysis={analysis}
                resultKey={`${resultKey}:noise:${analysisIndex}`}
              />
            </SimulationAnalysisCard>
          );
        if (!analysis.domain) return null;
        const complex = analysis.outputs.filter((output) => output.imaginary);
        const complexFamilies = new Set(
          complex.flatMap((output) => {
            const expression = authored.get(output.id)?.expression;
            return expression ? [presentationBase(expression)] : [];
          }),
        );
        const scalarFamilies = presentationFamilies.flatMap((family) => {
          const baseResult = analysis.outputs.find(
            (output) => output.id === family.base.id && !output.imaginary,
          );
          if (!baseResult) return [];
          const variants = family.variants.flatMap((spec) => {
            const result = analysis.outputs.find(
              (output) => output.id === spec.id && !output.imaginary,
            );
            return result ? [{ spec, result }] : [];
          });
          return variants.length > 1 ? [{ family, variants }] : [];
        });
        const scalarFamilyOutputIds = new Set(
          scalarFamilies.flatMap(({ variants }) =>
            variants.map(({ spec }) => spec.id),
          ),
        );
        const scalar = analysis.outputs.filter((output) => {
          if (output.imaginary) return false;
          if (scalarFamilyOutputIds.has(output.id)) return false;
          if (analysis.analysis !== "ac") return true;
          const expression = authored.get(output.id)?.expression;
          return !(
            expression &&
            PRESENTATION_KINDS.has(expression.kind) &&
            complexFamilies.has(presentationBase(expression))
          );
        });
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
            {scalarFamilies.map(({ family, variants }) => (
              <ScalarPresentationFamilyResults
                key={family.base.id}
                family={family}
                variants={variants}
                resultKey={`${resultKey}:${analysis.analysis}:${analysisIndex}`}
                plotName={analysis.plotName}
                analysisLabel={
                  analysis.analysis === "tran"
                    ? "Transient"
                    : analysis.analysis.toUpperCase()
                }
                domain={analysis.domain!.values}
                domainLabel={analysis.domain!.name}
                domainUnit={analysis.domain!.unit}
                logarithmicX={analysis.analysis === "ac"}
                probes={probes}
                {...(onFocusProbe ? { onFocusProbe } : {})}
              />
            ))}
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
                    quantity: scalarQuantity(unit),
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
          </SimulationAnalysisCard>
        );
      })}
      {data.diagnostics.length > 0 ? (
        <div className="simulation-output-diagnostics" role="status">
          {data.diagnostics.map((diagnostic, index) => (
            <p key={`${index}:${diagnostic.outputId}:${diagnostic.code}`}>
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
    </div>
  );
}
