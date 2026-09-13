import type { SimulationOutputData } from "@icm/simulation-service/contract";

type Report = NonNullable<SimulationOutputData["nativeMeasurements"]>[number];

/** Presentation only: retain the original reports in the Run/Console/artifacts.
 * Only suppress a unique scalar's corroborating report. Repeated names, changed
 * values and complex values are not evidence of a unique matching capture. */
export function unrepresentedConsoleMeasurements(
  data: SimulationOutputData,
): Report[] {
  const reports = data.nativeMeasurements ?? [];
  const scalars = data.analyses.flatMap((analysis) => analysis.scalars ?? []);
  return reports.filter((report) => {
    if (report.status !== "available") return true;
    const name = report.name.toLowerCase();
    if (reports.filter((r) => r.name.toLowerCase() === name).length !== 1)
      return true;
    const captures = scalars.filter(
      (s) => s.id.toLowerCase() === `native:${name}`,
    );
    if (captures.length !== 1) return true;
    const capture = captures[0]!;
    if (capture.imaginary !== undefined && capture.imaginary !== 0) return true;
    if (capture.value === report.value) return false;
    // ngspice's Console commonly rounds more aggressively than its rawfile.
    // Match only the precision explicitly printed in this report, not an epsilon.
    const token =
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?=\s|$)/u.exec(
        report.detail,
      );
    if (
      !token ||
      token[1]!.toLowerCase() !== name ||
      Number(token[2]) !== report.value
    )
      return true;
    const digits = token[2]!
      .split(/[eE]/u)[0]!
      .replace(/[^\d]/gu, "")
      .replace(/^0+/u, "").length;
    return (
      digits < 1 ||
      digits > 100 ||
      Number(capture.value.toPrecision(digits)) !== report.value
    );
  });
}
