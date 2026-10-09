import { z } from "zod";
import { StableIdSchema } from "./common.js";
import { CellSymbolPresentationSchema } from "./presentation.js";
import { ComponentDefinitionSchema } from "./component-definition.js";
import {
  MAX_SIMULATION_INPUT_BYTES,
  SimulationInputPathSchema,
  SimulationRawFileSchema,
  SimulationRawDependencySchema,
} from "./simulation.js";

/** Applied native model source; draft text never replaces executable bytes. */
const ModelSourceLanguageSchema = z.enum(["spice", "spectre"]);
/** Non-executable authoring candidates share their owner's source draft. */
const ModelSourceAuthoringDraftSchema = z.strictObject({
  definitionId: StableIdSchema,
  entry: z.string().max(128),
  symbolMode: z.enum(["automatic", "custom"]),
  artworkText: z.string().max(MAX_SIMULATION_INPUT_BYTES),
  // Preview cache only; never used to Apply or generate an executable package.
  lastValidArtwork: ComponentDefinitionSchema.optional(),
  // Copy provenance translates raw JSON identities without rewriting unfinished text.
  artworkOrigin: z
    .strictObject({
      definitionId: StableIdSchema,
      terminalIds: z.record(StableIdSchema, StableIdSchema),
    })
    .optional(),
  terminalDirections: z
    .record(StableIdSchema, z.enum(["input", "output", "inout", "passive"]))
    .optional(),
  presentation: CellSymbolPresentationSchema.optional(),
  portMaps: z.record(
    StableIdSchema,
    z.record(z.string().min(1), z.string().min(1).nullable()),
  ),
  legacyRepair: z
    .strictObject({
      identity: StableIdSchema,
      baseline: ComponentDefinitionSchema,
      selected: z
        .strictObject({
          documentId: StableIdSchema,
          instanceId: StableIdSchema,
        })
        .optional(),
      disconnectPorts: z.array(z.string().min(1)).max(128).optional(),
      useAppliedSource: z.boolean().optional(),
    })
    .optional(),
});
export const ModelSourceAuthoringDraftsSchema = z
  .array(ModelSourceAuthoringDraftSchema)
  .max(256)
  .superRefine((drafts, context) => {
    const ids = new Set<string>();
    for (const [index, draft] of drafts.entries()) {
      if (ids.has(draft.definitionId))
        context.addIssue({
          code: "custom",
          message: "Duplicate authoring candidate",
          path: [index, "definitionId"],
        });
      ids.add(draft.definitionId);
    }
    if (
      new TextEncoder().encode(JSON.stringify(drafts)).byteLength >
      MAX_SIMULATION_INPUT_BYTES
    )
      context.addIssue({
        code: "custom",
        message: "Authoring candidates exceed 1 MiB",
      });
  });
export const ModelSourceDraftSchema = z.strictObject({
  language: ModelSourceLanguageSchema.optional(),
  entry: SimulationInputPathSchema,
  files: z.array(SimulationRawFileSchema).min(1).max(256),
  baseRevision: z.number().int().nonnegative(),
  authoring: ModelSourceAuthoringDraftsSchema.optional(),
  dependencies: z.array(SimulationRawDependencySchema).max(256).optional(),
});
export const ProjectModelSourceSchema = z
  .strictObject({
    id: StableIdSchema,
    language: ModelSourceLanguageSchema,
    entry: SimulationInputPathSchema,
    files: z.array(SimulationRawFileSchema).min(1).max(256),
    dependencies: z.array(SimulationRawDependencySchema).max(256).default([]),
    revision: z.number().int().nonnegative(),
    draft: ModelSourceDraftSchema.optional(),
  })
  .superRefine((source, context) => {
    const validate = (
      input: {
        entry: string;
        files: { path: string; text: string }[];
        dependencies: { id: string; mountPath: string }[];
      },
      prefix: string[],
    ) => {
      const paths = new Set<string>();
      let bytes = 0;
      for (const [index, file] of input.files.entries()) {
        if (paths.has(file.path))
          context.addIssue({
            code: "custom",
            message: "Duplicate model source path",
            path: [...prefix, "files", index, "path"],
          });
        paths.add(file.path);
        bytes += new TextEncoder().encode(file.text).byteLength;
      }
      if (bytes > MAX_SIMULATION_INPUT_BYTES)
        context.addIssue({
          code: "custom",
          message: "Model source exceeds 1 MiB",
          path: [...prefix, "files"],
        });
      if (!paths.has(input.entry))
        context.addIssue({
          code: "custom",
          message: "Model entry must address an owned source file",
          path: [...prefix, "entry"],
        });
      const dependencyIds = new Set<string>();
      for (const [index, dependency] of input.dependencies.entries()) {
        if (dependencyIds.has(dependency.id))
          context.addIssue({
            code: "custom",
            message: "Duplicate model dependency identity",
            path: [...prefix, "dependencies", index, "id"],
          });
        dependencyIds.add(dependency.id);
        if (paths.has(dependency.mountPath))
          context.addIssue({
            code: "custom",
            message: "Model path has more than one owner",
            path: [...prefix, "dependencies", index, "mountPath"],
          });
        paths.add(dependency.mountPath);
      }
    };
    validate(source, []);
    if (source.draft)
      validate(
        {
          ...source.draft,
          dependencies: source.draft.dependencies ?? source.dependencies,
        },
        ["draft"],
      );
  });
