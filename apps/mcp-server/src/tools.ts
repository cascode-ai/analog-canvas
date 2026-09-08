import { z } from "zod";
import {
  parseSimulationExpression,
  SimulationAnalysisSpecSchema,
  SimulationEnvironmentSelectionSchema,
  SIMULATION_NOISE_INPUT_DENSITY_ID,
  SIMULATION_NOISE_OUTPUT_DENSITY_ID,
  SimulationMeasurementMethodSchema,
} from "@icm/model";
import { SimulationOperationSchema } from "@icm/simulation-service/contract";
import { SimulationFileOperationSchema } from "@icm/simulation-service/files";
import { AGENT_API_VERSION } from "@icm/agent-adapter";
import {
  AgentAuthoringCommandSchema,
  AgentSemanticIntentSchema,
  AgentWireIntentSchema,
  AgentSnapshotRequestSchema,
} from "@icm/agent-adapter";
import {
  AgentSessionError,
  AuthoringActionSchema,
  changedObjectIds,
  type AgentSessionClient,
} from "@icm/agent-client";
import type { McpToolCallResult, McpToolDefinition } from "./protocol.js";
import {
  diagnosticsCompact,
  inspectConnectivity,
  inspectDocument,
  inspectObject,
  searchSnapshot,
  type SearchKind,
} from "./results.js";
import {
  exportFile,
  importFile,
  exportSimulationArtifact,
} from "./file-operations.js";

/**
 * The default MCP tool surface (ADR 0020) stays compact. The full
 * typed edit union is deliberately NOT injected into tool descriptions; it is
 * available through `advanced_transact`; its full contract is an on-demand
 * resource, not a session permission gate.
 */
export interface ToolSessionState {
  client: AgentSessionClient;
}

const ConnectArgs = z.strictObject({
  claimCode: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Claim code from the editor connect panel. Omit to resume the browser-approved connector saved for this MCP host.",
    ),
});
const SimulationArgs = z.strictObject({
  request: SimulationOperationSchema,
  requestId: z.string().min(1).optional(),
});
const SimulationSetupArgs = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("list"),
    documentId: z.string().min(1).optional(),
    rootDocumentId: z.string().min(1).optional(),
  }),
  z.strictObject({
    action: z.literal("get"),
    documentId: z.string().min(1).optional(),
    setupId: z.string().min(1),
  }),
  z.strictObject({
    action: z.literal("create"),
    documentId: z.string().min(1).optional(),
    setupId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(128),
    rootDocumentId: z.string().min(1),
    analyses: z.array(SimulationAnalysisSpecSchema).min(1),
    environment: SimulationEnvironmentSelectionSchema,
  }),
  z.strictObject({
    action: z.literal("update"),
    documentId: z.string().min(1).optional(),
    setupId: z.string().min(1),
    name: z.string().trim().min(1).max(128).optional(),
    rootDocumentId: z.string().min(1).optional(),
    analyses: z.array(SimulationAnalysisSpecSchema).min(1).optional(),
    environment: SimulationEnvironmentSelectionSchema.optional(),
  }),
  z.strictObject({
    action: z.literal("clone"),
    documentId: z.string().min(1).optional(),
    setupId: z.string().min(1),
    newSetupId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(128),
  }),
  z.strictObject({
    action: z.literal("remove"),
    documentId: z.string().min(1).optional(),
    setupId: z.string().min(1),
  }),
]);
const SimulationFilesArgs = z.strictObject({
  request: SimulationFileOperationSchema,
  requestId: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
});
const SimulationOutputArgs = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("list"),
    setupId: z.string().min(1),
    documentId: z.string().min(1).optional(),
  }),
  z.strictObject({
    action: z.literal("upsert"),
    setupId: z.string().min(1),
    documentId: z.string().min(1).optional(),
    outputId: z.string().min(1).optional(),
    label: z.string().trim().min(1).max(128),
    expression: z.string().trim().min(1).max(4096),
  }),
  z.strictObject({
    action: z.literal("remove"),
    setupId: z.string().min(1),
    documentId: z.string().min(1).optional(),
    outputId: z.string().min(1),
  }),
]);

const SimulationMeasurementArgs = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("list"),
    setupId: z.string().min(1),
    documentId: z.string().min(1).optional(),
  }),
  z.strictObject({
    action: z.literal("upsert"),
    setupId: z.string().min(1),
    documentId: z.string().min(1).optional(),
    measurementId: z.string().min(1).optional(),
    label: z.string().trim().min(1).max(128),
    analysis: z.enum(["op", "dc", "ac", "tran", "noise"]),
    outputId: z.string().min(1),
    method: SimulationMeasurementMethodSchema,
  }),
  z.strictObject({
    action: z.literal("remove"),
    setupId: z.string().min(1),
    documentId: z.string().min(1).optional(),
    measurementId: z.string().min(1),
  }),
]);

const SimulationDeviceOperatingPointArgs = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("list"),
    setupId: z.string().min(1),
    documentId: z.string().min(1).optional(),
  }),
  z.strictObject({
    action: z.literal("upsert"),
    setupId: z.string().min(1),
    documentId: z.string().min(1).optional(),
    deviceOperatingPointId: z.string().min(1).optional(),
    targetDocumentId: z.string().min(1),
    instanceId: z.string().min(1),
    occurrence: z.array(z.string().min(1)).max(64).default([]),
  }),
  z.strictObject({
    action: z.literal("remove"),
    setupId: z.string().min(1),
    documentId: z.string().min(1).optional(),
    deviceOperatingPointId: z.string().min(1),
  }),
]);

const ExportFileArgs = z
  .strictObject({
    artifact: z.enum(["project", "svg", "png", "pdf"]),
    documentId: z.string().min(1).optional(),
    outputPath: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (value.artifact !== "project" && !value.documentId) {
      context.addIssue({
        code: "custom",
        path: ["documentId"],
        message: "documentId is required for visual export",
      });
    }
  });

const ImportFileArgs = z
  .strictObject({
    action: z.enum([
      "stage-project",
      "stage-spice",
      "inspect",
      "discard",
      "request-approval",
    ]),
    path: z.string().min(1).optional(),
    rootPath: z.string().min(1).optional(),
    entryPath: z.string().min(1).optional(),
    includePaths: z.array(z.string().min(1)).max(23).optional(),
    namingProfile: z.enum(["native", "cadence-bang"]).optional(),
    candidateId: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    const required =
      value.action === "stage-project"
        ? (["path"] as const)
        : value.action === "stage-spice"
          ? (["rootPath", "entryPath"] as const)
          : (["candidateId"] as const);
    for (const field of required) {
      if (!value[field]) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required for ${value.action}`,
        });
      }
    }
  });

const DocumentArgs = z.strictObject({
  documentId: z.string().min(1).optional(),
  refresh: z.boolean().optional(),
});

const InspectArgs = z.strictObject({
  documentId: z.string().min(1).optional(),
  refresh: z.boolean().optional(),
  target: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("document") }),
    z.strictObject({
      kind: z.literal("object"),
      id: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
    }),
    z.strictObject({
      kind: z.literal("net"),
      id: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
    }),
    z.strictObject({
      kind: z.literal("connectivity"),
      id: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
    }),
    z.strictObject({ kind: z.literal("diagnostics") }),
    z.strictObject({ kind: z.literal("activity") }),
    z.strictObject({
      kind: z.literal("trace"),
      ...AgentSnapshotRequestSchema.shape.traceNet.unwrap().shape,
    }),
  ]),
  detail: z.enum(["compact", "full"]).optional(),
});

const SearchArgs = z.strictObject({
  scope: z.enum(["document", "project"]).optional(),
  documentId: z.string().min(1).optional(),
  refresh: z.boolean().optional(),
  query: z.string().min(1),
  kinds: z
    .array(
      z.enum([
        "instance",
        "net",
        "route",
        "junction",
        "annotation",
        "drafting",
        "property",
        "diagnostic",
      ]),
    )
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const ApplyActionsArgs = z.strictObject({
  documentId: z.string().min(1).optional(),
  actions: z.array(AuthoringActionSchema).min(1).max(256),
});

const AdvancedTransactArgs = z.strictObject({
  documentId: z.string().min(1).optional(),
  edits: z.array(z.unknown()).min(1).max(256).optional(),
  structureEdits: z.array(z.unknown()).min(1).max(256).optional(),
  wireIntent: AgentWireIntentSchema.optional(),
  semanticIntent: AgentSemanticIntentSchema.optional(),
  command: AgentAuthoringCommandSchema.optional(),
  dryRun: z.boolean().optional(),
});

const RenderArgs = z.strictObject({
  mode: z.enum(["formal", "diagnostics"]).optional(),
  bounds: z
    .strictObject({
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  documentId: z.string().min(1).optional(),
});

interface ToolEntry {
  definition: McpToolDefinition;
  handle: (args: unknown, session: ToolSessionState) => Promise<unknown>;
}

const jsonSchemaOf = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { target: "draft-2020-12", reused: "ref" }) as Record<
    string,
    unknown
  >;

function textResult(value: unknown, isError = false): McpToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

export function toolErrorResponse(error: unknown): McpToolCallResult {
  if (error instanceof AgentSessionError) {
    return textResult(
      {
        ok: false,
        error: error.toJSON(),
        hint:
          error.category === "unrecoverable-credential"
            ? "call connect with a fresh claim code from the editor"
            : error.category === "editor-offline"
              ? "the authorized browser editor is not attached; ask the human to reopen the project"
              : undefined,
      },
      true,
    );
  }
  return textResult(
    {
      ok: false,
      error: {
        code: "TOOL_FAILURE",
        message: error instanceof Error ? error.message : String(error),
      },
    },
    true,
  );
}

const TOOLS: readonly ToolEntry[] = [
  {
    definition: {
      name: "connect",
      description:
        "Pair with the live browser editor. Pass its claim code once; later MCP processes can omit it and resume the saved, revocable connector. After connecting, read analog-canvas://reference/quickstart.",
      inputSchema: jsonSchemaOf(ConnectArgs),
    },
    handle: async (args, session) => {
      const parsed = ConnectArgs.parse(args ?? {});
      const report = await session.client.connect(parsed.claimCode);
      return {
        ok: true,
        mode: report.mode,
        projectId: report.projectId,
        documentIds: report.documentIds,
        tokenExpiresAt: report.tokenExpiresAt,
        capabilities: report.capabilities,
        context: report.context,
      };
    },
  },
  {
    definition: {
      name: "disconnect",
      description:
        "Revoke the current browser Agent session and erase this MCP host's saved connector. A fresh editor claim code is required afterwards.",
      inputSchema: jsonSchemaOf(z.strictObject({})),
    },
    handle: async (_args, session) => {
      await session.client.disconnect();
      return { ok: true, state: "revoked" };
    },
  },
  {
    definition: {
      name: "connection_status",
      description:
        "Report pairing and editor-attachment state (unpaired/connecting/online/editor-offline/reconnecting/revoked) plus token validity. Tokens themselves are never returned.",
      inputSchema: jsonSchemaOf(z.strictObject({})),
    },
    handle: async (_args, session) => session.client.status({ refresh: true }),
  },
  {
    definition: {
      name: "simulation",
      description:
        "Prepare one explicitly selected persisted Project setup or a session File Resource workspace, start once, poll/read, cancel, and list export artifacts. Supply the SAME requestId for a start retry. Ordinary failures are recoverable result objects, not session failures. Configure named settings through simulation_setup or full typed replacement through advanced_transact; use ordinary Cell/source edits for DUT/testbench.",
      inputSchema: jsonSchemaOf(SimulationArgs),
    },
    handle: async (args, session) => {
      const { request, requestId } = SimulationArgs.parse(args);
      const effectiveRequestId = requestId ?? crypto.randomUUID();
      try {
        return await session.client.simulationResource({
          ...request,
          apiVersion: AGENT_API_VERSION,
          requestId: effectiveRequestId,
        });
      } catch (error) {
        if (!(error instanceof AgentSessionError)) throw error;
        return {
          ok: false,
          requestId: effectiveRequestId,
          error: {
            code: error.code,
            message: error.message,
            stage: request.operation,
            recovery:
              error.category === "unrecoverable-credential"
                ? "reauthorize"
                : error.category === "request-rejected" &&
                    error.code !== "INVALID_RESPONSE"
                  ? "fix-input"
                  : "retry-same-request",
          },
        };
      }
    },
  },
  {
    definition: {
      name: "simulation_setup",
      description:
        "List or inspect saved Simulation setups; create a structured setup; update its name, Testbench root, analyses, or environment; clone any setup; or remove one. Existing outputs, measurements, and MOS operating-point selections survive updates. Ordinary validation failures return recoverable results and do not end the Agent session. Full typed setup replacement remains available through advanced_transact.",
      inputSchema: { ...jsonSchemaOf(SimulationSetupArgs), type: "object" },
    },
    handle: async (args, session) => {
      const parsed = SimulationSetupArgs.parse(args);
      const snapshot = await session.client.snapshot(parsed.documentId, {
        refresh: true,
      });
      const setups = snapshot.snapshot.project.simulationSetups;
      if (parsed.action === "list") {
        return {
          ok: true,
          setups: setups
            .filter(
              (setup) =>
                !parsed.rootDocumentId ||
                (setup.input.kind === "structured" &&
                  setup.input.rootDocumentId === parsed.rootDocumentId),
            )
            .map((setup) => ({
              id: setup.id,
              name: setup.name,
              kind: setup.input.kind,
              environment: setup.input.environment,
              ...(setup.input.kind === "structured"
                ? {
                    rootDocumentId: setup.input.rootDocumentId,
                    analyses: setup.input.analyses,
                    outputCount: setup.input.outputs.length,
                    measurementCount: setup.input.measurements?.length ?? 0,
                    deviceOperatingPointCount:
                      setup.input.deviceOperatingPoints?.length ?? 0,
                  }
                : { entry: setup.input.entry }),
            })),
        };
      }
      const current = setups.find((setup) => setup.id === parsed.setupId);
      if (parsed.action === "get") {
        return current
          ? { ok: true, setup: current }
          : {
              ok: false,
              error: {
                code: "SIMULATION_SETUP_NOT_FOUND",
                message: `Setup ${parsed.setupId} does not exist; no Project state was changed.`,
                recovery: "fix-input",
              },
            };
      }
      if (parsed.action !== "create" && !current)
        return {
          ok: false,
          error: {
            code: "SIMULATION_SETUP_NOT_FOUND",
            message: `Setup ${parsed.setupId} does not exist; no Project state was changed.`,
            recovery: "fix-input",
          },
        };
      if (parsed.action === "remove") {
        return session.client.advancedTransact(
          {
            structureEdits: [
              { kind: "remove_simulation_setup", setupId: parsed.setupId },
            ],
          },
          { ...(parsed.documentId ? { documentId: parsed.documentId } : {}) },
        );
      }
      let next: (typeof setups)[number];
      if (parsed.action === "create") {
        next = {
          id: parsed.setupId ?? crypto.randomUUID(),
          name: parsed.name,
          version: 2 as const,
          input: {
            kind: "structured" as const,
            rootDocumentId: parsed.rootDocumentId,
            analyses: parsed.analyses,
            outputs: [],
            environment: parsed.environment,
          },
        };
      } else if (parsed.action === "clone") {
        next = structuredClone(current!);
        next.id = parsed.newSetupId ?? crypto.randomUUID();
        next.name = parsed.name;
      } else {
        if (
          parsed.name === undefined &&
          parsed.rootDocumentId === undefined &&
          parsed.analyses === undefined &&
          parsed.environment === undefined
        )
          return {
            ok: false,
            error: {
              code: "SIMULATION_SETUP_UPDATE_EMPTY",
              message:
                "No Setup fields were supplied; no Project state was changed.",
              recovery: "fix-input",
            },
          };
        next = structuredClone(current!);
        if (parsed.name !== undefined) next.name = parsed.name;
        if (
          parsed.rootDocumentId !== undefined ||
          parsed.analyses !== undefined ||
          parsed.environment !== undefined
        ) {
          if (next.input.kind !== "structured")
            return {
              ok: false,
              error: {
                code: "SIMULATION_STRUCTURED_SETUP_REQUIRED",
                message:
                  "Root, analyses, and environment updates require a structured Setup; no Project state was changed.",
                recovery: "fix-input",
              },
            };
          if (parsed.rootDocumentId !== undefined)
            next.input.rootDocumentId = parsed.rootDocumentId;
          if (parsed.analyses !== undefined)
            next.input.analyses = parsed.analyses;
          if (parsed.environment !== undefined)
            next.input.environment = parsed.environment;
        }
      }
      return session.client.advancedTransact(
        {
          structureEdits: [{ kind: "upsert_simulation_setup", setup: next }],
        },
        { ...(parsed.documentId ? { documentId: parsed.documentId } : {}) },
      );
    },
  },
  {
    definition: {
      name: "simulation_output",
      description:
        "List, add, update, or remove outputs in one explicitly addressed named structured Simulation setup. Expressions reference existing output labels and support +, -, *, /, mag, db20, phase, real, imag, and abs. Typed expression ASTs remain available through advanced_transact upsert_simulation_setup. Validation failures are returned without ending the Agent session.",
      inputSchema: { ...jsonSchemaOf(SimulationOutputArgs), type: "object" },
    },
    handle: async (args, session) => {
      const parsed = SimulationOutputArgs.parse(args);
      const snapshot = await session.client.snapshot(parsed.documentId, {
        refresh: true,
      });
      const setup = snapshot.snapshot.project.simulationSetups.find(
        (candidate) => candidate.id === parsed.setupId,
      );
      if (!setup)
        return {
          ok: false,
          error: {
            code: "SIMULATION_SETUP_NOT_FOUND",
            message: `Setup ${parsed.setupId} does not exist; no Project state was changed.`,
            recovery: "fix-input",
          },
        };
      if (setup?.input.kind !== "structured")
        return {
          ok: false,
          error: {
            code: "SIMULATION_STRUCTURED_SETUP_REQUIRED",
            message:
              "Create a structured Simulation setup first; no Project state was changed.",
            recovery: "fix-input",
          },
        };
      if (parsed.action === "list")
        return { ok: true, outputs: setup.input.outputs };
      const next = structuredClone(setup);
      if (next.input.kind !== "structured") throw new Error("unreachable");
      if (parsed.action === "remove") {
        const before = next.input.outputs.length;
        next.input.outputs = next.input.outputs.filter(
          (output) => output.id !== parsed.outputId,
        );
        if (next.input.outputs.length === before)
          return {
            ok: false,
            error: {
              code: "SIMULATION_OUTPUT_NOT_FOUND",
              message: `Output ${parsed.outputId} does not exist; no Project state was changed.`,
              recovery: "fix-input",
            },
          };
        if (next.input.measurements)
          next.input.measurements = next.input.measurements.filter(
            (measurement) => measurement.outputId !== parsed.outputId,
          );
      } else {
        const outputId = parsed.outputId ?? crypto.randomUUID();
        if (
          next.input.outputs.some(
            (output) =>
              output.id !== outputId &&
              output.label.toLowerCase() === parsed.label.toLowerCase(),
          )
        )
          return {
            ok: false,
            error: {
              code: "SIMULATION_OUTPUT_LABEL_DUPLICATE",
              message: `An output named ${parsed.label} already exists; no Project state was changed.`,
              recovery: "fix-input",
            },
          };
        const symbols = new Map(
          next.input.outputs
            .filter((output) => output.id !== outputId)
            .map((output) => [output.label, output.expression] as const),
        );
        const expression = parseSimulationExpression(
          parsed.expression,
          symbols,
        );
        if (!expression.ok)
          return {
            ok: false,
            error: {
              code: `SIMULATION_EXPRESSION_${expression.code}`,
              message: `${expression.message} at character ${expression.offset + 1}; no Project state was changed.`,
              recovery: "fix-input",
            },
          };
        const output = {
          id: outputId,
          label: parsed.label,
          expression: expression.expression,
        };
        const index = next.input.outputs.findIndex(
          (candidate) => candidate.id === outputId,
        );
        if (index < 0) next.input.outputs.push(output);
        else next.input.outputs[index] = output;
      }
      return session.client.advancedTransact(
        {
          structureEdits: [{ kind: "upsert_simulation_setup", setup: next }],
        },
        { ...(parsed.documentId ? { documentId: parsed.documentId } : {}) },
      );
    },
  },
  {
    definition: {
      name: "simulation_measurement",
      description:
        "List, add, update, or remove saved scalar measurement rules in one structured Simulation setup. Rules reduce an existing Output with value, sample-at, minimum, maximum, peak-to-peak, mean, or RMS. Ordinary validation failures are recoverable and do not end the Agent session. Full setup replacement remains available through advanced_transact.",
      inputSchema: {
        ...jsonSchemaOf(SimulationMeasurementArgs),
        type: "object",
      },
    },
    handle: async (args, session) => {
      const parsed = SimulationMeasurementArgs.parse(args);
      const snapshot = await session.client.snapshot(parsed.documentId, {
        refresh: true,
      });
      const setup = snapshot.snapshot.project.simulationSetups.find(
        (candidate) => candidate.id === parsed.setupId,
      );
      if (!setup)
        return {
          ok: false,
          error: {
            code: "SIMULATION_SETUP_NOT_FOUND",
            message: `Setup ${parsed.setupId} does not exist; no Project state was changed.`,
            recovery: "fix-input",
          },
        };
      if (setup.input.kind !== "structured")
        return {
          ok: false,
          error: {
            code: "SIMULATION_STRUCTURED_SETUP_REQUIRED",
            message:
              "Create a structured Simulation setup first; no Project state was changed.",
            recovery: "fix-input",
          },
        };
      if (parsed.action === "list")
        return { ok: true, measurements: setup.input.measurements ?? [] };

      const next = structuredClone(setup);
      if (next.input.kind !== "structured") throw new Error("unreachable");
      const measurements = next.input.measurements ?? [];
      if (parsed.action === "remove") {
        const filtered = measurements.filter(
          (measurement) => measurement.id !== parsed.measurementId,
        );
        if (filtered.length === measurements.length)
          return {
            ok: false,
            error: {
              code: "SIMULATION_MEASUREMENT_NOT_FOUND",
              message: `Measurement ${parsed.measurementId} does not exist; no Project state was changed.`,
              recovery: "fix-input",
            },
          };
        next.input.measurements = filtered;
      } else {
        if (
          !next.input.analyses.some(
            (analysis) => analysis.kind === parsed.analysis,
          )
        )
          return {
            ok: false,
            error: {
              code: "SIMULATION_MEASUREMENT_ANALYSIS_UNAVAILABLE",
              message: `${parsed.analysis.toUpperCase()} is not enabled in this Setup; no Project state was changed.`,
              recovery: "fix-input",
            },
          };
        const reservedNoiseOutput =
          parsed.analysis === "noise" &&
          (parsed.outputId === SIMULATION_NOISE_OUTPUT_DENSITY_ID ||
            parsed.outputId === SIMULATION_NOISE_INPUT_DENSITY_ID);
        if (
          !reservedNoiseOutput &&
          !next.input.outputs.some((output) => output.id === parsed.outputId)
        )
          return {
            ok: false,
            error: {
              code: "SIMULATION_MEASUREMENT_OUTPUT_UNAVAILABLE",
              message: `Output ${parsed.outputId} does not exist; no Project state was changed.`,
              recovery: "fix-input",
            },
          };
        const measurementId = parsed.measurementId ?? crypto.randomUUID();
        if (
          measurements.some(
            (measurement) =>
              measurement.id !== measurementId &&
              measurement.label.toLowerCase() === parsed.label.toLowerCase(),
          )
        )
          return {
            ok: false,
            error: {
              code: "SIMULATION_MEASUREMENT_LABEL_DUPLICATE",
              message: `A measurement named ${parsed.label} already exists; no Project state was changed.`,
              recovery: "fix-input",
            },
          };
        const measurement = {
          id: measurementId,
          label: parsed.label,
          analysis: parsed.analysis,
          outputId: parsed.outputId,
          method: parsed.method,
        };
        const index = measurements.findIndex(
          (candidate) => candidate.id === measurementId,
        );
        if (index < 0) measurements.push(measurement);
        else measurements[index] = measurement;
        next.input.measurements = measurements;
      }
      return session.client.advancedTransact(
        {
          structureEdits: [{ kind: "upsert_simulation_setup", setup: next }],
        },
        { ...(parsed.documentId ? { documentId: parsed.documentId } : {}) },
      );
    },
  },
  {
    definition: {
      name: "simulation_device_operating_point",
      description:
        "List, add, update, or remove selected MOS occurrences whose OP result should include terminal-derived VGS, VDS, VBS, and drain-entering ID. The target is hierarchy-aware. Ordinary validation failures are returned without ending the Agent session.",
      inputSchema: {
        ...jsonSchemaOf(SimulationDeviceOperatingPointArgs),
        type: "object",
      },
    },
    handle: async (args, session) => {
      const parsed = SimulationDeviceOperatingPointArgs.parse(args);
      const snapshot = await session.client.snapshot(parsed.documentId, {
        refresh: true,
      });
      const setup = snapshot.snapshot.project.simulationSetups.find(
        (candidate) => candidate.id === parsed.setupId,
      );
      if (!setup)
        return {
          ok: false,
          error: {
            code: "SIMULATION_SETUP_NOT_FOUND",
            message: `Setup ${parsed.setupId} does not exist; no Project state was changed.`,
            recovery: "fix-input",
          },
        };
      if (setup.input.kind !== "structured")
        return {
          ok: false,
          error: {
            code: "SIMULATION_STRUCTURED_SETUP_REQUIRED",
            message:
              "Create a structured Simulation setup first; no Project state was changed.",
            recovery: "fix-input",
          },
        };
      if (parsed.action === "list")
        return {
          ok: true,
          deviceOperatingPoints: setup.input.deviceOperatingPoints ?? [],
        };
      const next = structuredClone(setup);
      if (next.input.kind !== "structured") throw new Error("unreachable");
      const selections = next.input.deviceOperatingPoints ?? [];
      if (parsed.action === "remove") {
        const filtered = selections.filter(
          (selection) => selection.id !== parsed.deviceOperatingPointId,
        );
        if (filtered.length === selections.length)
          return {
            ok: false,
            error: {
              code: "SIMULATION_DEVICE_OPERATING_POINT_NOT_FOUND",
              message: `Device operating-point selection ${parsed.deviceOperatingPointId} does not exist; no Project state was changed.`,
              recovery: "fix-input",
            },
          };
        next.input.deviceOperatingPoints = filtered;
      } else {
        if (!next.input.analyses.some((analysis) => analysis.kind === "op"))
          return {
            ok: false,
            error: {
              code: "SIMULATION_OPERATING_POINT_ANALYSIS_REQUIRED",
              message:
                "Enable OP in this Setup before selecting MOS operating-point details; no Project state was changed.",
              recovery: "fix-input",
            },
          };
        const id = parsed.deviceOperatingPointId ?? crypto.randomUUID();
        const selection = {
          id,
          documentId: parsed.targetDocumentId,
          instanceId: parsed.instanceId,
          occurrence: parsed.occurrence,
        };
        const index = selections.findIndex((candidate) => candidate.id === id);
        if (index < 0) selections.push(selection);
        else selections[index] = selection;
        next.input.deviceOperatingPoints = selections;
      }
      return session.client.advancedTransact(
        {
          structureEdits: [{ kind: "upsert_simulation_setup", setup: next }],
        },
        { ...(parsed.documentId ? { documentId: parsed.documentId } : {}) },
      );
    },
  },
  {
    definition: {
      name: "simulation_files",
      description:
        "Use the canonical File Resource for an isolated raw testbench workspace: create/list/read/update/discard. list recovers workspace IDs after a lost create response. Writes accept complete authored SPICE text and relative include files, without Canvas or helper-only restrictions. update uses expectedRevision. Fetch an immutable artifact by ID; optional outputPath saves it locally after digest verification. Does not replace the open Project or require import approval.",
      inputSchema: jsonSchemaOf(SimulationFilesArgs),
    },
    handle: async (args, session) => {
      const { request, requestId, outputPath } =
        SimulationFilesArgs.parse(args);
      if (outputPath && request.action !== "artifact")
        return {
          ok: false,
          error: {
            code: "OUTPUT_REQUIRES_ARTIFACT",
            message: "outputPath is only used for artifact downloads",
            recovery: "fix-input",
          },
        };
      const response = await session.client.fileResource({
        apiVersion: AGENT_API_VERSION,
        requestId: requestId ?? crypto.randomUUID(),
        operation: "simulation-input",
        input: request,
      });
      if (!response.ok || response.operation !== "simulation-input")
        return response;
      if (outputPath && response.result.ok && "artifact" in response.result) {
        let chunk = response.result;
        if (chunk.offset !== 0)
          return {
            ok: false,
            error: {
              code: "EXPORT_REQUIRES_START",
              message: "A local export starts at offset 0",
              recovery: "fix-input",
            },
          };
        let text = chunk.text;
        while (chunk.nextOffset !== null) {
          const next = await session.client.fileResource({
            apiVersion: AGENT_API_VERSION,
            requestId: crypto.randomUUID(),
            operation: "simulation-input",
            input: {
              action: "artifact",
              artifactId: chunk.artifact.id,
              offset: chunk.nextOffset,
              maxChars: 65536,
            },
          });
          if (!next.ok || next.operation !== "simulation-input") return next;
          if (!next.result.ok || !("artifact" in next.result))
            return next.result;
          chunk = next.result;
          text += chunk.text;
        }
        return exportSimulationArtifact(
          { artifact: chunk.artifact, text },
          outputPath,
        );
      }
      return response.result;
    },
  },
  {
    definition: {
      name: "export_file",
      description:
        "Export the authoritative browser project or a rendered SVG/PNG/PDF to an explicit local path. Visual exports require documentId.",
      inputSchema: jsonSchemaOf(ExportFileArgs),
    },
    handle: async (args, session) =>
      (() => {
        const parsed = ExportFileArgs.parse(args);
        return exportFile(session.client, {
          artifact: parsed.artifact,
          outputPath: parsed.outputPath,
          ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
        });
      })(),
  },
  {
    definition: {
      name: "import_file",
      description:
        "Stage a local Analog Canvas project or structural SPICE bundle, inspect/discard the candidate, or request browser approval. Staging never replaces the open project by itself.",
      inputSchema: jsonSchemaOf(ImportFileArgs),
    },
    handle: async (args, session) => {
      const parsed = ImportFileArgs.parse(args);
      return importFile(
        session.client,
        parsed.action === "stage-project"
          ? { action: parsed.action, path: parsed.path! }
          : parsed.action === "stage-spice"
            ? {
                action: parsed.action,
                rootPath: parsed.rootPath!,
                entryPath: parsed.entryPath!,
                ...(parsed.namingProfile
                  ? { namingProfile: parsed.namingProfile }
                  : {}),
                ...(parsed.includePaths
                  ? { includePaths: parsed.includePaths }
                  : {}),
              }
            : { action: parsed.action, candidateId: parsed.candidateId! },
      );
    },
  },
  {
    definition: {
      name: "get_context",
      description:
        "Compact context for one authorized document: identity, revision, instance/net counts, and error/warning totals. Refreshes by default so concurrent human edits are visible; set refresh:false only for a deliberate cached read.",
      inputSchema: jsonSchemaOf(DocumentArgs),
    },
    handle: async (args, session) => {
      const parsed = DocumentArgs.parse(args ?? {});
      const entry = await session.client.snapshot(parsed.documentId, {
        refresh: parsed.refresh ?? true,
      });
      const summary = session.client.summary(entry.documentId);
      return {
        ...(summary ?? {}),
        connection: session.client.connection.snapshot.state,
        fetchedAt: entry.fetchedAt,
      };
    },
  },
  {
    definition: {
      name: "inspect",
      description:
        "Read a document, object, net connectivity, diagnostics, or recent MCP activity. Refreshes by default; detail:full returns the document Snapshot with appearance, formulas, interfaces, and project definitions.",
      inputSchema: jsonSchemaOf(InspectArgs),
    },
    handle: async (args, session) => {
      const parsed = InspectArgs.parse(args);
      if (parsed.target.kind === "activity")
        return {
          transactions: session.client.recentTransactions(),
          scope: "current-mcp-process",
        };
      if (parsed.target.kind === "trace")
        return session.client.traceNet(
          {
            netId: parsed.target.netId,
            ...(parsed.target.hierarchyPath
              ? { hierarchyPath: parsed.target.hierarchyPath }
              : {}),
          },
          parsed.documentId,
        );
      const entry = await session.client.snapshot(parsed.documentId, {
        refresh: parsed.refresh ?? true,
      });
      switch (parsed.target.kind) {
        case "document":
          return inspectDocument(entry, parsed.detail ?? "compact");
        case "object":
          return inspectObject(entry, parsed.target);
        case "net":
          return inspectObject(entry, parsed.target);
        case "connectivity":
          return inspectConnectivity(entry, parsed.target);
        case "diagnostics":
          return diagnosticsCompact(entry);
      }
    },
  },
  {
    definition: {
      name: "search",
      description:
        "Case-insensitive search, including LaTeX, over one authorized document or scope:project. Results include documentId. Refreshes by default.",
      inputSchema: jsonSchemaOf(SearchArgs),
    },
    handle: async (args, session) => {
      const parsed = SearchArgs.parse(args);
      const entry = await session.client.snapshot(parsed.documentId, {
        refresh: parsed.refresh ?? true,
      });
      const limit = parsed.limit ?? 20;
      const entries = [entry];
      if (parsed.scope === "project") {
        const allowed = new Set((await session.client.status()).documentIds);
        for (const document of entry.snapshot.project.documents) {
          if (document.id !== entry.documentId && allowed.has(document.id))
            entries.push(
              await session.client.snapshot(document.id, {
                refresh: parsed.refresh ?? true,
              }),
            );
        }
      }
      return {
        query: parsed.query,
        hits: entries
          .flatMap((item) =>
            searchSnapshot(
              item,
              parsed.query,
              parsed.kinds as readonly SearchKind[] | undefined,
              limit,
            ).map((hit) => ({ ...hit, documentId: item.documentId })),
          )
          .slice(0, limit),
      };
    },
  },
  {
    definition: {
      name: "apply_actions",
      description:
        "Apply one atomic edit batch, wire, GUI-planned command, or focus operation. Includes set-model, copy, transform, align, detach-move, unplace, reset-cell, Cell creation/rename/deletion, undo/redo. Split create/wire phases. Helper handles revisions; receipts contain authoritative changes and diagnostics. Examples: analog-canvas://reference/quickstart.",
      inputSchema: jsonSchemaOf(ApplyActionsArgs),
    },
    handle: async (args, session) => {
      const parsed = ApplyActionsArgs.parse(args);
      const report = await session.client.applyActions(parsed.actions, {
        ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
      });
      return report;
    },
  },
  {
    definition: {
      name: "advanced_transact",
      description:
        "Submit exactly one API transaction form: edits, structureEdits, wireIntent, semanticIntent, or command. Helper supplies revisions and IDs. Read analog-canvas://contract/advanced-edits when unfamiliar with an edit; reading is advisory, not a permission gate.",
      inputSchema: jsonSchemaOf(AdvancedTransactArgs),
    },
    handle: async (args, session) => {
      const parsed = AdvancedTransactArgs.parse(args);
      const { documentId: _documentId, dryRun: _dryRun, ...payload } = parsed;
      return session.client.advancedTransact(payload, {
        ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
        ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
      });
    },
  },
  {
    definition: {
      name: "verify",
      description:
        "Refresh the snapshot and report revision, error/warning totals, and which object IDs changed since the cached snapshot. Use after edits or when a transaction reported STATE_CHANGED.",
      inputSchema: jsonSchemaOf(DocumentArgs),
    },
    handle: async (args, session) => {
      const client = session.client;
      const parsed = DocumentArgs.parse(args ?? {});
      const documentId = parsed.documentId;
      const before = client.cachedSnapshot(documentId);
      const fresh = await client.refreshSnapshot(documentId);
      const changed =
        before && before.documentId === fresh.documentId
          ? changedObjectIds(before.snapshot, fresh.snapshot)
          : [];
      const counts = diagnosticsCompact(fresh).counts;
      return { revision: fresh.revision, ...counts, changedObjectIds: changed };
    },
  },
  {
    definition: {
      name: "render",
      description:
        "Render the current document to SVG and return it as an image content block (image/svg+xml) plus a compact text summary (revision, sha256, byteLength).",
      inputSchema: jsonSchemaOf(RenderArgs),
    },
    handle: async (args, session) => {
      const parsed = RenderArgs.parse(args);
      const response = await session.client.render({
        ...(parsed.mode ? { mode: parsed.mode } : {}),
        ...(parsed.bounds ? { bounds: parsed.bounds } : {}),
        ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
      });
      return {
        __render: response,
      };
    },
  },
];

export function listToolDefinitions(): McpToolDefinition[] {
  return TOOLS.map((tool) => tool.definition);
}

/** Marker for a tool that completed with a structured failure payload. */
export class ToolFailure {
  constructor(readonly value: unknown) {}
}

export async function callTool(
  name: string,
  args: unknown,
  session: ToolSessionState,
): Promise<McpToolCallResult> {
  const tool = TOOLS.find((entry) => entry.definition.name === name);
  if (!tool) {
    return textResult(
      { ok: false, error: { code: "UNKNOWN_TOOL", message: name } },
      true,
    );
  }
  try {
    const result = await tool.handle(args ?? {}, session);
    if (result instanceof ToolFailure) {
      return textResult(result.value, true);
    }
    if (result !== null && typeof result === "object" && "__render" in result) {
      const response = (
        result as {
          __render: Awaited<ReturnType<AgentSessionClient["render"]>>;
        }
      ).__render;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                revision: response.revision,
                mode: response.artifact.mode,
                byteLength: response.artifact.byteLength,
                sha256: response.artifact.sha256,
                diagnostics: response.diagnostics.length,
              },
              null,
              2,
            ),
          },
          {
            type: "image",
            data: response.artifact.data,
            mimeType: "image/svg+xml",
          },
        ],
      };
    }
    // Structured reports carry their own `ok: false` failure state.
    const failed =
      result !== null &&
      typeof result === "object" &&
      "ok" in result &&
      (result as { ok?: unknown }).ok === false;
    return textResult(result, failed);
  } catch (error) {
    return toolErrorResponse(error);
  }
}
