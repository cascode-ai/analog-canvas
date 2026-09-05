import { z } from "zod";
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const SimulationDiagnosticSchema = z.strictObject({
  severity: z.enum(["error", "warning", "info"]),
  /** ngspice's own line, unedited. */
  text: z.string(),
  /** True when ngspice reported DROPPING part of the deck it was given. */
  droppedInput: z.boolean().optional(),
});

const SimulationOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("completed") }),
  z.strictObject({ status: z.literal("completed-with-dropped-input") }),
  z.strictObject({ status: z.literal("failed") }),
  z.strictObject({
    status: z.literal("timed-out"),
    timeoutMs: z.number(),
  }),
]);

const SimulationProbeShape = {
  name: z.string(),
  quantity: z.string(),
  unit: z.string().nullable(),
};

const SimulationAnalysisResultSchema = z.discriminatedUnion("analysis", [
  z.strictObject({
    analysis: z.literal("op"),
    plotName: z.string(),
    probes: z.array(
      z.strictObject({ ...SimulationProbeShape, value: z.number() }),
    ),
  }),
  z.strictObject({
    analysis: z.literal("ac"),
    plotName: z.string(),
    frequencyHz: z.array(z.number()),
    probes: z.array(
      z.strictObject({
        ...SimulationProbeShape,
        // Kept as solved: real and imaginary, never a magnitude and never a
        // "gain". What a magnitude means depends on a testbench this layer
        // does not see.
        real: z.array(z.number()),
        imag: z.array(z.number()),
      }),
    ),
  }),
  z.strictObject({
    analysis: z.literal("tran"),
    plotName: z.string(),
    timeSeconds: z.array(z.number()),
    probes: z.array(
      z.strictObject({ ...SimulationProbeShape, value: z.array(z.number()) }),
    ),
  }),
]);

const SimulationResultDataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** Never empty: a run that produced no vectors is a diagnostic, not a result. */
  analyses: z.array(SimulationAnalysisResultSchema),
});

const SimulationRunMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  input: z.strictObject({
    inputRevision: z.string().nullable(),
    netlistSha256: Sha256Schema,
    testbenchSha256: Sha256Schema,
    deckSha256: Sha256Schema,
  }),
  configuration: z.strictObject({
    modelLibrary: z
      .union([
        z.strictObject({
          directive: z.literal("include"),
          section: z.null(),
        }),
        z.strictObject({
          directive: z.literal("lib"),
          section: z.string(),
        }),
      ])
      .nullable(),
  }),
  environment: z.strictObject({
    executor: z.enum(["hosted-container", "local-host"]),
    reproducibility: z.enum(["observed", "pinned"]),
    profileId: z.string().nullable(),
    platform: z.string(),
    simulator: z.strictObject({
      name: z.literal("ngspice"),
      version: z.string(),
      binarySha256: z.string().nullable(),
    }),
    models: z
      .strictObject({ id: z.string(), contentSha256: z.string() })
      .nullable(),
    startupSha256: z.string().nullable(),
    fingerprint: z.string(),
  }),
});

/**
 * `SimulationResult` from `@icm/spice-run`, plus the hosted route's own
 * `execution` note about which executor answered. Strict: see the file header.
 */
export const SimulationResultSchema = z.strictObject({
  outcome: SimulationOutcomeSchema,
  diagnostics: z.array(SimulationDiagnosticSchema),
  log: z.string(),
  durationMs: z.number(),
  metadata: SimulationRunMetadataSchema,
  data: SimulationResultDataSchema.optional(),
  execution: z
    .strictObject({
      target: z.enum(["cloudflare-container", "operator-host"]),
    })
    .optional(),
});
