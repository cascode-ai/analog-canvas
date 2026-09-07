import type {
  CompiledSimulationExpression,
  CompiledSimulationOutput,
  CompiledSimulationVector,
} from "@icm/netlist";
import type { SimulationResultData } from "@icm/spice-run";
import type { SimulationMeasurementSpec } from "@icm/model";

import type { SimulationOutputData } from "./contract.js";
import { deriveAutomaticMeasurements } from "./automatic-measurements.js";
import { deriveAuthoredMeasurements } from "./authored-measurements.js";

interface ComplexSeries {
  readonly real: readonly (number | null)[];
  readonly imaginary: readonly (number | null)[];
  readonly unit: string;
  /** Preserve AC complex semantics even when every imaginary sample is zero. */
  readonly complex: boolean;
}

function point(
  left: number | null,
  right: number | null,
  operation: (a: number, b: number) => number,
): number | null {
  if (left === null || right === null) return null;
  const value = operation(left, right);
  return Number.isFinite(value) ? value : null;
}

function compatibleUnit(left: string, right: string): string | null {
  return left === right ? left : null;
}

function productUnit(left: string, right: string): string {
  if (left === "1") return right;
  if (right === "1") return left;
  return `${left}·${right}`;
}

function quotientUnit(left: string, right: string): string {
  if (left === right) return "1";
  if (right === "1") return left;
  return `${left}/${right}`;
}

function evaluate(
  expression: CompiledSimulationExpression,
  acquisitions: ReadonlyMap<string, ComplexSeries>,
  pointCount: number,
): ComplexSeries {
  if (expression.kind === "acquisition") {
    const acquired = acquisitions.get(expression.acquisitionId);
    if (!acquired)
      throw new Error(`Missing acquisition ${expression.acquisitionId}`);
    return acquired;
  }
  if (expression.kind === "constant") {
    return {
      real: Array.from({ length: pointCount }, () => expression.value),
      imaginary: Array.from({ length: pointCount }, () => 0),
      unit: "1",
      complex: false,
    };
  }
  if (
    expression.kind === "add" ||
    expression.kind === "subtract" ||
    expression.kind === "multiply" ||
    expression.kind === "divide"
  ) {
    const left = evaluate(expression.left, acquisitions, pointCount);
    const right = evaluate(expression.right, acquisitions, pointCount);
    if (left.real.length !== right.real.length)
      throw new Error("Expression inputs have different point counts");
    if (expression.kind === "add" || expression.kind === "subtract") {
      const unit = compatibleUnit(left.unit, right.unit);
      if (!unit)
        throw new Error(
          `Cannot ${expression.kind} ${left.unit} and ${right.unit}`,
        );
      const sign = expression.kind === "add" ? 1 : -1;
      return {
        unit,
        complex: left.complex || right.complex,
        real: left.real.map((value, index) =>
          point(value, right.real[index] ?? null, (a, b) => a + sign * b),
        ),
        imaginary: left.imaginary.map((value, index) =>
          point(value, right.imaginary[index] ?? null, (a, b) => a + sign * b),
        ),
      };
    }
    const divide = expression.kind === "divide";
    const real: (number | null)[] = [];
    const imaginary: (number | null)[] = [];
    for (let index = 0; index < left.real.length; index++) {
      const ar = left.real[index] ?? null;
      const ai = left.imaginary[index] ?? null;
      const br = right.real[index] ?? null;
      const bi = right.imaginary[index] ?? null;
      if (ar === null || ai === null || br === null || bi === null) {
        real.push(null);
        imaginary.push(null);
        continue;
      }
      if (divide) {
        const denominator = br * br + bi * bi;
        real.push(denominator === 0 ? null : (ar * br + ai * bi) / denominator);
        imaginary.push(
          denominator === 0 ? null : (ai * br - ar * bi) / denominator,
        );
      } else {
        real.push(ar * br - ai * bi);
        imaginary.push(ar * bi + ai * br);
      }
    }
    return {
      real,
      imaginary,
      complex: left.complex || right.complex,
      unit: divide
        ? quotientUnit(left.unit, right.unit)
        : productUnit(left.unit, right.unit),
    };
  }
  if (!("operand" in expression)) throw new Error("Invalid expression");
  const operand = evaluate(expression.operand, acquisitions, pointCount);
  if (expression.kind === "negate")
    return {
      unit: operand.unit,
      complex: operand.complex,
      real: operand.real.map((value) => (value === null ? null : -value)),
      imaginary: operand.imaginary.map((value) =>
        value === null ? null : -value,
      ),
    };
  const polar = operand.real.map((real, index) => {
    const imaginary = operand.imaginary[index] ?? null;
    return real === null || imaginary === null
      ? { magnitude: null, phase: null }
      : {
          magnitude: Math.hypot(real, imaginary),
          phase: (Math.atan2(imaginary, real) * 180) / Math.PI,
        };
  });
  if (expression.kind === "phase")
    return {
      unit: "deg",
      complex: false,
      real: polar.map((value) => value.phase),
      imaginary: polar.map(() => 0),
    };
  if (expression.kind === "db20") {
    if (operand.unit !== "1")
      throw new Error(
        `db20 requires a unitless ratio, received ${operand.unit}`,
      );
    return {
      unit: "dB",
      complex: false,
      real: polar.map(({ magnitude }) =>
        magnitude && magnitude > 0 ? 20 * Math.log10(magnitude) : null,
      ),
      imaginary: polar.map(() => 0),
    };
  }
  if (expression.kind === "real")
    return {
      unit: operand.unit,
      complex: false,
      real: [...operand.real],
      imaginary: operand.real.map(() => 0),
    };
  if (expression.kind === "imaginary")
    return {
      unit: operand.unit,
      complex: false,
      real: [...operand.imaginary],
      imaginary: operand.real.map(() => 0),
    };
  return {
    unit: operand.unit,
    complex: false,
    real: polar.map((value) => value.magnitude),
    imaginary: operand.real.map(() => 0),
  };
}

function sourceSeries(
  analysis: SimulationResultData["analyses"][number],
  vectors: readonly CompiledSimulationVector[],
): Map<string, ComplexSeries> {
  const byName = new Map(
    analysis.probes.map((probe) => [probe.name.toLowerCase(), probe]),
  );
  const result = new Map<string, ComplexSeries>();
  for (const vector of vectors) {
    const source = byName.get(vector.vector.toLowerCase());
    if (!source) continue;
    const unit = vector.quantity === "voltage" ? "V" : "A";
    if (analysis.analysis === "ac" && "real" in source) {
      result.set(vector.probeId, {
        unit,
        real: source.real,
        imaginary: source.imag,
        complex: true,
      });
    } else {
      const value = "value" in source ? source.value : [];
      const real = Array.isArray(value) ? value : [value];
      result.set(vector.probeId, {
        unit,
        real,
        imaginary: real.map(() => 0),
        complex: false,
      });
    }
  }
  return result;
}

/** Evaluate all authored outputs without changing the simulator's raw result. */
export function evaluateSimulationOutputs(
  data: SimulationResultData,
  vectors: readonly CompiledSimulationVector[],
  outputs: readonly CompiledSimulationOutput[],
  measurementSpecs: readonly SimulationMeasurementSpec[] = [],
): SimulationOutputData {
  const diagnostics: SimulationOutputData["diagnostics"] = [];
  const analyses: SimulationOutputData["analyses"] = data.analyses.map(
    (analysis) => {
      const acquisitions = sourceSeries(analysis, vectors);
      const pointCount =
        analysis.analysis === "op"
          ? 1
          : analysis.analysis === "ac"
            ? analysis.frequencyHz.length
            : analysis.analysis === "tran"
              ? analysis.timeSeconds.length
              : analysis.sweep.values.length;
      const evaluated = outputs.flatMap((output) => {
        try {
          const series = evaluate(output.expression, acquisitions, pointCount);
          return [
            {
              id: output.id,
              label: output.label,
              unit: series.unit,
              values: [...series.real],
              ...(series.complex ? { imaginary: [...series.imaginary] } : {}),
            },
          ];
        } catch (error) {
          diagnostics.push({
            outputId: output.id,
            code: "SIMULATION_OUTPUT_EVALUATION_FAILED",
            message:
              error instanceof Error ? error.message : "Evaluation failed",
          });
          return [];
        }
      });
      const domain =
        analysis.analysis === "ac"
          ? {
              name: "Frequency",
              unit: "Hz",
              values: [...analysis.frequencyHz],
            }
          : analysis.analysis === "tran"
            ? { name: "Time", unit: "s", values: [...analysis.timeSeconds] }
            : analysis.analysis === "dc"
              ? {
                  name: analysis.sweep.name,
                  unit: analysis.sweep.unit ?? "",
                  values: [...analysis.sweep.values],
                }
              : undefined;
      return {
        analysis: analysis.analysis,
        plotName: analysis.plotName,
        ...(domain ? { domain } : {}),
        outputs: evaluated,
      };
    },
  );
  return {
    schemaVersion: 1,
    diagnostics,
    analyses,
    measurements: [
      ...deriveAutomaticMeasurements(analyses),
      ...deriveAuthoredMeasurements(analyses, measurementSpecs),
    ],
  };
}

export function simulationOutputAnalysisToCsv(
  analysis: SimulationOutputData["analyses"][number],
): string {
  const quote = (value: string | number | null) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const headers = [
    ...(analysis.domain
      ? [`${analysis.domain.name} (${analysis.domain.unit})`]
      : ["Point"]),
    ...analysis.outputs.flatMap((output) =>
      output.imaginary
        ? [
            `${output.label} real (${output.unit})`,
            `${output.label} imaginary (${output.unit})`,
          ]
        : [`${output.label} (${output.unit})`],
    ),
  ];
  const count =
    analysis.domain?.values.length ?? analysis.outputs[0]?.values.length ?? 0;
  const rows = Array.from({ length: count }, (_, index) => [
    analysis.domain?.values[index] ?? index,
    ...analysis.outputs.flatMap((output) =>
      output.imaginary
        ? [output.values[index] ?? null, output.imaginary[index] ?? null]
        : [output.values[index] ?? null],
    ),
  ]);
  return (
    [headers, ...rows].map((row) => row.map(quote).join(",")).join("\n") + "\n"
  );
}
