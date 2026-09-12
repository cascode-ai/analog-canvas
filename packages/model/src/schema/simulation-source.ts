import { z } from "zod";

import { StableIdSchema } from "./common.js";
import {
  SimulationDesignVariableSchema,
  SimulationDeviceOperatingPointSpecSchema,
  SimulationEnvironmentSelectionSchema,
  SimulationInputPathSchema,
  SimulationMeasurementSpecSchema,
  SimulationProbeOccurrenceSchema,
  SimulationRawDependencySchema,
  SimulationRawFileSchema,
  SimulationRunPlanSchema,
  SimulationVoltageProbeSchema,
} from "./simulation.js";
import { reportDuplicateIds } from "./validation.js";

/** Source ownership, not a second copy of generated electrical facts. */
export const SimulationCircuitBindingSchema = z.strictObject({
  id: StableIdSchema,
  path: SimulationInputPathSchema,
  documentId: StableIdSchema,
  emission: z.enum(["subcircuit", "top-level"]),
});

/** Unapplied editing buffer, never an electrical override or executable source. */
export const SimulationSourceDraftSchema = z.strictObject({
  path: SimulationInputPathSchema,
  base: z.string(),
  text: z.string(),
  binding: SimulationCircuitBindingSchema.optional(),
});

/** A Project may save broken references and invalid author text for repair. */
export const SimulationSourceInputSchema = z
  .strictObject({
    kind: z.literal("source"),
    entry: SimulationInputPathSchema,
    configPath: SimulationInputPathSchema,
    files: z.array(SimulationRawFileSchema).max(4096),
    circuitBindings: z.array(SimulationCircuitBindingSchema).max(1024),
    dependencies: z.array(SimulationRawDependencySchema).max(1024),
    drafts: z.array(SimulationSourceDraftSchema).max(4096).optional(),
  })
  .superRefine((input, context) => {
    const paths = new Set<string>();
    for (const [field, values] of [
      ["files", input.files.map(({ path }) => path)],
      ["circuitBindings", input.circuitBindings.map(({ path }) => path)],
      ["dependencies", input.dependencies.map(({ mountPath }) => mountPath)],
    ] as const) {
      values.forEach((path, index) => {
        if (paths.has(path))
          context.addIssue({
            code: "custom",
            message: `Simulation path has more than one owner: ${path}`,
            path: [
              field,
              index,
              field === "dependencies" ? "mountPath" : "path",
            ],
          });
        paths.add(path);
      });
    }
    reportDuplicateIds(input.circuitBindings, "circuitBindings", context);
    reportDuplicateIds(input.dependencies, "dependencies", context);
    const draftPaths = new Set<string>();
    input.drafts?.forEach((draft, index) => {
      if (draftPaths.has(draft.path))
        context.addIssue({
          code: "custom",
          message: `Duplicate draft path: ${draft.path}`,
          path: ["drafts", index, "path"],
        });
      draftPaths.add(draft.path);
    });
    if (input.entry === input.configPath)
      context.addIssue({
        code: "custom",
        message:
          "The SPICE entry and experiment configuration need distinct paths",
        path: ["configPath"],
      });
    if (
      input.circuitBindings.filter((b) => b.emission === "top-level").length > 1
    )
      context.addIssue({
        code: "custom",
        message:
          "An experiment can have only one generated top-level Testbench",
        path: ["circuitBindings"],
      });
    for (const field of ["entry", "configPath"] as const) {
      if (
        input.circuitBindings.some((b) => b.path === input[field]) ||
        input.dependencies.some((d) => d.mountPath === input[field])
      )
        context.addIssue({
          code: "custom",
          message: `${field} must address author-owned text`,
          path: [field],
        });
    }
  });

export const SimulationFolderInputSchema = z.strictObject({
  version: z.literal(4),
  input: SimulationSourceInputSchema,
});
export const ProjectSimulationFolderSchema = SimulationFolderInputSchema.extend(
  {
    id: StableIdSchema,
    name: z.string().trim().min(1).max(128),
  },
);

/** Execution-only point override, shared by compiler, service and Agent; never saved as nominal intent. */
export const SimulationRunVariantSchema = z.strictObject({
  environment: z
    .strictObject({
      corner: z.string().min(1).max(64).optional(),
      temperatureC: z.number().finite().optional(),
    })
    .optional(),
  parameters: z
    .array(
      z.strictObject({
        documentId: StableIdSchema,
        instanceId: StableIdSchema,
        parameter: z.string().min(1).max(128),
        value: z.string().max(4096),
      }),
    )
    .max(16)
    .optional(),
  variables: z
    .array(
      z.strictObject({
        variableId: StableIdSchema,
        value: z.string().trim().min(1).max(4096),
      }),
    )
    .max(16)
    .optional(),
});
export type SimulationRunVariant = z.infer<typeof SimulationRunVariantSchema>;

export const SimulationCircuitScopeSchema = z.strictObject({
  bindingId: StableIdSchema,
  // Authored X names, not Project Instance IDs. Resolved at preparation.
  callPath: z.array(z.string().min(1).max(256)).max(64),
});
const Voltage = SimulationVoltageProbeSchema.extend({
  kind: z.literal("voltage"),
  circuit: SimulationCircuitScopeSchema,
});
const Current = z.strictObject({
  kind: z.literal("current"),
  documentId: StableIdSchema,
  instanceId: StableIdSchema,
  pinName: z.string().min(1).max(128),
  occurrence: SimulationProbeOccurrenceSchema,
  circuit: SimulationCircuitScopeSchema,
});
const Vector = z.strictObject({
  kind: z.literal("vector"),
  vector: z.string().trim().min(1).max(1024),
});
const unary = [
  "negate",
  "magnitude",
  "db20",
  "phase",
  "real",
  "imaginary",
  "absolute",
] as const;
const binary = ["add", "subtract", "multiply", "divide"] as const;
export type SimulationSourceExpression =
  | z.infer<typeof Voltage>
  | z.infer<typeof Current>
  | z.infer<typeof Vector>
  | { kind: "constant"; value: number }
  | { kind: (typeof unary)[number]; operand: SimulationSourceExpression }
  | {
      kind: (typeof binary)[number];
      left: SimulationSourceExpression;
      right: SimulationSourceExpression;
    };

// The bounded depth is part of parsing, not a traversal after unlimited recursion.
function expressionSchema(
  depth: number,
): z.ZodType<SimulationSourceExpression> {
  const leaves = [
    Voltage,
    Current,
    Vector,
    z.strictObject({
      kind: z.literal("constant"),
      value: z.number().finite(),
    }),
  ] as const;
  if (depth === 1) return z.discriminatedUnion("kind", leaves);
  const child = z.lazy(() => expressionSchema(depth - 1));
  return z.discriminatedUnion("kind", [
    ...leaves,
    ...unary.map((kind) =>
      z.strictObject({ kind: z.literal(kind), operand: child }),
    ),
    ...binary.map((kind) =>
      z.strictObject({
        kind: z.literal(kind),
        left: child,
        right: child,
      }),
    ),
  ]);
}
export const SimulationSourceExpressionSchema = expressionSchema(32);
export const SimulationSourceOutputSchema = z.strictObject({
  id: StableIdSchema,
  label: z.string().trim().min(1).max(128),
  expression: SimulationSourceExpressionSchema,
});
export const SimulationSourceVariableSchema =
  SimulationDesignVariableSchema.omit({ value: true }).extend({
    sourcePath: SimulationInputPathSchema,
  });
export const SimulationSourceDeviceOperatingPointSchema =
  SimulationDeviceOperatingPointSpecSchema.extend({
    circuit: SimulationCircuitScopeSchema,
  });

/** Native experiments define all electrical behavior in SPICE, not a sidecar. */
export const NativeSimulationExperimentConfigSchema = z.strictObject({
  version: z.literal(2),
  environment: z.strictObject({ profileId: z.string().min(1).max(256) }),
});
export type NativeSimulationExperimentConfig = z.infer<
  typeof NativeSimulationExperimentConfigSchema
>;

/** Version-1 compatibility reader. New experiments use the native version-2 contract. */
export const SimulationExperimentConfigSchema = z
  .strictObject({
    version: z.literal(1),
    environment: SimulationEnvironmentSelectionSchema.omit({
      temperatureC: true,
    }),
    runPlan: SimulationRunPlanSchema.default({ mode: "nominal" }),
    variables: z.array(SimulationSourceVariableSchema).max(256).default([]),
    outputs: z.array(SimulationSourceOutputSchema).max(1024).default([]),
    deviceOperatingPoints: z
      .array(SimulationSourceDeviceOperatingPointSchema)
      .max(256)
      .default([]),
    measurements: z.array(SimulationMeasurementSpecSchema).max(256).default([]),
    collection: z
      .strictObject({ rawfile: SimulationInputPathSchema.nullable() })
      .default({ rawfile: "out.raw" }),
  })
  .superRefine((config, context) => {
    for (const field of [
      "variables",
      "outputs",
      "deviceOperatingPoints",
      "measurements",
    ] as const)
      reportDuplicateIds(config[field], field, context);
    for (const field of ["variables", "outputs", "measurements"] as const) {
      const names = new Set<string>();
      config[field].forEach((value, index) => {
        const name = ("name" in value ? value.name : value.label).toLowerCase();
        if (names.has(name))
          context.addIssue({
            code: "custom",
            message: `Duplicate ${field} name: ${name}`,
            path: [field, index],
          });
        names.add(name);
      });
    }
    const targets = new Set<string>();
    config.variables.forEach((variable, index) =>
      variable.bindings.forEach((binding) => {
        const target = JSON.stringify([
          binding.documentId,
          binding.instanceId,
          binding.parameter.toLowerCase(),
        ]);
        if (targets.has(target))
          context.addIssue({
            code: "custom",
            message: "An instance parameter can have only one variable owner",
            path: ["variables", index, "bindings"],
          });
        targets.add(target);
      }),
    );
  });

export type SimulationSourceInput = z.infer<typeof SimulationSourceInputSchema>;
export type SimulationCircuitBinding = z.infer<
  typeof SimulationCircuitBindingSchema
>;
export type SimulationCircuitScope = z.infer<
  typeof SimulationCircuitScopeSchema
>;
export type SimulationExperimentConfig = z.infer<
  typeof SimulationExperimentConfigSchema
>;
export type SimulationSourceOutput = z.infer<
  typeof SimulationSourceOutputSchema
>;
