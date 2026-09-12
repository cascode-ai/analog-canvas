import type { SimulationOutputData } from "@icm/simulation-service/contract";
import type { AcProbe } from "@icm/spice-run";

type Output = SimulationOutputData["analyses"][number]["outputs"][number];
export type ResultPlotLayout = "units" | "separate";
export interface PlannedOutput {
  output: Output;
  kind: "real" | "complex" | "unknown";
  complexView: boolean;
  group: string;
  groupLabel: string;
  unit: string;
}

function unitLabel(unit: string): string {
  if (unit === "V") return "Voltage";
  if (unit === "A") return "Current";
  if (unit === "dB") return "Decibels";
  if (unit === "deg" || unit === "rad") return "Phase";
  if (unit === "1") return "Value";
  return unit || "Unknown unit";
}

/** Pure presentation over immutable evidence. Never infer semantics from variable names
 * or classify a physical AC acquisition as real merely because Im happens to be zero. */
export function planResultOutput(
  output: Output,
  layout: ResultPlotLayout = "units",
  declaredUnit?: string,
): PlannedOutput {
  const unit = declaredUnit ?? output.unit;
  const hasImaginary =
    output.imaginary?.some((value) => value !== null && value !== 0) ?? false;
  const knownRealUnit = ["dB", "deg", "°", "rad"].includes(unit);
  const declaredKind =
    output.semantics?.valueKind ??
    (knownRealUnit && !hasImaginary
      ? "real"
      : output.imaginary
        ? output.unit
          ? "complex"
          : "unknown"
        : "real");
  const kind =
    declaredKind === "real" && hasImaginary ? "unknown" : declaredKind;
  // Contradictory legacy/source metadata must not erase imaginary evidence.
  const complexView =
    (kind === "complex" || hasImaginary) && Boolean(output.imaginary);
  const isolate = layout === "separate" || !unit || kind === "unknown";
  const label =
    complexView && unit === "1"
      ? "Ratio"
      : !complexView && (unit === "V" || unit === "A")
        ? unitLabel(unit).toLowerCase()
        : unitLabel(unit);
  return {
    output,
    kind,
    complexView,
    unit,
    group: `${complexView ? "complex" : "real"}:${unit}:${isolate ? output.id : "shared"}`,
    groupLabel: isolate ? `${output.label} — ${label}` : label,
  };
}

/** Archive fallback when only raw data exists. No authored expression is reconstructed. */
export function rawAcOutput(probe: AcProbe): Output {
  const q = probe.quantity.toLowerCase();
  const unit =
    probe.unit ?? (q === "decibel" ? "dB" : q === "phase" ? "rad" : "");
  const valueKind =
    q === "decibel" || q === "phase"
      ? "real"
      : /^(?:v|i)\(.+\)$/iu.test(probe.name) || probe.name.startsWith("@")
        ? "complex"
        : "unknown";
  return {
    id: probe.name,
    label: probe.name,
    unit,
    values: [...probe.real],
    imaginary: [...probe.imag],
    semantics: { valueKind, quantity: probe.quantity, origin: "raw" },
  };
}
