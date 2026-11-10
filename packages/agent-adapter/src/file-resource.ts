import { z } from "zod";

import { lazyJsonSchema } from "./lazy-json-schema.js";
import {
  SimulationFileOperationSchema,
  SimulationFileResultSchema,
} from "@icm/simulation-service/files";
import { ProblemSchema } from "@icm/simulation-service/contract";
import { GridRectSchema } from "@icm/model";

import { AGENT_API_VERSION } from "./schema.js";

const StableIdSchema = z.string().min(1).max(256);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

/**
 * The most one file-resource request or response carries, decoded. Its
 * base64 envelope, about 13.4 MB, stays well under the 32 MiB WebSocket
 * message a Durable Object receives, and the relay's few copies of it well
 * under an isolate's 128 MB. At 1.5 MB, a Project of 75 Cells could no longer
 * be downloaded.
 */
export const AGENT_FILE_RESOURCE_MAX_BYTES = 10_000_000;
export const AGENT_FILE_RESOURCE_MAX_FILES = 24;
export const AGENT_FILE_CANDIDATE_TTL_MS = 5 * 60_000;

const AgentFileBlobSchema = z.strictObject({
  name: z.string().min(1).max(512),
  mediaType: z.string().min(1).max(128),
  encoding: z.literal("base64"),
  data: z.string().min(4),
  // No ceiling here: the editor enforces the one it advertises
  // (capabilities `fileResource.maxBytes`) on what it accepts and sends. A
  // ceiling built into the schema had held every installed client at the
  // old one.
  byteLength: z.number().int().positive(),
  sha256: Sha256Schema,
});

const FileRequestBaseSchema = z.strictObject({
  apiVersion: z.literal(AGENT_API_VERSION),
  requestId: StableIdSchema,
});

const AgentLocalSourceFileSchema = z.strictObject({
  path: z.string().min(1).max(512),
  sha256: Sha256Schema,
  byteLength: z.number().int().positive(),
});

const AgentFileDiagnosticSchema = z.strictObject({
  severity: z.enum(["warning", "error"]),
  message: z.string().min(1),
  code: z.string().min(1).optional(),
});

const AgentLocalSourceSchema = z.strictObject({
  version: Sha256Schema,
  entryPath: z.string().min(1).max(512),
  files: z
    .array(AgentLocalSourceFileSchema)
    .min(1)
    .max(AGENT_FILE_RESOURCE_MAX_FILES),
  format: z.enum(["project", "rnl", "spice", "spectre"]),
  drawing: z.enum([
    "native",
    "preserved",
    "partial",
    "discarded",
    "not-provided",
  ]),
  electrical: z.enum(["verified", "not-verified"]),
  diagnostics: z.array(AgentFileDiagnosticSchema),
});

export type AgentLocalSource = z.infer<typeof AgentLocalSourceSchema>;

export const AgentRnlAppearanceSchema = z
  .enum(["canvas", "source"])
  .describe(
    "RNL appearance in Canvas. Defaults to native Canvas conventions. Use source for authored styling.",
  );
export type AgentRnlAppearance = z.infer<typeof AgentRnlAppearanceSchema>;
/**
 * Device types an Agent states for models whose cards the delivered sources
 * lack (a foundry library kept external). A card the sources give decides.
 */
export const AgentLocalModelTypesSchema = z
  .record(
    z.string().min(1).max(128),
    z.enum(["nmos", "pmos", "npn", "pnp", "d"]),
  )
  .refine((types) => Object.keys(types).length <= 256, {
    message: "At most 256 model types",
  });
export type AgentLocalModelTypes = z.infer<typeof AgentLocalModelTypesSchema>;

export function hasRnlCommentRecords(text: string): boolean {
  return /^(?:\*|\/\/) @RNL\b/mu.test(text);
}

export function localSourceIdentity(
  entryPath: string,
  files: readonly { name: string; sha256: string }[],
): string {
  const byPath = files.map(({ name, sha256 }) => [name, sha256]).sort();
  return JSON.stringify([entryPath, byPath]);
}

export const AgentLocalProjectReceiptSchema = z.strictObject({
  source: AgentLocalSourceSchema,
  disposition: z.enum(["opened", "reused"]),
  previousRevision: z.enum(["unconfirmed", "live", "recovered-snapshot"]),
  workspaceId: StableIdSchema,
  projectId: StableIdSchema,
  structureRevision: z.number().int().nonnegative(),
  modified: z.boolean(),
  topDocumentId: StableIdSchema,
  document: z.strictObject({
    id: StableIdSchema,
    name: z.string(),
    revision: z.number().int().nonnegative(),
    sourceStatus: z.enum([
      "in-sync",
      "geometry-only-changed",
      "connectivity-modified",
    ]),
    source: z
      .strictObject({
        path: z.string().min(1),
        line: z.number().int().positive(),
        representation: z.enum(["original", "parsed"]),
      })
      .optional(),
  }),
});

export type AgentLocalProjectReceipt = z.infer<
  typeof AgentLocalProjectReceiptSchema
>;

export const AgentReviewTargetSchema = z.strictObject({
  projectId: StableIdSchema,
  workspaceId: StableIdSchema.optional(),
  workspaceGeneration: StableIdSchema,
  documentId: StableIdSchema,
  structureRevision: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  sourceVersion: Sha256Schema.optional(),
});

const AgentReviewReceiptSchema = AgentReviewTargetSchema.extend({
  sourceStatus:
    AgentLocalProjectReceiptSchema.shape.document.shape.sourceStatus,
  unplacedInstances: z.number().int().nonnegative(),
  bounds: GridRectSchema.optional(),
});
export type AgentReviewTarget = z.infer<typeof AgentReviewTargetSchema>;
export type AgentReviewReceipt = z.infer<typeof AgentReviewReceiptSchema>;

export function matchesAgentReviewTarget(
  receipt: AgentReviewTarget,
  expected: AgentReviewTarget,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => receipt[key as keyof AgentReviewTarget] === value,
  );
}

const ComparisonStatusSchema = z.enum(["equal", "different", "inconclusive"]);
/** The drawing against the delivered netlist, over the whole design. */
const ReviewComparisonSchema = z.strictObject({
  sourceVersion: Sha256Schema,
  status: ComparisonStatusSchema,
  topology: ComparisonStatusSchema,
  summary: z.string(),
  comparedCells: z.number().int().nonnegative(),
  /** Why the result is inconclusive. */
  reasons: z.array(z.string()),
  /** What the comparison left out, such as model cards and includes. */
  notes: z.array(z.string()),
  differences: z
    .array(
      z.strictObject({
        kind: z.string(),
        cell: z.string(),
        object: z.string(),
        expected: z.unknown(),
        actual: z.unknown(),
        source: z
          .strictObject({
            path: z.string().min(1),
            line: z.number().int().positive(),
          })
          .optional(),
      }),
    )
    .max(200),
  detailsTruncated: z.boolean(),
});
export type ReviewComparison = z.infer<typeof ReviewComparisonSchema>;

/** A delivered working copy as it is now; Canvas keeps no review state. */
const LocalReviewDeliverySchema = z.strictObject({
  workspaceId: StableIdSchema,
  source: z.strictObject({
    entryPath: z.string().min(1),
    version: Sha256Schema,
  }),
  /** Cells whose drawing still lacks an Instance or a connection. */
  incompleteCells: z.array(
    z.strictObject({
      documentId: StableIdSchema,
      name: z.string(),
      unplacedInstances: z.number().int().nonnegative(),
      unroutedConnections: z.number().int().nonnegative(),
    }),
  ),
});
export type LocalReviewDelivery = z.infer<typeof LocalReviewDeliverySchema>;

export const LocalReviewDeliveryArgsSchema = z.strictObject({});

export const AgentFileDownloadOptionsSchema = z
  .strictObject({
    artifact: z
      .enum(["project", "svg", "png", "pdf", "simulation-plot"])
      .describe(
        "Project and Canvas exports. simulation-plot is a retired compatibility request and returns SIMULATION_PLOT_RETIRED; use simulation-input artifact access for raw/CSV/Spec results.",
      ),
    documentId: StableIdSchema.optional(),
    includeReview: z
      .boolean()
      .optional()
      .describe(
        "Include the live workspace and revision receipt with a visual export.",
      ),
    expected: AgentReviewTargetSchema.optional().describe(
      "Require this live Canvas revision before exporting an image.",
    ),
    bounds: GridRectSchema.optional().describe(
      "Exact SVG or PNG crop in Canvas coordinates.",
    ),
    simulation: z
      .strictObject({
        runId: StableIdSchema,
        /** Historical plot selection, accepted only to return the retirement error. */
        analysisIndex: z.number().int().nonnegative(),
        format: z.enum(["svg", "png"]),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.bounds && value.artifact !== "svg" && value.artifact !== "png")
      context.addIssue({
        code: "custom",
        path: ["bounds"],
        message: "Only SVG and PNG exports take a crop",
      });
    if (
      (value.includeReview || value.expected) &&
      (value.artifact === "project" ||
        value.artifact === "simulation-plot" ||
        (value.expected && value.expected.documentId !== value.documentId))
    )
      context.addIssue({
        code: "custom",
        path: ["documentId"],
        message: "Review receipts address the visual document being exported",
      });
    if (value.artifact === "simulation-plot") {
      if (!value.simulation)
        context.addIssue({
          code: "custom",
          path: ["simulation"],
          message:
            "An explicit run and analysis record are required for plot export",
        });
      if (value.documentId)
        context.addIssue({
          code: "custom",
          path: ["documentId"],
          message: "Simulation plots address a run, not a Canvas document",
        });
    } else {
      if (value.simulation)
        context.addIssue({
          code: "custom",
          path: ["simulation"],
          message: "Simulation selection is only used for simulation-plot",
        });
      if (value.artifact !== "project" && !value.documentId)
        context.addIssue({
          code: "custom",
          path: ["documentId"],
          message: "documentId is required for visual export",
        });
    }
  });

export const AgentFileResourceRequestSchema = z.discriminatedUnion(
  "operation",
  [
    FileRequestBaseSchema.extend({
      operation: z.literal("simulation-input"),
      input: SimulationFileOperationSchema,
    }),
    AgentFileDownloadOptionsSchema.safeExtend({
      apiVersion: z.literal(AGENT_API_VERSION),
      requestId: StableIdSchema,
      operation: z.literal("download"),
      // A client that reads the response's `warnings` says so. One released
      // before them refuses a response field it does not know, so a PDF
      // that would leave characters out is refused for it, naming them
      // (#2179).
      includeWarnings: z.literal(true).optional(),
    }),
    FileRequestBaseSchema.extend({
      operation: z.literal("stage"),
      kind: z.enum(["project", "structural-spice", "local-circuit"]),
      files: z
        .array(AgentFileBlobSchema)
        .min(1)
        .max(AGENT_FILE_RESOURCE_MAX_FILES),
      entryPath: z.string().min(1).max(512).optional(),
      namingProfile: z.enum(["native", "cadence-bang"]).optional(),
      rnlAppearance: AgentRnlAppearanceSchema.optional(),
      modelTypes: AgentLocalModelTypesSchema.optional(),
    }),
    FileRequestBaseSchema.extend({
      operation: z.literal("locate-local"),
      sourceVersion: Sha256Schema,
      background: z.boolean().optional(),
      rnlAppearance: AgentRnlAppearanceSchema.optional(),
      taskRef: z.uuid().optional(),
    }),
    FileRequestBaseSchema.extend({
      operation: z.literal("review"),
    }),
    FileRequestBaseSchema.extend({
      operation: z.literal("inspect"),
      candidateId: StableIdSchema,
      documentId: StableIdSchema.optional(),
    }),
    FileRequestBaseSchema.extend({
      operation: z.literal("import-cell"),
      candidateId: StableIdSchema,
      sourceDocumentId: StableIdSchema,
      targetDocumentId: StableIdSchema,
      mode: z.enum(["replace-body", "append"]),
      expectedStructureRevision: z.number().int().nonnegative(),
      expectedRevision: z.number().int().nonnegative(),
    }),
    FileRequestBaseSchema.extend({
      operation: z.literal("discard"),
      candidateId: StableIdSchema,
    }),
    FileRequestBaseSchema.extend({
      operation: z.literal("request-approval"),
      candidateId: StableIdSchema,
    }),
    FileRequestBaseSchema.extend({
      operation: z.literal("open"),
      candidateId: StableIdSchema,
      background: z.boolean().optional(),
      taskRef: z.uuid().optional(),
    }),
  ],
);

const FileResponseBaseSchema = z.strictObject({
  apiVersion: z.literal(AGENT_API_VERSION),
  requestId: StableIdSchema,
});
export const AgentFileCandidateSummarySchema = z.strictObject({
  candidateId: StableIdSchema,
  kind: z.enum(["project", "structural-spice", "local-circuit"]),
  expiresAt: z.string().datetime(),
  projectName: z.string().min(1),
  documentCount: z.number().int().nonnegative(),
  instanceCount: z.number().int().nonnegative(),
  documents: z
    .array(
      z.strictObject({
        id: StableIdSchema,
        name: z.string(),
        instanceCount: z.number().int().nonnegative(),
        terminalNames: z.array(z.string()),
      }),
    )
    .optional(),
  diagnostics: z.array(AgentFileDiagnosticSchema),
  source: AgentLocalSourceSchema.optional(),
  importMs: z.number().nonnegative().optional(),
});
export const AgentFileResourceResponseSchema = z.union([
  FileResponseBaseSchema.extend({
    operation: z.literal("simulation-input"),
    ok: z.literal(true),
    result: z.union([
      SimulationFileResultSchema,
      z.strictObject({ ok: z.literal(false), error: ProblemSchema }),
    ]),
  }),
  FileResponseBaseSchema.extend({
    operation: z.literal("download"),
    ok: z.literal(true),
    artifact: AgentFileBlobSchema,
    review: AgentReviewReceiptSchema.optional(),
    warnings: z
      .array(z.string().min(1).max(1000))
      .min(1)
      .max(16)
      .optional()
      .describe(
        "What the artifact leaves out, e.g. characters no PDF font holds",
      ),
  }),
  FileResponseBaseSchema.extend({
    operation: z.enum(["stage", "inspect"]),
    ok: z.literal(true),
    candidate: AgentFileCandidateSummarySchema,
    documentCode: z
      .string()
      .optional()
      .describe(
        "Canonical staged SchematicDocument JSON, only for an explicit inspect.documentId; not a live document.",
      ),
  }),
  FileResponseBaseSchema.extend({
    operation: z.literal("import-cell"),
    ok: z.literal(true),
    targetDocumentId: StableIdSchema,
    importedDocumentIds: z.array(StableIdSchema),
    structureRevision: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
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
    operation: z.literal("open"),
    ok: z.literal(true),
    delivery: AgentLocalProjectReceiptSchema.optional(),
  }),
  FileResponseBaseSchema.extend({
    operation: z.literal("locate-local"),
    ok: z.literal(true),
    delivery: AgentLocalProjectReceiptSchema.nullable(),
  }),
  FileResponseBaseSchema.extend({
    operation: z.literal("review"),
    ok: z.literal(true),
    delivery: LocalReviewDeliverySchema,
    comparison: ReviewComparisonSchema,
  }),
  FileResponseBaseSchema.extend({
    operation: z.enum([
      "error",
      "download",
      "stage",
      "inspect",
      "discard",
      "request-approval",
      "open",
      "locate-local",
      "review",
      "simulation-input",
      "import-cell",
    ]),
    ok: z.literal(false),
    error: z.strictObject({
      code: z.string().min(1),
      message: z.string().min(1),
    }),
  }),
]);

export const agentFileResourceRequestJsonSchema = lazyJsonSchema(
  AgentFileResourceRequestSchema,
);
export const agentFileResourceResponseJsonSchema = lazyJsonSchema(
  AgentFileResourceResponseSchema,
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
