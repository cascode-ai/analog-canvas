import { z } from "zod";

import { StableIdSchema } from "./common.js";
import { reportDuplicateIds } from "./validation.js";

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
export const SimulationAnalysisSpecSchema = z.discriminatedUnion("kind", [
  SimulationOperatingPointAnalysisSchema,
  SimulationAcAnalysisSchema,
  SimulationTransientAnalysisSchema,
]);

/**
 * Hierarchy Instance ids from the simulation root down to the Document that
 * owns the probed object; empty when that object is in the root itself.
 */
const SimulationProbeOccurrenceSchema = z.array(StableIdSchema).max(64);

export const SimulationProbeSpecSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: StableIdSchema,
    kind: z.literal("net-voltage"),
    documentId: StableIdSchema,
    netId: StableIdSchema,
    occurrence: SimulationProbeOccurrenceSchema,
  }),
  z.strictObject({
    id: StableIdSchema,
    kind: z.literal("source-current"),
    documentId: StableIdSchema,
    instanceId: StableIdSchema,
    occurrence: SimulationProbeOccurrenceSchema,
  }),
]);

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

export const SimulationStructuredInputSchema = z
  .strictObject({
    kind: z.literal("structured"),
    /** The Testbench Cell; it is neither the DUT nor necessarily the Project top. */
    rootDocumentId: StableIdSchema,
    analyses: z.array(SimulationAnalysisSpecSchema).min(1),
    probes: z.array(SimulationProbeSpecSchema).max(1024),
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
    reportDuplicateIds(input.probes, "probes", context);
  });

export const SimulationSetupSchema = z.strictObject({
  version: z.literal(1),
  input: SimulationStructuredInputSchema,
});
