import { z } from "zod";
import { SimulationResultSchema } from "@icm/spice-run";
import {
  ObjectLocatorSchema,
  SimulationEnvironmentSelectionSchema,
  SimulationMeasurementSpecSchema,
} from "@icm/model";
import type {
  CompiledSimulationDeviceOperatingPoint,
  CompiledSimulationExpression,
  CompiledSimulationOutput,
} from "@icm/netlist";

export const Id = z.string().min(1).max(256);
export const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const EnvironmentSchema = SimulationEnvironmentSelectionSchema;
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
export const CompiledOutputExpressionSchema: z.ZodType<CompiledSimulationExpression> =
  z.lazy(() =>
    z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("acquisition"),
        acquisitionId: Id,
        quantity: z.enum(["voltage", "current"]),
      }),
      z.strictObject({
        kind: z.literal("constant"),
        value: z.number().finite(),
        unit: z.string().min(1).optional(),
      }),
      ...(
        [
          "negate",
          "magnitude",
          "db20",
          "phase",
          "real",
          "imaginary",
          "absolute",
        ] as const
      ).map((kind) =>
        z.strictObject({
          kind: z.literal(kind),
          operand: CompiledOutputExpressionSchema,
        }),
      ),
      ...(["add", "subtract", "multiply", "divide"] as const).map((kind) =>
        z.strictObject({
          kind: z.literal(kind),
          left: CompiledOutputExpressionSchema,
          right: CompiledOutputExpressionSchema,
        }),
      ),
    ]),
  );
export const CompiledOutputSchema: z.ZodType<CompiledSimulationOutput> =
  z.strictObject({
    id: Id,
    label: z.string().min(1).max(128),
    expression: CompiledOutputExpressionSchema,
  });
export const CompiledDeviceOperatingPointSchema: z.ZodType<CompiledSimulationDeviceOperatingPoint> =
  z.strictObject({
    id: Id,
    documentId: Id,
    instanceId: Id,
    occurrence: z.array(Id),
    reference: z.string().min(1),
    polarity: z.enum(["nmos", "pmos"]),
    values: z.array(
      z.strictObject({
        parameter: z.enum(["vgs", "vds", "vbs", "id"]),
        label: z.enum(["VGS", "VDS", "VBS", "ID"]),
        unit: z.enum(["V", "A"]),
        expression: CompiledOutputExpressionSchema,
      }),
    ),
  });
export const PreparedSchema = z.strictObject({
  id: Id,
  digest: Digest,
  inputRevision: z.string(),
  expiresAt: z.number(),
  mode: z.enum(["structured", "raw"]),
  environment: EnvironmentSchema,
  vectors: z.array(VectorSchema),
  outputs: z.array(CompiledOutputSchema),
  deviceOperatingPoints: z.array(CompiledDeviceOperatingPointSchema),
  measurements: z.array(SimulationMeasurementSpecSchema).optional(),
  artifacts: z.array(ArtifactRefSchema),
  warnings: z.array(z.string()),
});
export type Prepared = z.infer<typeof PreparedSchema>;
export const OutputPointSchema = z.number().finite().nullable();
export const EvaluatedOutputSchema = z.strictObject({
  id: Id,
  label: z.string(),
  unit: z.string(),
  values: z.array(OutputPointSchema),
  imaginary: z.array(OutputPointSchema).optional(),
});
export const EvaluatedScalarSchema = z.strictObject({
  id: Id,
  label: z.string(),
  unit: z.string(),
  value: z.number().finite(),
});
export const EvaluatedAnalysisSchema = z.strictObject({
  analysis: z.enum(["op", "dc", "ac", "tran", "noise"]),
  plotName: z.string(),
  domain: z
    .strictObject({
      name: z.string(),
      unit: z.string(),
      values: z.array(z.number().finite()),
    })
    .optional(),
  outputs: z.array(EvaluatedOutputSchema),
  /** Analysis-owned scalar results, such as integrated input/output noise. */
  integrated: z.array(EvaluatedScalarSchema).optional(),
});
export const AutomaticMeasurementSchema = z.discriminatedUnion("status", [
  z.strictObject({
    id: Id,
    analysisIndex: z.number().int().nonnegative(),
    analysis: z.enum(["op", "dc", "ac", "tran", "noise"]),
    plotName: z.string(),
    outputId: Id,
    outputLabel: z.string(),
    metric: z.enum([
      "operating-point",
      "minimum",
      "maximum",
      "peak-to-peak",
      "time-mean",
      "time-rms",
      "sample-at",
    ]),
    label: z.string(),
    unit: z.string(),
    origin: z.enum(["automatic", "authored"]).optional(),
    measurementId: Id.optional(),
    evidence: z
      .union([
        z.strictObject({ kind: z.literal("point"), coordinate: z.number() }),
        z.strictObject({
          kind: z.literal("window"),
          start: z.number(),
          stop: z.number(),
        }),
      ])
      .optional(),
    status: z.literal("available"),
    value: z.number().finite(),
  }),
  z.strictObject({
    id: Id,
    analysisIndex: z.number().int().nonnegative(),
    analysis: z.enum(["op", "dc", "ac", "tran", "noise"]),
    plotName: z.string(),
    outputId: Id,
    outputLabel: z.string(),
    metric: z.enum([
      "operating-point",
      "minimum",
      "maximum",
      "peak-to-peak",
      "time-mean",
      "time-rms",
      "sample-at",
    ]),
    label: z.string(),
    unit: z.string(),
    origin: z.enum(["automatic", "authored"]).optional(),
    measurementId: Id.optional(),
    evidence: z
      .union([
        z.strictObject({ kind: z.literal("point"), coordinate: z.number() }),
        z.strictObject({
          kind: z.literal("window"),
          start: z.number(),
          stop: z.number(),
        }),
      ])
      .optional(),
    status: z.literal("unavailable"),
    reason: z.string(),
  }),
]);
export const SimulationOutputDataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  analyses: z.array(EvaluatedAnalysisSchema),
  measurements: z.array(AutomaticMeasurementSchema).optional(),
  deviceOperatingPoints: z
    .array(
      z.strictObject({
        id: Id,
        documentId: Id,
        instanceId: Id,
        occurrence: z.array(Id),
        reference: z.string(),
        polarity: z.enum(["nmos", "pmos"]),
        values: z.array(
          z.discriminatedUnion("status", [
            z.strictObject({
              parameter: Id,
              label: z.string(),
              unit: z.string(),
              status: z.literal("available"),
              value: z.number().finite(),
            }),
            z.strictObject({
              parameter: Id,
              label: z.string(),
              unit: z.string(),
              status: z.literal("unavailable"),
              reason: z.string(),
            }),
          ]),
        ),
      }),
    )
    .optional(),
  diagnostics: z.array(
    z.strictObject({ outputId: Id, code: Id, message: z.string() }),
  ),
});
export type SimulationOutputData = z.infer<typeof SimulationOutputDataSchema>;
export const InputSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("project-setup"),
    setupId: Id,
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
  analyses: z.array(z.enum(["op", "dc", "ac", "tran", "noise"])),
  parsedAnalyses: z.array(z.enum(["op", "dc", "ac", "tran", "noise"])),
  profiles: z.array(
    z.strictObject({
      id: Id,
      /** Human-facing name. Automation continues to select the stable id. */
      label: z.string().min(1).max(128).optional(),
      corners: z.array(z.string()),
      /** Exact model or wrapper names qualified on this hosted environment. */
      devices: z.array(z.string().min(1).max(256)).optional(),
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
  outputData: SimulationOutputDataSchema.optional(),
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
