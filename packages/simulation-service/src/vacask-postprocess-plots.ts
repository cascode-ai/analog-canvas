import { VACASK_PLOT_PREFIX } from "@icm/netlist";
import type {
  SimulationDiagnostic,
  VacaskPlotProjection,
} from "@icm/spice-run";
import { z } from "zod";

const name = z.string().min(1).max(256);
const probe = z.strictObject({
  name,
  quantity: name,
  unit: z.string().max(64).nullable(),
});
const common = {
  artifactPath: z
    .string()
    .min(1)
    .max(1024)
    .refine(
      (path) =>
        !/[\\:\u0000-\u001f]/u.test(path) &&
        path.endsWith(".raw") &&
        path
          .split("/")
          .every((part) => part !== "" && part !== "." && part !== ".."),
    ),
  plotOrdinal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  probes: z.array(probe).max(256),
};
const reportSchema = z.discriminatedUnion("analysis", [
  z.strictObject({ ...common, analysis: z.literal("op") }),
  z.strictObject({ ...common, analysis: z.literal("ac"), axis: name }),
  z.strictObject({ ...common, analysis: z.literal("tran"), axis: name }),
  z.strictObject({ ...common, analysis: z.literal("dc"), axis: probe }),
]);
const keyOf = (p: VacaskPlotProjection) =>
  JSON.stringify([p.artifactPath, p.plotOrdinal]);

/** Output declarations only. Never inspect/read a filesystem path from a report;
 * the bounded collector supplies the bytes. Authored meaning cannot replace a
 * source-derived analysis, and ambiguous repeated declarations map no record. */
export function vacaskPostprocessPlots(
  log: string,
  source: readonly VacaskPlotProjection[],
) {
  const reserved = new Set(source.map(keyOf));
  const reports = new Map<string, VacaskPlotProjection>();
  const duplicated = new Set<string>();
  const diagnostics: SimulationDiagnostic[] = [];
  log.split(/\r?\n/u).forEach((line, index) => {
    if (!line.startsWith(VACASK_PLOT_PREFIX)) return;
    try {
      if (line.length > 65536) throw Error("Report exceeds the line limit");
      const report = reportSchema.parse(
        JSON.parse(line.slice(VACASK_PLOT_PREFIX.length)),
      );
      const key = keyOf(report);
      if (reserved.has(key))
        throw Error("Cannot replace a source-derived record mapping");
      if (reports.has(key) || duplicated.has(key)) {
        reports.delete(key);
        duplicated.add(key);
        throw Error("Repeated record declaration is ambiguous");
      }
      reports.set(key, { ...report, postprocessor: { logLine: index + 1 } });
    } catch (error) {
      diagnostics.push({
        severity: "error",
        text: `VACASK_PLOT_INVALID at Console line ${index + 1}: ${error instanceof z.ZodError ? "Invalid plot declaration" : (error as Error).message}. Other valid records are retained.`,
      });
    }
  });
  return { projections: [...source, ...reports.values()], diagnostics };
}
