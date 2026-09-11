import { z } from "zod";

import { StableIdSchema } from "./common.js";
import { reportDuplicateIds } from "./validation.js";

/** Stable Noise result ids shared by Setup measurements, service, and clients. */
export const SIMULATION_NOISE_OUTPUT_DENSITY_ID = "noise-output-density";
export const SIMULATION_NOISE_INPUT_DENSITY_ID = "noise-input-density";

/**
 * Authored simulation intent persisted with the Project (ADR 0055, amended
 * 2026-09-04; `docs/specs/simulation.md`, "Persistence and compatibility").
 * A setup names what to run and where to look; results, run ids, receipts,
 * prepared decks, simulator paths, and caches are transient and never appear
 * here. Source values (DC, AC magnitude and phase, waveforms) live on the
 * source Instances in the Testbench Cell, never in the setup.
 */
export const SimulationOperatingPointAnalysisSchema = z.strictObject({
  kind: z.literal("op"),
});
export const SimulationAcAnalysisSchema = z
  .strictObject({
    kind: z.literal("ac"),
    /** `dec` and `oct` count points per interval; `lin` counts them in total. */
    sweep: z.enum(["dec", "oct", "lin"]),
    points: z.number().int().positive(),
    startHz: z.number().finite().positive(),
    stopHz: z.number().finite().positive(),
  })
  .refine((analysis) => analysis.stopHz > analysis.startHz, {
    message: "AC stop frequency must be greater than the start frequency",
    path: ["stopHz"],
  });
export const SimulationTransientAnalysisSchema = z
  .strictObject({
    kind: z.literal("tran"),
    /** Requested output interval, in seconds (`tstep` in ngspice). */
    stepSeconds: z.number().finite().positive(),
    /** End of the transient interval, in seconds (`tstop`). */
    stopSeconds: z.number().finite().positive(),
    /** Optional first saved time, in seconds (`tstart`); defaults to zero. */
    startSeconds: z.number().finite().nonnegative().optional(),
    /** Optional maximum internal timestep, in seconds (`tmax`). */
    maxStepSeconds: z.number().finite().positive().optional(),
  })
  .refine(
    (analysis) =>
      analysis.startSeconds === undefined ||
      analysis.stopSeconds > analysis.startSeconds,
    {
      message: "TRAN stop time must be greater than the start time",
      path: ["stopSeconds"],
    },
  );
export const SimulationDcAnalysisSchema = z
  .strictObject({
    kind: z.literal("dc"),
    /** Independent voltage/current source in the Testbench root Cell. */
    sourceInstanceId: StableIdSchema,
    startValue: z.number().finite(),
    stopValue: z.number().finite(),
    /** Positive magnitude; the compiler derives direction from start/stop. */
    stepValue: z.number().finite().positive(),
  })
  .refine((analysis) => analysis.stopValue !== analysis.startValue, {
    message: "DC stop value must differ from the start value",
    path: ["stopValue"],
  });

/**
 * Hierarchy Instance ids from the simulation root down to the Document that
 * owns the probed object; empty when that object is in the root itself.
 */
export const SimulationProbeOccurrenceSchema = z.array(StableIdSchema).max(64);

/**
 * A concrete object that locates a voltage measurement on its current Base
 * Net. The referenced object may later be deleted; that leaves an unresolved
 * authored probe for preparation to diagnose instead of making the Project
 * invalid or silently rebinding it.
 */
export const SimulationVoltageProbeAnchorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("terminal"),
    instanceId: StableIdSchema,
    pinName: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("junction"),
    junctionId: StableIdSchema,
  }),
  z.strictObject({ kind: z.literal("route"), routeId: StableIdSchema }),
  z.strictObject({
    /** Schema-39 fallback when no more durable attached object exists. */
    kind: z.literal("base-net"),
    netId: StableIdSchema,
  }),
]);

/** One hierarchy-aware voltage location, shared by Outputs and Noise. */
export const SimulationVoltageProbeSchema = z.strictObject({
  documentId: StableIdSchema,
  anchor: SimulationVoltageProbeAnchorSchema,
  occurrence: SimulationProbeOccurrenceSchema,
});

const SimulationVoltageExpressionSchema = SimulationVoltageProbeSchema.extend({
  kind: z.literal("voltage"),
});

export const SimulationNoiseAnalysisSchema = z
  .strictObject({
    kind: z.literal("noise"),
    output: z.strictObject({
      positive: SimulationVoltageProbeSchema,
      negative: SimulationVoltageProbeSchema.optional(),
    }),
    /** Independent voltage/current source in the Testbench root Cell. */
    inputSourceInstanceId: StableIdSchema,
    /** `dec` and `oct` count points per interval; `lin` counts them in total. */
    sweep: z.enum(["dec", "oct", "lin"]),
    points: z.number().int().positive(),
    startHz: z.number().finite().positive(),
    stopHz: z.number().finite().positive(),
  })
  .refine((analysis) => analysis.stopHz > analysis.startHz, {
    message: "Noise stop frequency must be greater than the start frequency",
    path: ["stopHz"],
  });

export const SimulationAnalysisSpecSchema = z.discriminatedUnion("kind", [
  SimulationOperatingPointAnalysisSchema,
  SimulationDcAnalysisSchema,
  SimulationAcAnalysisSchema,
  SimulationTransientAnalysisSchema,
  SimulationNoiseAnalysisSchema,
]);

const SimulationCurrentExpressionSchema = z.strictObject({
  kind: z.literal("current"),
  documentId: StableIdSchema,
  instanceId: StableIdSchema,
  /** Current entering this concrete Instance terminal. */
  pinName: z.string().min(1).max(128),
  occurrence: SimulationProbeOccurrenceSchema,
});

export type SimulationExpression =
  | z.infer<typeof SimulationVoltageExpressionSchema>
  | z.infer<typeof SimulationCurrentExpressionSchema>
  | { readonly kind: "constant"; readonly value: number }
  | {
      readonly kind:
        | "negate"
        | "magnitude"
        | "db20"
        | "phase"
        | "real"
        | "imaginary"
        | "absolute";
      readonly operand: SimulationExpression;
    }
  | {
      readonly kind: "add" | "subtract" | "multiply" | "divide";
      readonly left: SimulationExpression;
      readonly right: SimulationExpression;
    };

/**
 * A deliberately small, data-only expression language. It is evaluated by
 * Analog Canvas after ngspice returns primitive vectors; no authored text is
 * executed by JavaScript or passed through as an ngspice expression.
 */
export const SimulationExpressionSchema: z.ZodType<SimulationExpression> =
  z.lazy(() =>
    z.discriminatedUnion("kind", [
      SimulationVoltageExpressionSchema,
      SimulationCurrentExpressionSchema,
      z.strictObject({
        kind: z.literal("constant"),
        value: z.number().finite(),
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
          operand: SimulationExpressionSchema,
        }),
      ),
      ...(["add", "subtract", "multiply", "divide"] as const).map((kind) =>
        z.strictObject({
          kind: z.literal(kind),
          left: SimulationExpressionSchema,
          right: SimulationExpressionSchema,
        }),
      ),
    ]),
  );

export const SimulationOutputSpecSchema = z.strictObject({
  id: StableIdSchema,
  /** Authored display name used by plots and exports, never for binding. */
  label: z.string().trim().min(1).max(128),
  expression: SimulationExpressionSchema,
});

/**
 * One concrete MOS occurrence whose terminal-derived operating-point details
 * should be collected. The compiler resolves the device and its Bulk binding;
 * persisted setup state never stores simulator vector names or model-private
 * parameters.
 */
export const SimulationDeviceOperatingPointSpecSchema = z.strictObject({
  id: StableIdSchema,
  documentId: StableIdSchema,
  instanceId: StableIdSchema,
  occurrence: SimulationProbeOccurrenceSchema,
});

export const SimulationMeasurementWindowSchema = z
  .strictObject({
    /** Analysis-domain coordinate in SI units (V/A, Hz, or seconds). */
    start: z.number().finite(),
    /** Analysis-domain coordinate in SI units (V/A, Hz, or seconds). */
    stop: z.number().finite(),
  })
  .refine((window) => window.stop > window.start, {
    message: "Measurement window stop must be greater than start",
    path: ["stop"],
  });

export const SimulationMeasurementMethodSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("value") }),
  z.strictObject({
    kind: z.literal("sample-at"),
    /** Analysis-domain coordinate in SI units. */
    coordinate: z.number().finite(),
  }),
  ...(["minimum", "maximum", "peak-to-peak"] as const).map((kind) =>
    z.strictObject({
      kind: z.literal(kind),
      window: SimulationMeasurementWindowSchema.optional(),
    }),
  ),
  ...(["mean", "rms"] as const).map((kind) =>
    z.strictObject({
      kind: z.literal(kind),
      window: SimulationMeasurementWindowSchema,
    }),
  ),
]);

/** A saved rule that reduces one authored Output to one scalar per Run. */
export const SimulationMeasurementSpecSchema = z.strictObject({
  id: StableIdSchema,
  label: z.string().trim().min(1).max(128),
  analysis: z.enum(["op", "dc", "ac", "tran", "noise"]),
  outputId: StableIdSchema,
  method: SimulationMeasurementMethodSchema,
});

function expressionDepth(expression: SimulationExpression): number {
  if (
    expression.kind === "voltage" ||
    expression.kind === "current" ||
    expression.kind === "constant"
  )
    return 1;
  if (
    expression.kind === "add" ||
    expression.kind === "subtract" ||
    expression.kind === "multiply" ||
    expression.kind === "divide"
  )
    return (
      1 +
      Math.max(
        expressionDepth(expression.left),
        expressionDepth(expression.right),
      )
    );
  return "operand" in expression ? 1 + expressionDepth(expression.operand) : 1;
}

/**
 * Only the stable Profile ID plus the author's allowed selections. A Profile
 * manifest, model path, simulator digest, or measured fingerprint is resolved
 * at preparation time and reported by the run, never copied into the Project.
 */
export const SimulationEnvironmentSelectionSchema = z.strictObject({
  profileId: z.string().min(1).max(256),
  corner: z.string().min(1).max(64).optional(),
  temperatureC: z.number().finite().optional(),
});

/** One exact authored parameter controlled by a named Design Variable. */
export const SimulationDesignVariableBindingSchema = z.strictObject({
  documentId: StableIdSchema,
  instanceId: StableIdSchema,
  parameter: z.string().trim().min(1).max(128),
});

/**
 * A Setup-local scalar shared by one or more exact Instance parameters.
 * Values stay textual so the existing SPICE parameter grammar remains the
 * single authority for suffixes and expressions.
 */
export const SimulationDesignVariableSchema = z.strictObject({
  id: StableIdSchema,
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u, "Use a SPICE-compatible variable name"),
  value: z.string().trim().min(1).max(4096),
  bindings: z.array(SimulationDesignVariableBindingSchema).max(256),
});

export const SimulationRunPlanAxisSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("corner"),
    values: z.array(z.string().min(1).max(64)).min(1).max(64),
  }),
  z.strictObject({
    kind: z.literal("temperature"),
    values: z.array(z.number().finite()).min(1).max(64),
  }),
  z.strictObject({
    kind: z.literal("variable"),
    variableId: StableIdSchema,
    values: z.array(z.string().trim().min(1).max(4096)).min(1).max(64),
  }),
  z.strictObject({
    kind: z.literal("parameter"),
    documentId: StableIdSchema,
    instanceId: StableIdSchema,
    parameter: z.string().trim().min(1).max(128),
    values: z.array(z.string().trim().min(1).max(4096)).min(1).max(64),
  }),
]);

export const SimulationRunPlanSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("nominal") }),
  z
    .strictObject({
      mode: z.literal("sweep"),
      axes: z.array(SimulationRunPlanAxisSchema).min(1).max(4),
    })
    .superRefine((plan, context) => {
      const identities = new Set<string>();
      for (const [index, axis] of plan.axes.entries()) {
        const identity =
          axis.kind === "variable"
            ? `variable:${axis.variableId}`
            : axis.kind === "parameter"
              ? `parameter:${axis.documentId}:${axis.instanceId}:${axis.parameter.toLowerCase()}`
              : axis.kind;
        if (identities.has(identity)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate Run Plan axis: ${identity}`,
            path: ["axes", index],
          });
        }
        identities.add(identity);
      }
    }),
]);

/**
 * Raw simulation inputs use a virtual, relative namespace. The same rule is
 * shared by persisted setups and transient Agent workspaces; it never grants
 * access to a browser or host filesystem.
 */
export const MAX_SIMULATION_INPUT_FILES = 24;
export const MAX_SIMULATION_INPUT_BYTES = 1024 * 1024;
export function isSimulationInputPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 240 &&
    !path.startsWith("/") &&
    !/[\\:\u0000-\u001f]/u.test(path) &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..") &&
    path.toLowerCase() !== ".spiceinit"
  );
}
export const SimulationInputPathSchema = z
  .string()
  .refine(isSimulationInputPath, {
    message:
      "Use a relative simulation path without parent traversal or reserved runtime names",
  });

export const SimulationRawFileSchema = z.strictObject({
  path: SimulationInputPathSchema,
  /** Authored bytes represented as UTF-8 text when the Project is serialized. */
  text: z.string(),
});

/**
 * A large or environment-owned file that is not copied into the Project.
 * `id` is the resolver-facing logical identity, `mountPath` is the relative
 * path authored SPICE refers to, and the digest prevents silent substitution.
 */
export const SimulationRawDependencySchema = z.strictObject({
  id: z.string().min(1).max(256),
  mountPath: SimulationInputPathSchema,
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/u, "Dependency sha256 must be lowercase hex"),
});

export const SimulationRawInputSchema = z
  .strictObject({
    kind: z.literal("raw"),
    entry: SimulationInputPathSchema,
    files: z
      .array(SimulationRawFileSchema)
      .min(1)
      .max(MAX_SIMULATION_INPUT_FILES),
    dependencies: z
      .array(SimulationRawDependencySchema)
      .max(MAX_SIMULATION_INPUT_FILES),
    environment: SimulationEnvironmentSelectionSchema,
  })
  .superRefine((input, context) => {
    const paths = new Set<string>();
    let bytes = 0;
    for (const [index, file] of input.files.entries()) {
      if (paths.has(file.path)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate simulation input path: ${file.path}`,
          path: ["files", index, "path"],
        });
      }
      paths.add(file.path);
      bytes += new TextEncoder().encode(file.text).byteLength;
    }
    if (!paths.has(input.entry)) {
      context.addIssue({
        code: "custom",
        message: `Simulation entry is not an authored file: ${input.entry}`,
        path: ["entry"],
      });
    }
    if (bytes > MAX_SIMULATION_INPUT_BYTES) {
      context.addIssue({
        code: "custom",
        message: "Raw simulation input exceeds 1 MiB",
        path: ["files"],
      });
    }
    const dependencyIds = new Set<string>();
    for (const [index, dependency] of input.dependencies.entries()) {
      if (dependencyIds.has(dependency.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate simulation dependency: ${dependency.id}`,
          path: ["dependencies", index, "id"],
        });
      }
      dependencyIds.add(dependency.id);
      if (paths.has(dependency.mountPath)) {
        context.addIssue({
          code: "custom",
          message: `Simulation dependency shadows an authored file: ${dependency.mountPath}`,
          path: ["dependencies", index, "mountPath"],
        });
      }
      paths.add(dependency.mountPath);
    }
  });

export const SimulationStructuredInputSchema = z
  .strictObject({
    kind: z.literal("structured"),
    /** The Testbench Cell; it is neither the DUT nor necessarily the Project top. */
    rootDocumentId: StableIdSchema,
    analyses: z.array(SimulationAnalysisSpecSchema).min(1),
    outputs: z.array(SimulationOutputSpecSchema).max(1024),
    /** Selected MOS occurrences; absent is equivalent to an empty list. */
    deviceOperatingPoints: z
      .array(SimulationDeviceOperatingPointSpecSchema)
      .max(256)
      .optional(),
    /** Saved scalar-measurement rules; absent is equivalent to an empty list. */
    measurements: z.array(SimulationMeasurementSpecSchema).max(256).optional(),
    designVariables: z.array(SimulationDesignVariableSchema).max(256),
    runPlan: SimulationRunPlanSchema,
    environment: SimulationEnvironmentSelectionSchema,
  })
  .superRefine((input, context) => {
    const kinds = new Set<string>();
    for (const [index, analysis] of input.analyses.entries()) {
      if (kinds.has(analysis.kind)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate simulation analysis: ${analysis.kind}`,
          path: ["analyses", index, "kind"],
        });
      }
      kinds.add(analysis.kind);
    }
    reportDuplicateIds(input.outputs, "outputs", context);
    reportDuplicateIds(
      input.deviceOperatingPoints ?? [],
      "deviceOperatingPoints",
      context,
    );
    reportDuplicateIds(input.measurements ?? [], "measurements", context);
    reportDuplicateIds(input.designVariables, "designVariables", context);
    const variableNames = new Set<string>();
    const boundParameters = new Set<string>();
    for (const [variableIndex, variable] of input.designVariables.entries()) {
      const normalizedName = variable.name.toLowerCase();
      if (variableNames.has(normalizedName)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate Design Variable name: ${variable.name}`,
          path: ["designVariables", variableIndex, "name"],
        });
      }
      variableNames.add(normalizedName);
      for (const [bindingIndex, binding] of variable.bindings.entries()) {
        const key = `${binding.documentId}:${binding.instanceId}:${binding.parameter.toLowerCase()}`;
        if (boundParameters.has(key)) {
          context.addIssue({
            code: "custom",
            message:
              "An Instance parameter can be bound to only one Design Variable",
            path: ["designVariables", variableIndex, "bindings", bindingIndex],
          });
        }
        boundParameters.add(key);
      }
    }
    if (input.runPlan.mode === "sweep") {
      const variableIds = new Set(input.designVariables.map(({ id }) => id));
      for (const [axisIndex, axis] of input.runPlan.axes.entries()) {
        if (axis.kind === "variable" && !variableIds.has(axis.variableId)) {
          context.addIssue({
            code: "custom",
            message: `Run Plan references an unavailable Design Variable: ${axis.variableId}`,
            path: ["runPlan", "axes", axisIndex, "variableId"],
          });
        }
      }
    }
    if (
      (input.deviceOperatingPoints?.length ?? 0) > 0 &&
      !input.analyses.some((analysis) => analysis.kind === "op")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Device operating-point details require an operating-point analysis",
        path: ["deviceOperatingPoints"],
      });
    }
    const labels = new Set<string>();
    for (const [index, output] of input.outputs.entries()) {
      const label = output.label.toLowerCase();
      if (labels.has(label)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate simulation output label: ${output.label}`,
          path: ["outputs", index, "label"],
        });
      }
      labels.add(label);
      if (expressionDepth(output.expression) > 32) {
        context.addIssue({
          code: "custom",
          message: "Simulation expression exceeds maximum depth 32",
          path: ["outputs", index, "expression"],
        });
      }
    }
    const measurementLabels = new Set<string>();
    for (const [index, measurement] of (input.measurements ?? []).entries()) {
      const label = measurement.label.toLowerCase();
      if (measurementLabels.has(label)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate simulation measurement label: ${measurement.label}`,
          path: ["measurements", index, "label"],
        });
      }
      measurementLabels.add(label);
      if (
        measurement.analysis === "op" &&
        measurement.method.kind !== "value"
      ) {
        context.addIssue({
          code: "custom",
          message: "Operating-point measurements use the value method",
          path: ["measurements", index, "method"],
        });
      }
      if (
        measurement.analysis !== "op" &&
        measurement.method.kind === "value"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "The value method is only valid for operating-point measurements",
          path: ["measurements", index, "method"],
        });
      }
      if (
        (measurement.method.kind === "mean" ||
          measurement.method.kind === "rms") &&
        measurement.analysis !== "tran"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Mean and RMS measurements are currently supported only for transient analysis",
          path: ["measurements", index, "method"],
        });
      }
    }
  });

/** Read-only historical input for the one-way source migration; never a current Project writer. */
export const LegacySimulationSetupSchema = z.strictObject({
  version: z.literal(3),
  input: z.discriminatedUnion("kind", [
    SimulationStructuredInputSchema,
    SimulationRawInputSchema,
  ]),
});

/** A named Project-owned setup. The id is the durable run/selection address;
 * the name is presentation and may change independently. */
export const LegacyProjectSimulationSetupSchema =
  LegacySimulationSetupSchema.extend({
    id: StableIdSchema,
    name: z.string().trim().min(1).max(128),
  });
