import { z } from "zod";
import {
  SimulationRawPlotOrdinalsSchema,
  SimulationPostprocessorOriginSchema,
} from "@icm/spice-run";
import { SimulationRunVariantSchema } from "@icm/model";
import { SimulationResultSchema } from "@icm/spice-run";
import {
  ObjectLocatorSchema,
  SimulationRunPlanAxisSchema,
  SimulationEnvironmentSelectionSchema,
  SimulationMeasurementSpecSchema,
  SourceSpanSchema,
} from "@icm/model";
import type {
  CompiledSimulationDeviceOperatingPoint,
  CompiledSimulationExpression,
  CompiledSimulationOutput,
  NativeModelLibrarySymbols,
} from "@icm/netlist";

export const Id = z.string().min(1).max(256);
export const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const EnvironmentSchema = SimulationEnvironmentSelectionSchema;
export const SimulationSourceLocationSchema = z.strictObject({
  scope: z.enum(["authored", "generated", "prepared"]),
  path: z.string(),
  textDigest: Digest,
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});
export type SimulationSourceLocation = z.infer<
  typeof SimulationSourceLocationSchema
>;
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
  currentRevision: z.number().int().nonnegative().optional(),
  fileEdit: z
    .strictObject({
      applied: z.literal(false),
      path: z.string().optional(),
      operationIndex: z.number().int().nonnegative().optional(),
      operation: z.enum(["replace", "patch", "write", "remove"]).optional(),
      matchCount: z.number().int().nonnegative().optional(),
      expectedRevision: z.number().int().nonnegative().optional(),
    })
    .optional(),
  diagnostics: z
    .array(
      z.strictObject({
        code: Id,
        message: z.string(),
        severity: z.enum(["error", "warning", "info"]),
        primary: ObjectLocatorSchema.optional(),
        field: z.string().optional(),
        path: z.string().optional(),
        sourceRef: SourceSpanSchema.optional(),
        source: SimulationSourceLocationSchema.optional(),
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
  /** Stable evidence identity; id is the current session's read locator. */
  fileId: Id.optional(),
  name: z.string(),
  mediaType: z.string(),
  byteLength: z.number().int().nonnegative(),
  sha256: Digest,
  /** Producer-assigned semantics; optional only for historical archives. */
  role: z
    .enum([
      "source",
      "prepared",
      "source-map",
      "execution-input",
      "executed",
      "raw",
      "result",
      "table",
      "specs",
      "log",
      "diagnostics",
      "manifest",
    ])
    .optional(),
  sourcePath: z.string().optional(),
  analysisIndex: z.number().int().nonnegative().optional(),
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export const SimulationSignalTargetsSchema = z.record(
  z.string(),
  z.array(
    z.strictObject({
      rootDocumentId: Id,
      documentId: Id,
      netId: Id,
      occurrence: z.array(Id),
      terminal: z
        .strictObject({ instanceId: Id, pinName: z.string().min(1).max(128) })
        .optional(),
    }),
  ),
);
export const ResultCatalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: Id,
  preparedId: Id,
  inputRevision: z.string(),
  signalTargets: SimulationSignalTargetsSchema.optional(),
  execution: z.enum([
    "pending",
    "completed",
    "completed-with-dropped-input",
    "failed",
    "timed-out",
    "cancelled",
    "lost",
  ]),
  collection: z.enum(["pending", "complete", "partial"]),
  error: ProblemSchema.optional(),
  files: z.array(ArtifactRefSchema),
  datasets: z.array(
    z.strictObject({
      id: Id,
      analysisIndex: z.number().int().nonnegative(),
      analysis: z.enum(["op", "dc", "ac", "tran", "noise"]),
      plotName: z.string(),
      pointCount: z.number().int().nonnegative(),
      axis: z
        .strictObject({ name: z.string(), unit: z.string().nullable() })
        .optional(),
      signals: z.array(
        z.strictObject({
          name: z.string(),
          quantity: z.string(),
          unit: z.string().nullable(),
        }),
      ),
      scalars: z
        .array(
          z.strictObject({
            name: z.string(),
            quantity: z.string(),
            unit: z.string().nullable(),
            representations: z.array(
              z.strictObject({
                artifactId: Id,
                fileId: Id,
                selector: z.string(),
              }),
            ),
          }),
        )
        .optional(),
      representations: z.array(
        z.strictObject({
          artifactId: Id,
          fileId: Id,
          selector: z.string(),
        }),
      ),
    }),
  ),
});
export type ResultCatalog = z.infer<typeof ResultCatalogSchema>;
export const SimulationHistoryEntrySchema = ResultCatalogSchema.pick({
  runId: true,
  preparedId: true,
  inputRevision: true,
  execution: true,
  collection: true,
}).extend({
  storedAt: z.number(),
  storage: z.enum(["persistent", "memory"]),
});
export type SimulationHistoryEntry = z.infer<
  typeof SimulationHistoryEntrySchema
>;
export const VectorSchema = z.strictObject({
  probeId: Id,
  vector: z.string(),
  quantity: z.enum(["voltage", "current", "native"]),
});
export const CompiledOutputExpressionSchema: z.ZodType<CompiledSimulationExpression> =
  z.lazy(() =>
    z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("acquisition"),
        acquisitionId: Id,
        quantity: z.enum(["voltage", "current", "native"]),
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
        parameter: z.enum([
          "vgs",
          "vds",
          "vbs",
          "id",
          "gm",
          "gds",
          "gmbs",
          "vth",
          "vdsat",
        ]),
        label: z.string(),
        unit: z.enum(["V", "A", "S"]),
        expression: CompiledOutputExpressionSchema,
      }),
    ),
  });
export const PreparedSchema = z.strictObject({
  id: Id,
  digest: Digest,
  inputRevision: z.string(),
  expiresAt: z.number(),
  // Historical receipts may still be read; new preparations always use source.
  mode: z.enum(["source", "structured", "raw"]),
  environment: EnvironmentSchema,
  vectors: z.array(VectorSchema),
  signalNames: z.record(z.string(), z.string()).optional(),
  /** Canvas addresses captured with the prepared input, never resolved by display label. */
  signalTargets: SimulationSignalTargetsSchema.optional(),
  outputs: z.array(CompiledOutputSchema),
  deviceOperatingPoints: z.array(CompiledDeviceOperatingPointSchema),
  measurements: z.array(SimulationMeasurementSpecSchema).optional(),
  artifacts: z.array(ArtifactRefSchema),
  warnings: z.array(z.string()),
});
export type Prepared = z.infer<typeof PreparedSchema>;
export const OutputPointSchema = z.number().finite().nullable();
/** Meaning is distinct from raw AC storage (a real expression may have zero imaginary samples). */
export const OutputSemanticsSchema = z.strictObject({
  valueKind: z.enum(["real", "complex", "unknown"]),
  quantity: z.string(),
  origin: z.enum(["raw", "expression"]),
  expression: z.string().optional(),
});
export type OutputSemantics = z.infer<typeof OutputSemanticsSchema>;
export const EvaluatedOutputSchema = z.strictObject({
  id: Id,
  label: z.string(),
  unit: z.string(),
  values: z.array(OutputPointSchema),
  imaginary: z.array(OutputPointSchema).optional(),
  semantics: OutputSemanticsSchema.optional(),
});
export const EvaluatedScalarSchema = z.strictObject({
  id: Id,
  label: z.string(),
  unit: z.string(),
  value: z.number().finite(),
  imaginary: z.number().finite().optional(),
  semantics: OutputSemanticsSchema.optional(),
});
export const EvaluatedAnalysisSchema = z.strictObject({
  postprocessor: SimulationPostprocessorOriginSchema.optional(),
  rawPlotOrdinals: SimulationRawPlotOrdinalsSchema.optional(),
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
  /** Captured single values, not sweep samples or automatic waveform measurements. */
  scalars: z.array(EvaluatedScalarSchema).optional(),
  /** Analysis-owned scalar results, such as integrated input/output noise. */
  integrated: z.array(EvaluatedScalarSchema).optional(),
});
export const AutomaticMeasurementSchema = z.discriminatedUnion("status", [
  z.strictObject({
    rawPlotOrdinals: SimulationRawPlotOrdinalsSchema.optional(),
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
    rawPlotOrdinals: SimulationRawPlotOrdinalsSchema.optional(),
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
import { SimulationSpecReportSchema } from "./spec-contract.js";
export {
  SimulationSpecReportSchema,
  SimulationSpecResultSchema,
  SimulationSpecConditionSchema,
  formatSimulationSpec,
  type SimulationSpecReport,
  type SimulationSpecResult,
  type SimulationSpecCondition,
} from "./spec-contract.js";

export const SimulationOutputDataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  specs: SimulationSpecReportSchema.optional(),
  nativeMeasurements: z
    .array(
      z.discriminatedUnion("status", [
        z.strictObject({
          name: z.string(),
          occurrence: z.number().int().positive(),
          status: z.literal("available"),
          value: z.number().finite(),
          logLine: z.number().int().positive(),
          detail: z.string(),
          unit: z.string().optional(),
          origin: z.literal("postprocessor").optional(),
        }),
        z.strictObject({
          name: z.string(),
          occurrence: z.literal(0),
          status: z.literal("unavailable"),
          detail: z.string(),
          unit: z.string().optional(),
          origin: z.literal("postprocessor").optional(),
        }),
      ]),
    )
    .optional(),
  analyses: z.array(EvaluatedAnalysisSchema),
  measurements: z.array(AutomaticMeasurementSchema).optional(),
  deviceOperatingPoints: z
    .array(
      z.strictObject({
        analysisIndex: z.number().int().nonnegative().optional(),
        rawPlotOrdinals: SimulationRawPlotOrdinalsSchema.optional(),
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
    z.strictObject({
      outputId: Id,
      code: Id,
      message: z.string(),
      analysisIndex: z.number().int().nonnegative().optional(),
      rawPlotOrdinals: SimulationRawPlotOrdinalsSchema.optional(),
    }),
  ),
});
export type SimulationOutputData = z.infer<typeof SimulationOutputDataSchema>;
export const InputSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("project-folder"),
    folderId: Id,
    expectedStructureRevision: z.number().int().nonnegative(),
    variant: SimulationRunVariantSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("workspace"),
    workspaceId: Id,
    expectedRevision: z.number().int().nonnegative(),
  }),
]);
export const SimulationBatchItemRequestSchema = z.strictObject({
  id: Id,
  folderId: Id,
});
/** The transient service consumes the same sweep-axis contract persisted by a Setup. */
export const SimulationSweepAxisSchema = SimulationRunPlanAxisSchema;
export const SimulationOperationSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("authoring-help"),
    profileId: Id.optional(),
    name: z.string().min(1).max(128).optional(),
    context: z.enum(["circuit", "control"]).optional(),
  }),
  z.strictObject({
    operation: z.literal("capabilities"),
    detail: z.enum(["summary", "full"]).optional(),
    profileId: Id.optional(),
  }),
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
  z.strictObject({
    operation: z.literal("catalog"),
    runId: Id,
    section: z.enum(["files", "datasets"]).optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  }),
  z.strictObject({
    operation: z.literal("history"),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: Id.optional(),
  }),
  z.strictObject({ operation: z.literal("cancel"), runId: Id }),
  z
    .strictObject({
      operation: z.literal("prepare-batch"),
      expectedStructureRevision: z.number().int().nonnegative(),
      items: z.array(SimulationBatchItemRequestSchema).min(1).max(16),
    })
    .superRefine((request, context) => {
      const ids = new Set<string>();
      for (const [index, item] of request.items.entries()) {
        if (ids.has(item.id)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate batch item id: ${item.id}`,
            path: ["items", index, "id"],
          });
        }
        ids.add(item.id);
      }
    }),
  z
    .strictObject({
      operation: z.literal("prepare-sweep"),
      folderId: Id,
      expectedStructureRevision: z.number().int().nonnegative(),
      axes: z.array(SimulationSweepAxisSchema).min(1).max(4),
    })
    .superRefine((request, context) => {
      const identities = new Set<string>();
      let points = 1;
      for (const [index, axis] of request.axes.entries()) {
        const identity =
          axis.kind === "variable"
            ? `${axis.kind}:${axis.variableId}`
            : axis.kind === "parameter"
              ? `${axis.kind}:${axis.documentId}:${axis.instanceId}:${axis.parameter.toLowerCase()}`
              : axis.kind;
        if (identities.has(identity)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate sweep axis: ${identity}`,
            path: ["axes", index],
          });
        }
        identities.add(identity);
        points *= axis.values.length;
      }
      if (points > 16) {
        context.addIssue({
          code: "custom",
          message: `Sweep expands to ${points} points; maximum is 16`,
          path: ["axes"],
        });
      }
    }),
  z.strictObject({
    operation: z.literal("start-batch"),
    batchId: Id,
    timeoutMs: z.number().int().positive().max(120000).optional(),
  }),
  z.strictObject({ operation: z.literal("read-batch"), batchId: Id }),
  z.strictObject({ operation: z.literal("cancel-batch"), batchId: Id }),
  z.strictObject({
    operation: z.literal("export"),
    preparedId: Id.optional(),
    runId: Id.optional(),
  }),
]);
export type SimulationOperation = z.infer<typeof SimulationOperationSchema>;
export const NativeModelLibrarySymbolsSchema: z.ZodType<NativeModelLibrarySymbols> =
  z.strictObject({
    dependencyId: Id,
    sha256: Digest,
    section: z.string().min(1).max(128).optional(),
    masters: z
      .array(
        z.strictObject({
          name: Id,
          primitives: z
            .array(
              z.strictObject({
                path: z.array(Id).max(64),
                module: Id,
              }),
            )
            .max(256),
        }),
      )
      .max(256),
  });
export const CapabilitiesSchema = z.strictObject({
  discovery: z
    .strictObject({
      detail: z.enum(["summary", "full"]),
      fullRequest: z.strictObject({
        operation: z.literal("capabilities"),
        detail: z.literal("full"),
        profileId: Id.optional(),
      }),
    })
    .optional(),
  configured: z.boolean(),
  /** Explicit collection protocol; absent on pre-source deployments. */
  rawfileCollection: z
    .enum(["native-multi-ascii", "declared-single-ascii"])
    .optional(),
  maxInputFiles: z.number().int().positive().optional(),
  inputs: z.array(z.enum(["source", "structured", "raw"])),
  analyses: z.array(z.enum(["op", "dc", "ac", "tran", "noise"])),
  parsedAnalyses: z.array(z.enum(["op", "dc", "ac", "tran", "noise"])),
  profiles: z.array(
    z
      .strictObject({
        id: Id,
        /** Human-facing name. Automation continues to select the stable id. */
        label: z.string().min(1).max(128).optional(),
        /** Execution dialect owned by this Profile, never inferred from filenames. */
        engine: z.enum(["ngspice", "vacask"]).optional(),
        corners: z.array(z.string()),
        /** Exact model or wrapper names qualified on this hosted environment. */
        devices: z.array(z.string().min(1).max(256)).optional(),
        /** Environment-owned files addressable by raw Project dependencies. */
        dependencies: z
          .array(z.strictObject({ id: Id, sha256: Digest }))
          .optional(),
        /** Read-only names derived from exact dependency bytes, not model definitions. */
        modelSymbols: z
          .array(NativeModelLibrarySymbolsSchema)
          .max(32)
          .optional(),
        /** Native loading policy references an advertised dependency, not a host path. */
        modelLibrary: z
          .strictObject({
            dependencyId: Id,
            defaultSection: z.string().min(1).optional(),
            /** Native initial option for this library, not a Canvas length conversion.
             * Authored options/clear keep their normal subsequent semantics. */
            defaultScale: z.number().positive().optional(),
          })
          .optional(),
      })
      .superRefine((profile, context) => {
        const seen = new Set<string>();
        for (const [index, library] of (profile.modelSymbols ?? []).entries()) {
          const key = JSON.stringify([library.dependencyId, library.section]);
          if (
            seen.has(key) ||
            !profile.dependencies?.some(
              (d) =>
                d.id === library.dependencyId && d.sha256 === library.sha256,
            ) ||
            new Set(library.masters.map((m) => m.name)).size !==
              library.masters.length ||
            library.masters.some(
              (m) =>
                new Set(m.primitives.map((p) => JSON.stringify(p.path)))
                  .size !== m.primitives.length,
            )
          )
            context.addIssue({
              code: "custom",
              path: ["modelSymbols", index],
              message:
                "Model symbols require one matching dependency digest and unambiguous master/primitive identities",
            });
          seen.add(key);
        }
      }),
  ),
  modelLibrary: z
    .strictObject({ path: z.string(), section: z.string() })
    .optional(),
  maxTimeoutMs: z.number(),
  maxInputBytes: z.number(),
  /** Maximum raw simulator output returned by the selected execution harness. */
  maxOutputBytes: z.number().int().positive().optional(),
  /** Effective number of simultaneously active runs admitted by this session. */
  maxActiveRuns: z.number().int().positive().optional(),
  cancel: z.boolean(),
  batch: z
    .strictObject({
      maxItems: z.number().int().positive(),
      execution: z.literal("sequential"),
      sweepAxes: z.tuple([
        z.literal("corner"),
        z.literal("temperature"),
        z.literal("variable"),
        z.literal("parameter"),
      ]),
    })
    .optional(),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
export const RunSchema = z.strictObject({
  id: z.string(),
  preparedId: z.string(),
  inputRevision: z.string(),
  state: z.enum(["running", "cancelling", "finished", "cancelled", "lost"]),
  inputStatus: z.enum(["unchanged", "changed", "unavailable"]).optional(),
  resultPreview: z.boolean().optional(),
  details: z
    .strictObject({
      operation: z.literal("catalog"),
      runId: Id,
      execution: ResultCatalogSchema.shape.execution.optional(),
      collection: ResultCatalogSchema.shape.collection.optional(),
      datasetCount: z.number().int().nonnegative().optional(),
      fileCount: z.number().int().nonnegative().optional(),
      diagnostics: z
        .strictObject({
          total: z.number().int().nonnegative(),
          shown: z.number().int().nonnegative(),
          textMayBeShortened: z.boolean(),
        })
        .optional(),
      outputDiagnostics: z.number().int().nonnegative().optional(),
      specs: z
        .strictObject({
          available: z.boolean(),
          total: z.number().int().nonnegative(),
          passed: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
          notEvaluated: z.number().int().nonnegative(),
          unconstrained: z.number().int().nonnegative(),
        })
        .optional(),
    })
    .optional(),
  catalog: ResultCatalogSchema.optional(),
  result: SimulationResultSchema.optional(),
  outputData: SimulationOutputDataSchema.optional(),
  error: ProblemSchema.optional(),
  artifacts: z.array(ArtifactRefSchema),
});
export type Run = z.infer<typeof RunSchema>;
export const SimulationBatchItemSchema = z.strictObject({
  id: Id,
  folderId: Id,
  label: z.string().min(1).max(256).optional(),
  prepared: PreparedSchema,
  state: z.enum([
    "prepared",
    "queued",
    "running",
    "finished",
    "failed",
    "cancelled",
    "lost",
  ]),
  runId: Id.optional(),
  error: ProblemSchema.optional(),
});
export const SimulationBatchSchema = z.strictObject({
  id: Id,
  state: z.enum([
    "prepared",
    "running",
    "cancelling",
    "finished",
    "failed",
    "cancelled",
  ]),
  createdAt: z.number(),
  expiresAt: z
    .number()
    .nullable()
    .describe(
      "Unused preparation expiry; null after completion. Not an evidence retention deadline.",
    ),
  items: z.array(SimulationBatchItemSchema).min(1).max(16),
});
export type SimulationBatch = z.infer<typeof SimulationBatchSchema>;
export const SimulationReplySchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    helpers: z.array(
      z.strictObject({
        name: z.string(),
        context: z.enum(["circuit", "control"]),
        signature: z.string(),
        summary: z.string(),
        reference: z.string(),
        source: z.string(),
      }),
    ),
  }),
  z.strictObject({ ok: z.literal(false), error: ProblemSchema }),
  z.strictObject({ ok: z.literal(true), capabilities: CapabilitiesSchema }),
  z.strictObject({ ok: z.literal(true), prepared: PreparedSchema }),
  z.strictObject({ ok: z.literal(true), run: RunSchema }),
  z.strictObject({
    ok: z.literal(true),
    catalog: ResultCatalogSchema,
    page: z
      .strictObject({
        section: z.enum(["files", "datasets"]),
        total: z.number().int().nonnegative(),
        nextOffset: z.number().int().nonnegative().nullable(),
      })
      .optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    runs: z.array(SimulationHistoryEntrySchema),
    nextCursor: Id.nullable(),
  }),
  z.strictObject({ ok: z.literal(true), batch: SimulationBatchSchema }),
  z.strictObject({
    ok: z.literal(true),
    artifacts: z.array(ArtifactRefSchema),
  }),
]);
export type SimulationReply = z.infer<typeof SimulationReplySchema>;
