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

export const SimulationProbeSpecSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: StableIdSchema,
    kind: z.literal("net-voltage"),
    documentId: StableIdSchema,
    anchor: SimulationVoltageProbeAnchorSchema,
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
  input: z.discriminatedUnion("kind", [
    SimulationStructuredInputSchema,
    SimulationRawInputSchema,
  ]),
});
