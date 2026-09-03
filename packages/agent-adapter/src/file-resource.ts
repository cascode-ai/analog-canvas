import { z } from "zod";

import { AGENT_API_VERSION } from "./schema.js";

const StableIdSchema = z.string().min(1).max(256);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

/** Hard browser/relay ceiling for a single encoded file-resource request. */
export const AGENT_FILE_RESOURCE_MAX_BYTES = 1_500_000;
export const AGENT_FILE_RESOURCE_MAX_FILES = 24;
export const AGENT_FILE_CANDIDATE_TTL_MS = 5 * 60_000;

export const AgentFileBlobSchema = z.strictObject({
  name: z.string().min(1).max(512),
  mediaType: z.string().min(1).max(128),
  encoding: z.literal("base64"),
  data: z.string().min(4),
  byteLength: z.number().int().positive().max(AGENT_FILE_RESOURCE_MAX_BYTES),
  sha256: Sha256Schema,
});

const FileRequestBaseSchema = z.strictObject({
  apiVersion: z.literal(AGENT_API_VERSION),
  requestId: StableIdSchema,
});

export const AgentFileResourceRequestSchema = z.discriminatedUnion(
  "operation",
  [
    FileRequestBaseSchema.extend({
      operation: z.literal("download"),
      artifact: z.enum(["project", "svg", "png", "pdf"]),
      documentId: StableIdSchema.optional(),
    }).superRefine((value, context) => {
      if (value.artifact !== "project" && value.documentId === undefined) {
        context.addIssue({
          code: "custom",
          path: ["documentId"],
          message: "documentId is required for visual export",
        });
      }
    }),
    FileRequestBaseSchema.extend({
      operation: z.literal("stage"),
      kind: z.enum(["project", "structural-spice"]),
      files: z
        .array(AgentFileBlobSchema)
        .min(1)
        .max(AGENT_FILE_RESOURCE_MAX_FILES),
      entryPath: z.string().min(1).max(512).optional(),
      namingProfile: z.enum(["native", "cadence-bang"]).optional(),
    }),
    FileRequestBaseSchema.extend({
      operation: z.literal("inspect"),
      candidateId: StableIdSchema,
    }),
    FileRequestBaseSchema.extend({
      operation: z.literal("discard"),
      candidateId: StableIdSchema,
    }),
    FileRequestBaseSchema.extend({
      operation: z.literal("request-approval"),
      candidateId: StableIdSchema,
    }),
  ],
);

const FileResponseBaseSchema = z.strictObject({
  apiVersion: z.literal(AGENT_API_VERSION),
  requestId: StableIdSchema,
});
export const AgentFileCandidateSummarySchema = z.strictObject({
  candidateId: StableIdSchema,
  kind: z.enum(["project", "structural-spice"]),
  expiresAt: z.string().datetime(),
  projectName: z.string().min(1),
  documentCount: z.number().int().nonnegative(),
  instanceCount: z.number().int().nonnegative(),
  diagnostics: z.array(
    z.strictObject({
      severity: z.enum(["warning", "error"]),
      message: z.string().min(1),
    }),
  ),
});
export const AgentFileResourceResponseSchema = z.union([
  FileResponseBaseSchema.extend({
    operation: z.literal("download"),
    ok: z.literal(true),
    artifact: AgentFileBlobSchema,
  }),
  FileResponseBaseSchema.extend({
    operation: z.enum(["stage", "inspect"]),
    ok: z.literal(true),
    candidate: AgentFileCandidateSummarySchema,
  }),
  FileResponseBaseSchema.extend({
    operation: z.literal("discard"),
    ok: z.literal(true),
    discarded: z.literal(true),
  }),
  FileResponseBaseSchema.extend({
    operation: z.literal("request-approval"),
    ok: z.literal(true),
    candidate: AgentFileCandidateSummarySchema,
    approval: z.literal("pending-human"),
  }),
  FileResponseBaseSchema.extend({
    operation: z.enum([
      "error",
      "download",
      "stage",
      "inspect",
      "discard",
      "request-approval",
    ]),
    ok: z.literal(false),
    error: z.strictObject({
      code: z.string().min(1),
      message: z.string().min(1),
    }),
  }),
]);

export const AgentFileResourceRequestJsonSchema = z.toJSONSchema(
  AgentFileResourceRequestSchema,
  { target: "draft-2020-12", reused: "ref" },
);
export const AgentFileResourceResponseJsonSchema = z.toJSONSchema(
  AgentFileResourceResponseSchema,
  { target: "draft-2020-12", reused: "ref" },
);

/** Strict hosted parser. File requests intentionally have no legacy dialect. */
export function parseAgentFileResourceRequest(
  input: unknown,
): { success: true; data: AgentFileResourceRequest } | { success: false } {
  const parsed = AgentFileResourceRequestSchema.safeParse(input);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false };
}

export type AgentFileResourceRequest = z.infer<
  typeof AgentFileResourceRequestSchema
>;
export type AgentFileResourceResponse = z.infer<
  typeof AgentFileResourceResponseSchema
>;
export type AgentFileCandidateSummary = z.infer<
  typeof AgentFileCandidateSummarySchema
>;
