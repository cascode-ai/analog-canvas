import type { SimulationMeasurementSpec } from "@icm/model";

import type { SimulationOutputData } from "./contract.js";

type Analysis = SimulationOutputData["analyses"][number];
type Output = Analysis["outputs"][number];
type Result = NonNullable<SimulationOutputData["measurements"]>[number];
type Metric = Result["metric"];

function metricOf(spec: SimulationMeasurementSpec): Metric {
  switch (spec.method.kind) {
    case "value":
      return "operating-point";
    case "mean":
      return "time-mean";
    case "rms":
      return "time-rms";
    default:
      return spec.method.kind;
  }
}

function evidenceOf(spec: SimulationMeasurementSpec): Result["evidence"] {
  if (spec.method.kind === "sample-at")
    return { kind: "point", coordinate: spec.method.coordinate };
  if ("window" in spec.method && spec.method.window)
    return { kind: "window", ...spec.method.window };
  return undefined;
}

function resultBase(
  spec: SimulationMeasurementSpec,
  analysis: Analysis,
  analysisIndex: number,
  output: Output,
) {
  return {
    id: `authored:${spec.id}:${analysisIndex}`,
    analysisIndex,
    analysis: analysis.analysis,
    plotName: analysis.plotName,
    outputId: output.id,
    outputLabel: output.label,
    metric: metricOf(spec),
    label: spec.label,
    unit: output.unit,
    origin: "authored" as const,
    measurementId: spec.id,
    ...(evidenceOf(spec) ? { evidence: evidenceOf(spec) } : {}),
  };
}

function unavailable(
  spec: SimulationMeasurementSpec,
  analysis: Analysis,
  analysisIndex: number,
  output: Output,
  reason: string,
): Result {
  return {
    ...resultBase(spec, analysis, analysisIndex, output),
    status: "unavailable",
    reason,
  };
}

function available(
  spec: SimulationMeasurementSpec,
  analysis: Analysis,
  analysisIndex: number,
  output: Output,
  value: number | null | undefined,
  reason: string,
): Result {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? {
        ...resultBase(spec, analysis, analysisIndex, output),
        status: "available",
        value,
      }
    : unavailable(spec, analysis, analysisIndex, output, reason);
}

function interpolate(
  domain: readonly number[],
  values: readonly (number | null)[],
  coordinate: number,
): number | null {
  for (let index = 0; index < Math.min(domain.length, values.length); index++) {
    if (domain[index] === coordinate) return values[index] ?? null;
  }
  for (let index = 1; index < Math.min(domain.length, values.length); index++) {
    const x0 = domain[index - 1]!;
    const x1 = domain[index]!;
    if (
      (coordinate < x0 && coordinate < x1) ||
      (coordinate > x0 && coordinate > x1)
    )
      continue;
    if (x0 === x1) continue;
    const y0 = values[index - 1];
    const y1 = values[index];
    if (y0 === null || y0 === undefined || y1 === null || y1 === undefined)
      return null;
    return y0 + ((coordinate - x0) / (x1 - x0)) * (y1 - y0);
  }
  return null;
}

function windowSeries(
  domain: readonly number[],
  values: readonly (number | null)[],
  start: number,
  stop: number,
): { domain: number[]; values: (number | null)[] } | null {
  const startValue = interpolate(domain, values, start);
  const stopValue = interpolate(domain, values, stop);
  if (startValue === null || stopValue === null) return null;
  const points: { x: number; y: number | null }[] = [
    { x: start, y: startValue },
  ];
  for (let index = 0; index < Math.min(domain.length, values.length); index++) {
    const x = domain[index]!;
    if (x > start && x < stop) points.push({ x, y: values[index] ?? null });
  }
  points.push({ x: stop, y: stopValue });
  points.sort((left, right) => left.x - right.x);
  return {
    domain: points.map((point) => point.x),
    values: points.map((point) => point.y),
  };
}

function finite(values: readonly (number | null)[]): number[] {
  return values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
}

function weighted(
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
    if (y0 === null || y0 === undefined || y1 === null || y1 === undefined)
      continue;
    const delta = x1 - x0;
    if (!Number.isFinite(delta) || delta <= 0) continue;
    integral +=
      (((square ? y0 * y0 : y0) + (square ? y1 * y1 : y1)) / 2) * delta;
    duration += delta;
  }
  if (duration <= 0) return null;
  const value = integral / duration;
  return square ? Math.sqrt(Math.max(0, value)) : value;
}

/** Evaluate saved scalar rules from complete, already-evaluated Output data. */
export function deriveAuthoredMeasurements(
  analyses: readonly Analysis[],
  specs: readonly SimulationMeasurementSpec[],
): Result[] {
  return specs.map((spec) => {
    const analysisIndex = analyses.findIndex(
      (analysis) => analysis.analysis === spec.analysis,
    );
    const analysis = analyses[analysisIndex];
    const output = analysis?.outputs.find(
      (candidate) => candidate.id === spec.outputId,
    );
    if (!analysis || !output) {
      const fallbackAnalysis =
        analysis ??
        ({
          analysis: spec.analysis,
          plotName: spec.analysis.toUpperCase(),
          outputs: [],
        } as Analysis);
      const fallbackOutput =
        output ??
        ({
          id: spec.outputId,
          label: spec.outputId,
          unit: "",
          values: [],
        } as Output);
      return unavailable(
        spec,
        fallbackAnalysis,
        Math.max(0, analysisIndex),
        fallbackOutput,
        analysis
          ? "The referenced Output is unavailable"
          : "The referenced analysis result is unavailable",
      );
    }
    if (output.imaginary)
      return unavailable(
        spec,
        analysis,
        analysisIndex,
        output,
        "Define an explicit mag, db20, phase, real, or imag Output before measuring complex AC data",
      );

    const method = spec.method;
    if (method.kind === "value")
      return available(
        spec,
        analysis,
        analysisIndex,
        output,
        output.values[0],
        "The operating-point value is unavailable",
      );
    const domain = analysis.domain?.values;
    if (!domain)
      return unavailable(
        spec,
        analysis,
        analysisIndex,
        output,
        "This measurement requires an analysis domain",
      );
    if (method.kind === "sample-at")
      return available(
        spec,
        analysis,
        analysisIndex,
        output,
        interpolate(domain, output.values, method.coordinate),
        "The requested coordinate is outside the available finite samples",
      );

    const selected = method.window
      ? windowSeries(
          domain,
          output.values,
          method.window.start,
          method.window.stop,
        )
      : { domain: [...domain], values: [...output.values] };
    if (!selected)
      return unavailable(
        spec,
        analysis,
        analysisIndex,
        output,
        "The requested window is outside the available finite samples",
      );
    if (method.kind === "mean" || method.kind === "rms")
      return available(
        spec,
        analysis,
        analysisIndex,
        output,
        weighted(selected.domain, selected.values, method.kind === "rms"),
        "At least two increasing finite samples are required in the window",
      );
    const values = finite(selected.values);
    const minimum = values.length ? Math.min(...values) : null;
    const maximum = values.length ? Math.max(...values) : null;
    const value =
      method.kind === "minimum"
        ? minimum
        : method.kind === "maximum"
          ? maximum
          : minimum === null || maximum === null
            ? null
            : maximum - minimum;
    return available(
      spec,
      analysis,
      analysisIndex,
      output,
      value,
      "No finite samples are available in the requested range",
    );
  });
}
