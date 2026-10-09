import { z } from "zod";
import {
  ComponentDefinitionSchema,
  ExternalSubcircuitDefinitionSchema,
  ProjectModelSourceSchema,
} from "@icm/model";

const Id = z.string().min(1).max(256);
const LibraryId = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/u);
const Revision = z.number().int().nonnegative();
const WriteIdentity = {
  componentId: LibraryId,
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u),
};
const ProjectSelection = {
  projectId: Id,
  expectedStructureRevision: Revision,
  selection: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("circuit"),
      definitionId: Id,
      symbolId: Id,
      sourceRevision: Revision,
      appliedVersion: z.boolean().optional(),
    }),
    z.strictObject({ kind: z.literal("component"), symbolId: Id }),
  ]),
};

/** User Components are independent public snapshots, separate from Gallery circuits. */
export const AgentComponentLibraryActionSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("list"),
      query: z.string().max(100).optional(),
      cursor: z.string().max(2048).optional(),
    }),
    z.strictObject({ action: z.literal("read"), componentId: LibraryId }),
    z.strictObject({
      action: z.literal("publish"),
      ...WriteIdentity,
      ...ProjectSelection,
    }),
    z.strictObject({
      action: z.literal("update"),
      ...WriteIdentity,
      ...ProjectSelection,
      expectedLibraryRevision: Revision.min(1),
    }),
    z.strictObject({
      action: z.literal("fork"),
      componentId: LibraryId,
      expectedLibraryRevision: Revision.min(1),
      newComponentId: LibraryId,
      idempotencyKey: WriteIdentity.idempotencyKey,
    }),
    z.strictObject({
      action: z.literal("insert"),
      componentId: LibraryId,
      expectedLibraryRevision: Revision.min(1),
      projectId: Id,
      targetDocumentId: Id,
      expectedStructureRevision: Revision,
      expectedRevision: Revision,
      position: z.strictObject({
        x: z.number().finite(),
        y: z.number().finite(),
      }),
      reference: z.string().min(1).max(128).optional(),
    }),
  ],
);

const AgentSharedComponentSchema = z.strictObject({
  id: LibraryId,
  revision: Revision.min(1),
  authorId: Id,
  author: z.string(),
  status: z.enum(["shared", "official", "deleted"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  definition: ComponentDefinitionSchema,
  circuit: z
    .strictObject({
      version: z.literal(1),
      externalDefinition: ExternalSubcircuitDefinitionSchema,
      source: ProjectModelSourceSchema,
    })
    .optional(),
});
export const AgentComponentLibraryResultSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("list"),
      entries: z.array(AgentSharedComponentSchema),
      nextCursor: z.string().nullable(),
    }),
    z.strictObject({
      action: z.enum(["read", "publish", "update", "fork"]),
      entry: AgentSharedComponentSchema,
      digest: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
    z.strictObject({
      action: z.literal("insert"),
      componentId: LibraryId,
      libraryRevision: Revision.min(1),
      instanceId: Id,
      symbolId: Id,
      definitionId: Id.optional(),
      structureRevision: Revision,
      revision: Revision,
    }),
  ],
);
export type AgentComponentLibraryAction = z.infer<
  typeof AgentComponentLibraryActionSchema
>;
