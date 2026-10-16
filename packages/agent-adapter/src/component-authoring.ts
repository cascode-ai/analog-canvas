import { z } from "zod";
import {
  MAX_SIMULATION_INPUT_BYTES,
  MAX_SIMULATION_INPUT_FILES,
  ModelSourceAuthoringDraftsSchema,
  ProjectModelSourceSchema,
  SimulationRawFileSchema,
  SimulationRawDependencySchema,
} from "@icm/model";

const Id = z.string().min(1).max(256);
const Revision = z.number().int().nonnegative();
const ComponentAuthoringCapabilitySchema = z.strictObject({
  version: z.literal(1),
  actions: z.tuple([
    z.literal("read"),
    z.literal("update"),
    z.literal("save"),
    z.literal("apply"),
  ]),
  dryRun: z.literal(true),
  open: z.literal(false),
});
export const componentAuthoringCapability =
  ComponentAuthoringCapabilitySchema.parse({
    version: 1,
    actions: ["read", "update", "save", "apply"],
    dryRun: true,
    open: false,
  });
/** Raw inputs use the saved-draft vocabulary; parsing a candidate never Applies it. */
export const NativeComponentCandidateSchema =
  ModelSourceAuthoringDraftsSchema.element
    .omit({ definitionId: true, lastValidArtwork: true, legacyRepair: true })
    .extend({
      language: ProjectModelSourceSchema.shape.language,
      // Raw controls can contain unfinished paths and dependency pins.
      entryPath: z.string(),
      files: z
        .array(SimulationRawFileSchema.extend({ path: z.string() }))
        .min(1)
        .max(MAX_SIMULATION_INPUT_FILES),
      dependencies: z
        .array(
          SimulationRawDependencySchema.extend({
            id: z.string(),
            mountPath: z.string(),
            sha256: z.string(),
          }),
        )
        .max(MAX_SIMULATION_INPUT_FILES)
        .default([]),
      terminalDirections:
        ModelSourceAuthoringDraftsSchema.element.shape.terminalDirections.unwrap(),
    });
export type NativeComponentCandidate = z.infer<
  typeof NativeComponentCandidateSchema
>;
export const ComponentAuthoringCandidateSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("circuit"),
    value: NativeComponentCandidateSchema,
  }),
  z.strictObject({
    kind: z.literal("definition"),
    text: z.string().max(MAX_SIMULATION_INPUT_BYTES),
  }),
]);
export type ComponentAuthoringCandidate = z.infer<
  typeof ComponentAuthoringCandidateSchema
>;
export const ComponentAuthoringTargetSchema = z.strictObject({
  projectId: Id,
  projectSessionId: Id,
  draftId: Id,
  sessionId: Id,
});
export type ComponentAuthoringTarget = z.infer<
  typeof ComponentAuthoringTargetSchema
>;
const ComponentAuthoringContextSchema = z.strictObject({
  definitionId: Id.optional(),
  sourceId: Id.optional(),
  sourceRevision: Revision.optional(),
  terminals: z
    .array(
      z.strictObject({
        id: Id,
        name: z.string(),
        direction: z.enum(["input", "output", "inout", "passive"]),
      }),
    )
    .optional(),
});
export const ComponentAuthoringSnapshotSchema = z.strictObject({
  target: ComponentAuthoringTargetSchema,
  candidateRevision: Revision,
  scope: z.enum(["new", "instance", "library"]),
  candidate: ComponentAuthoringCandidateSchema,
  dirty: z.boolean(),
  readOnly: z.boolean(),
  canApply: z.boolean(),
  diagnostics: z.array(z.string()),
  context: ComponentAuthoringContextSchema.optional(),
  checkpoints: z.strictObject({
    saved: z.boolean(),
    applied: z.boolean(),
    matchesSaved: z.boolean(),
    matchesApplied: z.boolean(),
  }),
  publication: z
    .strictObject({
      kind: z.enum(["new", "update"]),
      componentId: Id,
      expectedLibraryRevision: Revision.optional(),
    })
    .optional(),
});
export type ComponentAuthoringSnapshot = z.infer<
  typeof ComponentAuthoringSnapshotSchema
>;
const Write = {
  target: ComponentAuthoringTargetSchema,
  expectedCandidateRevision: Revision,
};
export const ComponentAuthoringActions = [
  z.strictObject({ action: z.literal("authoring-read") }),
  z.strictObject({
    action: z.literal("authoring-update"),
    ...Write,
    candidate: ComponentAuthoringCandidateSchema,
  }),
  z.strictObject({
    action: z.literal("authoring-apply"),
    ...Write,
    dryRun: z.boolean().default(false),
  }),
  z.strictObject({ action: z.literal("authoring-save"), ...Write }),
] as const;
export const ComponentAuthoringResults = [
  z.strictObject({
    action: z.literal("authoring-read"),
    workspace: ComponentAuthoringSnapshotSchema.nullable(),
    capabilities: ComponentAuthoringCapabilitySchema,
  }),
  z.strictObject({
    action: z.enum(["authoring-update", "authoring-save"]),
    workspace: ComponentAuthoringSnapshotSchema,
  }),
  z.strictObject({
    action: z.literal("authoring-apply"),
    dryRun: z.boolean(),
    applied: z.boolean(),
    workspace: ComponentAuthoringSnapshotSchema,
  }),
] as const;
