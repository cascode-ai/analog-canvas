import { VACASK_MEASUREMENT_PREFIX } from "@icm/netlist";
import { z } from "zod";
import type { SimulationOutputData } from "./contract.js";

const identity = {
  name: z.string().min(1).max(128),
  unit: z.string().max(64).optional(),
};
const Report = z.discriminatedUnion("status", [
  z.strictObject({
    ...identity,
    status: z.literal("available"),
    value: z.number().finite(),
  }),
  z.strictObject({
    ...identity,
    status: z.literal("unavailable"),
    detail: z.string().max(1024),
  }),
]);

/** Read only explicitly framed postprocessor reports. Never infer a value/unit
 * from arbitrary stdout, execute Python here, or invent a raw plot association.
 * Units are author-declared; origin and exact console line retain that distinction.
 * Malformed records do not discard preceding or subsequent valid measurements. */
export function vacaskMeasurementResults(log: string, numbersAllowed = true) {
  const measurements: NonNullable<SimulationOutputData["nativeMeasurements"]> =
    [];
  const diagnostics: SimulationOutputData["diagnostics"] = [];
  const counts = new Map<string, number>();
  log.split(/\r?\n/u).forEach((line, index) => {
    if (!line.startsWith(VACASK_MEASUREMENT_PREFIX)) return;
    try {
      if (line.length > 16384) throw Error("Report exceeds the line limit");
      const report = Report.parse(
        JSON.parse(line.slice(VACASK_MEASUREMENT_PREFIX.length)),
      );
      const base = {
        name: report.name,
        ...(report.unit === undefined ? {} : { unit: report.unit }),
        origin: "postprocessor" as const,
      };
      if (report.status === "unavailable" || !numbersAllowed) {
        measurements.push({
          ...base,
          status: "unavailable",
          occurrence: 0,
          detail:
            report.status === "unavailable"
              ? report.detail
              : "Reported value withheld because the simulator dropped input.",
        });
        return;
      }
      const occurrence = (counts.get(report.name) ?? 0) + 1;
      counts.set(report.name, occurrence);
      measurements.push({
        ...base,
        status: "available",
        value: report.value,
        occurrence,
        logLine: index + 1,
        detail: line,
      });
    } catch {
      diagnostics.push({
        outputId: "native-measurements",
        code: "VACASK_MEASUREMENT_INVALID",
        message: `Invalid or incomplete native measurement report on Console line ${index + 1}; inspect the retained log.`,
      });
    }
  });
  return { measurements, diagnostics };
}
