import { z } from "zod";

export const SimulationSpecConditionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("limit"),
    operator: z.enum(["<", "<=", ">", ">="]),
    value: z.number().finite(),
  }),
  z.strictObject({
    kind: z.literal("range"),
    minimum: z.number().finite(),
    maximum: z.number().finite(),
  }),
  z.strictObject({
    kind: z.literal("target"),
    value: z.number().finite(),
    tolerance: z.number().finite().nonnegative(),
  }),
]);
export const SimulationSpecResultSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  occurrence: z.number().int().nonnegative(),
  source: z.strictObject({
    path: z.string(),
    line: z.number().int().positive(),
    text: z.string(),
  }),
  unit: z.string(),
  expected: SimulationSpecConditionSchema.nullable(),
  value: z.number().finite().nullable(),
  judgment: z.enum(["pass", "failed", "not-evaluated", "unconstrained"]),
  reason: z.enum([
    "satisfied",
    "outside-spec",
    "no-spec",
    "invalid-spec",
    "duplicate-spec",
    "ambiguous-measurement",
    "measurement-missing",
    "run-incomplete",
  ]),
  detail: z.string(),
  logLine: z.number().int().positive().nullable(),
});
export const SimulationSpecReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string(),
  preparedId: z.string(),
  inputDigest: z.string(),
  results: z.array(SimulationSpecResultSchema),
});
export type SimulationSpecCondition = z.infer<
  typeof SimulationSpecConditionSchema
>;
export type SimulationSpecResult = z.infer<typeof SimulationSpecResultSchema>;
export type SimulationSpecReport = z.infer<typeof SimulationSpecReportSchema>;

export function formatSimulationSpec(
  condition: SimulationSpecCondition | null,
): string {
  if (!condition) return "—";
  if (condition.kind === "limit")
    return `${condition.operator} ${condition.value}`;
  if (condition.kind === "range")
    return `[${condition.minimum}, ${condition.maximum}]`;
  return `${condition.value} ± ${condition.tolerance}`;
}
