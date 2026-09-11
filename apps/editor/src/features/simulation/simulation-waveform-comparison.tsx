import type { SimulationOutputData } from "@icm/simulation-service/contract";
import type { ReactNode } from "react";

import {
  ComplexResultsExplorer,
  complexAcPoint,
  unwrapPhaseDegrees,
  type OutputTrace,
} from "./ac-results-explorer";
import type { SimulationComparisonRun } from "./simulation-run-comparison";
import { selectedResultRecords } from "./simulation-result-records";
import {
  ScalarResultsExplorer,
  type ScalarTrace,
} from "./transient-results-explorer";

type EvaluatedAnalysis = SimulationOutputData["analyses"][number];

export interface ScalarComparisonGroup {
  readonly key: string;
  readonly label: string;
  readonly analysis: EvaluatedAnalysis["analysis"];
  readonly domain: EvaluatedAnalysis["domain"] & {};
  readonly unit: string;
  readonly traces: readonly ScalarTrace[];
}

export interface ComplexComparisonGroup {
  readonly key: string;
  readonly label: string;
  readonly traces: readonly OutputTrace[];
}

export interface ComparisonWaveforms {
  readonly scalar: readonly ScalarComparisonGroup[];
  readonly complex: readonly ComplexComparisonGroup[];
}

function analysisTitle(analysis: EvaluatedAnalysis["analysis"]): string {
  if (analysis === "dc") return "DC";
  if (analysis === "ac") return "AC";
  if (analysis === "tran") return "Transient";
  if (analysis === "noise") return "Noise";
  return "Operating Point";
}

function runLabel(run: SimulationComparisonRun): string {
  const conditions = [
    run.environment.corner?.toUpperCase(),
    run.environment.temperatureC === undefined
      ? undefined
      : `${run.environment.temperatureC} °C`,
  ].filter(Boolean);
  return conditions.length
    ? `${run.label} · ${conditions.join(" · ")}`
    : run.label;
}

function quantity(unit: string): string {
  if (unit === "V") return "voltage";
  if (unit === "A") return "current";
  if (unit === "1") return "Value";
  return unit;
}

function domainIdentity(domain: NonNullable<EvaluatedAnalysis["domain"]>) {
  return `${domain.name}\u0000${domain.unit}\u0000${domain.values.join(",")}`;
}

/**
 * Build overlays only where the result contracts are compatible. Scalar runs
 * need the same sampled domain; complex AC traces carry their own frequencies.
 */
export function buildComparisonWaveforms(
  runs: readonly SimulationComparisonRun[],
): ComparisonWaveforms {
  const scalar = new Map<string, ScalarComparisonGroup>();
  const complex = new Map<string, ComplexComparisonGroup>();
  let colorIndex = 0;

  for (const run of runs) {
    for (const { analysis } of selectedResultRecords(
      run.outputData,
      run.records,
    )) {
      if (!analysis.domain || analysis.analysis === "op") continue;
      for (const output of analysis.outputs) {
        const label = `${output.label} — ${runLabel(run)}`;
        if (analysis.analysis === "ac" && output.imaginary) {
          const key = [
            analysis.analysis,
            analysis.plotName,
            analysis.domain.name,
            analysis.domain.unit,
            output.unit,
          ].join("\u0000");
          const group = complex.get(key) ?? {
            key,
            label: `${analysisTitle(analysis.analysis)} · ${analysis.plotName}`,
            traces: [],
          };
          const phases = unwrapPhaseDegrees(
            output.values.map(
              (real, index) =>
                (Math.atan2(
                  output.imaginary?.[index] ?? Number.NaN,
                  real ?? Number.NaN,
                ) *
                  180) /
                Math.PI,
            ),
          );
          const trace: OutputTrace = {
            id: `${run.id}:${analysis.plotName}:${output.id}`,
            label,
            colorIndex: colorIndex++,
            unit: output.unit,
            quantity: quantity(output.unit),
            points: analysis.domain.values.map((frequency, index) => ({
              ...complexAcPoint(
                frequency,
                output.values[index] ?? Number.NaN,
                output.imaginary?.[index] ?? Number.NaN,
              ),
              phaseDeg: phases[index] ?? Number.NaN,
            })),
          };
          complex.set(key, { ...group, traces: [...group.traces, trace] });
          continue;
        }

        const key = [
          analysis.analysis,
          analysis.plotName,
          domainIdentity(analysis.domain),
          output.unit,
        ].join("\u0000");
        const group = scalar.get(key) ?? {
          key,
          label: `${analysisTitle(analysis.analysis)} · ${analysis.plotName}`,
          analysis: analysis.analysis,
          domain: analysis.domain,
          unit: output.unit,
          traces: [],
        };
        const trace: ScalarTrace = {
          id: `${run.id}:${analysis.plotName}:${output.id}`,
          label,
          colorIndex: colorIndex++,
          quantity: quantity(output.unit),
          unit: output.unit === "1" ? null : output.unit,
          values: output.values.map((value) => value ?? Number.NaN),
        };
        scalar.set(key, { ...group, traces: [...group.traces, trace] });
      }
    }
  }

  return {
    scalar: [...scalar.values()].filter((group) => group.traces.length > 1),
    complex: [...complex.values()].filter((group) => group.traces.length > 1),
  };
}

export function SimulationWaveformComparison({
  runs,
  actions,
}: {
  runs: readonly SimulationComparisonRun[];
  actions?: ReactNode;
}) {
  const waveforms = buildComparisonWaveforms(runs);
  return (
    <section
      className="simulation-waveform-comparison"
      aria-label="Waveform overlays"
    >
      <header>
        <strong>Waveforms</strong>
        {actions}
      </header>
      {waveforms.complex.map((group) => (
        <ComplexResultsExplorer
          key={group.key}
          resultKey={`comparison:${group.key}`}
          plotName={group.label}
          traces={group.traces}
        />
      ))}
      {waveforms.scalar.map((group) => (
        <ScalarResultsExplorer
          key={group.key}
          resultKey={`comparison:${group.key}`}
          plotName={group.label}
          domain={group.domain.values}
          domainLabel={group.domain.name}
          domainUnit={group.domain.unit}
          logarithmicX={group.analysis === "ac" || group.analysis === "noise"}
          analysisLabel={`${analysisTitle(group.analysis)} comparison`}
          traces={group.traces}
        />
      ))}
    </section>
  );
}
