import type { SimulationOutputData } from "./contract.js";

type Analysis = SimulationOutputData["analyses"][number];
type Measurement = NonNullable<SimulationOutputData["measurements"]>[number];
type Metric = Measurement["metric"];

interface SeriesSummary {
  readonly minimum: number;
  readonly maximum: number;
  readonly peakToPeak: number;
}

function finiteSummary(
  values: readonly (number | null)[],
): SeriesSummary | null {
  const finite = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (!finite.length) return null;
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  return { minimum, maximum, peakToPeak: maximum - minimum };
}

function weightedMoment(
  domain: readonly number[],
  values: readonly (number | null)[],
  square: boolean,
): number | null {
  let integral = 0;
  let duration = 0;
  for (let index = 1; index < Math.min(domain.length, values.length); index++) {
    const x0 = domain[index - 1]!;
    const x1 = domain[index]!;
    const y0 = values[index - 1];
    const y1 = values[index];
    const delta = x1 - x0;
    if (
      y0 === null ||
      y1 === null ||
      y0 === undefined ||
      y1 === undefined ||
      !Number.isFinite(y0) ||
      !Number.isFinite(y1) ||
      !Number.isFinite(delta) ||
      delta <= 0
    )
      continue;
    integral +=
      (((square ? y0 * y0 : y0) + (square ? y1 * y1 : y1)) / 2) * delta;
    duration += delta;
  }
  if (duration <= 0) return null;
  const moment = integral / duration;
  return square ? Math.sqrt(Math.max(0, moment)) : moment;
}

function available(
  analysisIndex: number,
  analysis: Analysis,
  output: Analysis["outputs"][number],
  metric: Metric,
  label: string,
  value: number,
): Measurement {
  return {
    id: `${analysisIndex}:${output.id}:${metric}`,
    analysisIndex,
    analysis: analysis.analysis,
    plotName: analysis.plotName,
    outputId: output.id,
    outputLabel: output.label,
    metric,
    label,
    unit: output.unit,
    origin: "automatic",
    status: "available",
    value,
  };
}

function unavailable(
  analysisIndex: number,
  analysis: Analysis,
  output: Analysis["outputs"][number],
  metric: Metric,
  label: string,
  reason: string,
): Measurement {
  return {
    id: `${analysisIndex}:${output.id}:${metric}`,
    analysisIndex,
    analysis: analysis.analysis,
    plotName: analysis.plotName,
    outputId: output.id,
    outputLabel: output.label,
    metric,
    label,
    unit: output.unit,
    origin: "automatic",
    status: "unavailable",
    reason,
  };
}

function measurement(
  analysisIndex: number,
  analysis: Analysis,
  output: Analysis["outputs"][number],
  metric: Metric,
  label: string,
  value: number | null | undefined,
  reason = "No finite samples are available",
): Measurement {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? available(analysisIndex, analysis, output, metric, label, value)
    : unavailable(analysisIndex, analysis, output, metric, label, reason);
}

/**
 * Conservative, setup-free summaries over the complete evaluated outputs.
 * A metric failure remains local to its row and never changes Run status.
 */
export function deriveAutomaticMeasurements(
  analyses: readonly Analysis[],
): Measurement[] {
  const result: Measurement[] = [];
  analyses.forEach((analysis, analysisIndex) => {
    for (const output of analysis.outputs) {
      const values = output.imaginary
        ? output.values.map((real, index) => {
            const imaginary = output.imaginary?.[index];
            return real === null ||
              imaginary === null ||
              imaginary === undefined
              ? null
              : Math.hypot(real, imaginary);
          })
        : output.values;
      if (analysis.analysis === "op") {
        result.push(
          measurement(
            analysisIndex,
            analysis,
            output,
            "operating-point",
            "Operating point",
            values[0],
          ),
        );
        continue;
      }
      const summary = finiteSummary(values);
      result.push(
        measurement(
          analysisIndex,
          analysis,
          output,
          "minimum",
          output.imaginary ? "Minimum magnitude" : "Minimum",
          summary?.minimum,
        ),
        measurement(
          analysisIndex,
          analysis,
          output,
          "maximum",
          output.imaginary ? "Maximum magnitude" : "Maximum",
          summary?.maximum,
        ),
        measurement(
          analysisIndex,
          analysis,
          output,
          "peak-to-peak",
          output.imaginary ? "Magnitude span" : "Peak to peak",
          summary?.peakToPeak,
        ),
      );
      if (analysis.analysis !== "tran") continue;
      const domain = analysis.domain?.values ?? [];
      result.push(
        measurement(
          analysisIndex,
          analysis,
          output,
          "time-mean",
          "Time-weighted mean",
          weightedMoment(domain, values, false),
          "At least two increasing finite time samples are required",
        ),
        measurement(
          analysisIndex,
          analysis,
          output,
          "time-rms",
          "Time-weighted RMS",
          weightedMoment(domain, values, true),
          "At least two increasing finite time samples are required",
        ),
      );
    }
  });
  return result;
}

export function automaticMeasurementsToCsv(
  measurements: readonly Measurement[],
): string {
  const quote = (value: string | number | undefined) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  return (
    [
      [
        "Analysis",
        "Plot",
        "Output",
        "Metric",
        "Value",
        "Unit",
        "Status",
        "Reason",
        "Origin",
        "Measurement ID",
        "Evidence",
      ],
      ...measurements.map((item) => [
        item.analysis.toUpperCase(),
        item.plotName,
        item.outputLabel,
        item.label,
        item.status === "available" ? item.value : "",
        item.unit === "1" ? "" : item.unit,
        item.status,
        item.status === "unavailable" ? item.reason : "",
        item.origin ?? "automatic",
        item.measurementId,
        item.evidence ? JSON.stringify(item.evidence) : "",
      ]),
    ]
      .map((row) => row.map(quote).join(","))
      .join("\n") + "\n"
  );
}
