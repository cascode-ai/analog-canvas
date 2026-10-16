import { z } from "zod";
import {
  ComponentDraftTargetSchema,
  ComponentDraftCatalogSchema,
} from "@icm/edit-engine/component-drafts";
import {
  ComponentAuthoringActions,
  ComponentAuthoringResults,
} from "./component-authoring.js";
export * from "./component-authoring.js";
import {
  ComponentDefinitionSchema,
  ExternalSubcircuitDefinitionSchema,
  ProjectModelSourceSchema,
  SourceSpanSchema,
  ComponentLibraryOriginSchema,
} from "@icm/model";

const Id = z.string().min(1).max(256);
const LibraryId = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/u);
const Revision = z.number().int().nonnegative();
export const ComponentCatalogQuerySchema = z.strictObject({
  version: z.literal(1),
  type: z
    .enum(["all", "with-circuit", "symbol-only", "needs-repair"])
    .default("all"),
  authorId: Id.optional(),
  order: z.enum(["circuit-first", "newest", "oldest"]).default("circuit-first"),
});
export type ComponentCatalogQuery = z.infer<typeof ComponentCatalogQuerySchema>;
export const ComponentCatalogCursorSchema = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  query: z.string(),
  rank: z.number().int().min(0).max(2),
  time: z.string(),
  id: z.string(),
});
export const ComponentCatalogAuthorSchema = z.strictObject({
  authorId: Id,
  author: z.string(),
  count: z.number().int().positive(),
});
const WriteIdentity = {
  componentId: LibraryId,
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u),
  publicationVersion: z.literal(1).optional(),
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
    ...ComponentAuthoringActions,
    z.strictObject({
      action: z.literal("drafts"),
      projectId: Id,
      projectSessionId: Id,
    }),
    z.strictObject({
      action: z.literal("delete-drafts"),
      projectId: Id,
      projectSessionId: Id,
      expectedStructureRevision: Revision,
      targets: z.array(ComponentDraftTargetSchema).min(1).max(512),
      dryRun: z.boolean().default(false),
    }),
    z.strictObject({
      action: z.enum(["delete", "restore"]),
      componentId: LibraryId,
      expectedLibraryRevision: Revision.min(1),
    }),
    z.strictObject({
      action: z.literal("list"),
      query: z.string().max(100).optional(),
      cursor: z.string().max(2048).optional(),
    }),
    z.strictObject({
      action: z.literal("browse"),
      deleted: z.boolean().optional(),
      query: z.string().max(100).optional(),
      cursor: z.string().max(2048).optional(),
      catalog: ComponentCatalogQuerySchema.optional(),
      ifCatalogRevision: Revision.optional(),
    }),
    z.strictObject({ action: z.literal("read"), componentId: LibraryId }),
    z.strictObject({
      action: z.literal("record"),
      componentId: LibraryId,
      expectedLibraryRevision: Revision.min(1),
      deleted: z.boolean().optional(),
    }),
    z.strictObject({ action: z.literal("inspect"), ...ProjectSelection }),
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
      publicationVersion: WriteIdentity.publicationVersion,
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
  deletion: z
    .strictObject({
      by: z.enum(["author", "admin"]),
      previousStatus: z.enum(["shared", "official"]),
    })
    .optional(),
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
/** Discovery is a derived view, never an executable component package. */
const ComponentDefinitionDiagnosticSchema = z.strictObject({
  componentId: LibraryId,
  path: z.array(z.union([z.string(), z.number().int()])),
  file: z.string().optional(),
  sourceRef: SourceSpanSchema.optional(),
  message: z.string(),
  recovery: z.literal("edit-definition"),
});
export const ComponentLibrarySummarySchema = z.strictObject({
  id: LibraryId,
  revision: Revision.min(1),
  authorId: Id,
  author: z.string(),
  status: z.enum(["shared", "official", "deleted"]),
  deletion: z
    .strictObject({
      by: z.enum(["author", "admin"]),
      previousStatus: z.enum(["shared", "official"]),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  name: z.string(),
  capability: z.enum([
    "circuit",
    "primitive",
    "builtin",
    "symbol-only",
    "needs-repair",
  ]),
  pinCount: z.number().int().nonnegative(),
  parameterCount: z.number().int().nonnegative(),
  diagnostic: z.string().optional(),
  diagnostics: z.array(ComponentDefinitionDiagnosticSchema).optional(),
});
export type ComponentLibrarySummary = z.infer<
  typeof ComponentLibrarySummarySchema
>;
export const AgentComponentLibraryResultSchema = z.discriminatedUnion(
  "action",
  [
    ...ComponentAuthoringResults,
    z.strictObject({
      action: z.literal("record"),
      record: z.record(z.string(), z.unknown()),
    }),
    z.strictObject({
      action: z.enum(["delete", "restore"]),
      entry: AgentSharedComponentSchema.omit({
        definition: true,
        circuit: true,
      }),
      outcome: z.enum(["changed", "unchanged"]),
    }),
    z.strictObject({
      action: z.literal("drafts"),
      projectId: Id,
      projectSessionId: Id,
      structureRevision: Revision,
      catalog: ComponentDraftCatalogSchema,
    }),
    z.strictObject({
      action: z.literal("delete-drafts"),
      projectId: Id,
      projectSessionId: Id,
      structureRevision: Revision,
      catalog: ComponentDraftCatalogSchema,
      reclaimBytes: Revision,
      dryRun: z.boolean(),
    }),
    z.strictObject({
      action: z.literal("browse"),
      entries: z.array(ComponentLibrarySummarySchema),
      nextCursor: z.string().nullable(),
      catalogRevision: Revision.optional(),
      notModified: z.boolean().optional(),
      authors: z.array(ComponentCatalogAuthorSchema).optional(),
    }),
    z.strictObject({
      action: z.literal("list"),
      entries: z.array(AgentSharedComponentSchema),
      nextCursor: z.string().nullable(),
    }),
    z.strictObject({
      action: z.enum(["read", "publish", "update", "fork"]),
      entry: AgentSharedComponentSchema,
      digest: z.string().regex(/^[a-f0-9]{64}$/u),
      publication: z
        .strictObject({
          version: z.literal(1),
          outcome: z.enum(["created", "updated", "unchanged"]),
          recovered: z.boolean(),
          association: z.enum(["associated", "pending", "not-requested"]),
          diagnostic: z.string().optional(),
        })
        .optional(),
    }),
    z.strictObject({
      action: z.literal("inspect"),
      origin: ComponentLibraryOriginSchema.optional(),
      destination: z.strictObject({
        kind: z.enum(["new", "update"]),
        componentId: LibraryId,
        expectedLibraryRevision: Revision.min(1).optional(),
      }),
      stale: z.boolean(),
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
