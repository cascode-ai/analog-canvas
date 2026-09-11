import { z } from "zod";
import { SimulationInputPathSchema } from "@icm/model";
import { Id, Digest, ArtifactRefSchema } from "./contract.js";
import { SimulationSourceChangesSchema } from "./source-files.js";

export const SimulationFileOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("session-workspace"), workspaceId: Id }),
  z.strictObject({ kind: z.literal("project-setup"), setupId: Id }),
]);
export type SimulationFileOwner = z.infer<typeof SimulationFileOwnerSchema>;

export const WorkspaceSchema = z.strictObject({
  id: Id,
  revision: z.number().int().nonnegative(),
  entry: z.string().nullable(),
  configPath: SimulationInputPathSchema,
  files: z.array(z.strictObject({ path: z.string(), text: z.string() })),
  expiresAt: z.number(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

const Revision = z.number().int().nonnegative();
export const SimulationFileOperationSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("list"),
    owner: SimulationFileOwnerSchema.optional(),
  }),
  z.strictObject({ action: z.literal("create") }),
  z.strictObject({
    action: z.literal("read"),
    owner: SimulationFileOwnerSchema,
    path: SimulationInputPathSchema,
    offset: Revision.default(0),
    maxChars: z.number().int().positive().max(65536).default(65536),
  }),
  z.strictObject({
    action: z.literal("discard"),
    owner: SimulationFileOwnerSchema.options[0],
  }),
  SimulationSourceChangesSchema.extend({
    action: z.literal("update"),
    owner: SimulationFileOwnerSchema,
    expectedRevision: Revision,
    entry: SimulationInputPathSchema.optional(),
    configPath: SimulationInputPathSchema.optional(),
    /** Exact generated Circuit edits are mapped to typed numeric parameter transactions. */
    circuitEdits: z
      .array(
        z.strictObject({
          path: SimulationInputPathSchema,
          textDigest: Digest,
          text: z.string(),
        }),
      )
      .max(64)
      .default([]),
  }),
  z.strictObject({
    action: z.literal("artifact"),
    artifactId: Id,
    offset: Revision.default(0),
    maxChars: z.number().int().positive().max(65536).default(65536),
  }),
]);
export type SimulationFileOperation = z.infer<
  typeof SimulationFileOperationSchema
>;
export const SimulationSourceListingSchema = z.strictObject({
  owner: SimulationFileOwnerSchema,
  revision: Revision,
  entry: SimulationInputPathSchema.nullable(),
  configPath: SimulationInputPathSchema.optional(),
  files: z.array(
    z.strictObject({
      path: SimulationInputPathSchema,
      kind: z.enum(["authored", "generated", "dependency"]),
      byteLength: Revision.optional(),
    }),
  ),
});
export const SimulationFileResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    workspaces: z.array(WorkspaceSchema.omit({ files: true })),
  }),
  z.strictObject({ ok: z.literal(true), workspace: WorkspaceSchema }),
  z.strictObject({
    ok: z.literal(true),
    source: SimulationSourceListingSchema,
  }),
  z.strictObject({ ok: z.literal(true), discarded: z.literal(true) }),
  z.strictObject({
    ok: z.literal(true),
    owner: SimulationFileOwnerSchema,
    revision: Revision,
    path: SimulationInputPathSchema,
    textDigest: Digest,
    text: z.string(),
    offset: Revision,
    nextOffset: Revision.nullable(),
    instances: z
      .array(
        z.strictObject({
          documentId: Id,
          instanceId: Id,
          startOffset: Revision,
          endOffset: Revision,
        }),
      )
      .optional(),
    editableParameters: z
      .array(
        z.strictObject({
          from: Revision,
          to: Revision,
          label: z.string(),
          documentId: Id,
          instanceId: Id,
          parameter: z.string(),
        }),
      )
      .optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    artifact: ArtifactRefSchema,
    text: z.string(),
    offset: Revision,
    nextOffset: Revision.nullable(),
  }),
]);
export type SimulationFileResult = z.infer<typeof SimulationFileResultSchema>;
