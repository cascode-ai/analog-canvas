import { z } from "zod";
import { SimulationResultSchema } from "@icm/spice-run";
import { ObjectLocatorSchema } from "@icm/model";

export const Id = z.string().min(1).max(256);
export const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const EnvironmentSchema = z.strictObject({
  profileId: Id,
  corner: z.string().min(1).optional(),
  temperatureC: z.number().finite().optional(),
});
export const ProblemSchema = z.strictObject({
  code: Id,
  message: z.string(),
  stage: z.enum(["input", "prepare", "start", "read", "cancel", "export"]),
  recovery: z.enum([
    "fix-input",
    "reprepare",
    "retry-same-request",
    "retry-after",
    "reauthorize",
    "not-retryable",
  ]),
  retryAfterMs: z.number().nonnegative().optional(),
  correlationId: Id.optional(),
  diagnostics: z
    .array(
      z.strictObject({
        code: Id,
        message: z.string(),
        severity: z.enum(["error", "warning", "info"]),
        primary: ObjectLocatorSchema.optional(),
        field: z.string().optional(),
      }),
    )
    .optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;
export function problem(
  code: string,
  message: string,
  stage: Problem["stage"],
  recovery: Problem["recovery"] = "fix-input",
): { ok: false; error: Problem } {
  return { ok: false, error: { code, message, stage, recovery } };
}
export const ArtifactRefSchema = z.strictObject({
  id: Id,
  name: z.string(),
  mediaType: z.string(),
  byteLength: z.number().int().nonnegative(),
  sha256: Digest,
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export const VectorSchema = z.strictObject({
  probeId: Id,
  vector: z.string(),
  quantity: z.enum(["voltage", "current"]),
});
export const PreparedSchema = z.strictObject({
  id: Id,
  digest: Digest,
  inputRevision: z.string(),
  expiresAt: z.number(),
  mode: z.enum(["structured", "raw"]),
  environment: EnvironmentSchema,
  vectors: z.array(VectorSchema),
  artifacts: z.array(ArtifactRefSchema),
  warnings: z.array(z.string()),
});
export type Prepared = z.infer<typeof PreparedSchema>;
export const InputSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("project-setup"),
    expectedStructureRevision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("workspace"),
    workspaceId: Id,
    expectedRevision: z.number().int().nonnegative(),
    environment: EnvironmentSchema.pick({ profileId: true }),
  }),
]);
export const SimulationOperationSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("capabilities") }),
  z.strictObject({
    operation: z.literal("prepare"),
    source: InputSourceSchema,
  }),
  z.strictObject({
    operation: z.literal("start"),
    preparedId: Id,
    digest: Digest,
    timeoutMs: z.number().int().positive().max(120000).optional(),
  }),
  z.strictObject({ operation: z.literal("read"), runId: Id }),
  z.strictObject({ operation: z.literal("cancel"), runId: Id }),
  z.strictObject({
    operation: z.literal("export"),
    preparedId: Id.optional(),
    runId: Id.optional(),
  }),
]);
export type SimulationOperation = z.infer<typeof SimulationOperationSchema>;
export const CapabilitiesSchema = z.strictObject({
  configured: z.boolean(),
  inputs: z.array(z.enum(["structured", "raw"])),
  analyses: z.array(z.enum(["op", "ac", "tran"])),
  parsedAnalyses: z.array(z.enum(["op", "ac", "tran"])),
  profiles: z.array(
    z.strictObject({
      id: Id,
      corners: z.array(z.string()),
      /** Environment-owned files addressable by raw Project dependencies. */
      dependencies: z
        .array(z.strictObject({ id: Id, sha256: Digest }))
        .optional(),
    }),
  ),
  modelLibrary: z
    .strictObject({ path: z.string(), section: z.string() })
    .optional(),
  maxTimeoutMs: z.number(),
  maxInputBytes: z.number(),
  /** Maximum raw simulator output returned by the selected execution harness. */
  maxOutputBytes: z.number().int().positive().optional(),
  cancel: z.boolean(),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
export const RunSchema = z.strictObject({
  id: z.string(),
  preparedId: z.string(),
  inputRevision: z.string(),
  state: z.enum(["running", "cancelling", "finished", "cancelled", "lost"]),
  inputStatus: z.enum(["unchanged", "changed", "unavailable"]).optional(),
  resultPreview: z.boolean().optional(),
  result: SimulationResultSchema.optional(),
  error: ProblemSchema.optional(),
  artifacts: z.array(ArtifactRefSchema),
});
export type Run = z.infer<typeof RunSchema>;
export const SimulationReplySchema = z.union([
  z.strictObject({ ok: z.literal(false), error: ProblemSchema }),
  z.strictObject({ ok: z.literal(true), capabilities: CapabilitiesSchema }),
  z.strictObject({ ok: z.literal(true), prepared: PreparedSchema }),
  z.strictObject({ ok: z.literal(true), run: RunSchema }),
  z.strictObject({
    ok: z.literal(true),
    artifacts: z.array(ArtifactRefSchema),
  }),
]);
export type SimulationReply = z.infer<typeof SimulationReplySchema>;
