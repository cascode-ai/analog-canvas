import {
  AGENT_API_VERSION,
  AgentCircuitRequestJsonSchema,
  AgentCircuitResponseJsonSchema,
} from "./schema.js";
import {
  AgentFileResourceRequestJsonSchema,
  AgentFileResourceResponseJsonSchema,
} from "./file-resource.js";
import {
  AgentSimulationResourceRequestJsonSchema,
  AgentSimulationResourceResponseJsonSchema,
} from "./simulation-resource.js";
import {
  AgentClaimRequestJsonSchema,
  AgentConnectionCredentialResponseJsonSchema,
  AgentConnectorResumeRequestJsonSchema,
  AgentTransportErrorResponseJsonSchema,
} from "./envelope.js";

function componentSchema(
  value: Record<string, unknown>,
  componentName: string,
): Record<string, unknown> {
  return componentSchemaValue(value, componentName) as Record<string, unknown>;
}

function componentSchemaValue(value: unknown, componentName: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => componentSchemaValue(item, componentName));
  }
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      // OpenAPI 3.1 supplies the dialect for component schemas.
      if (key === "$schema") return [];
      if (
        key === "$ref" &&
        typeof item === "string" &&
        item.startsWith("#/$defs/")
      ) {
        return [
          [key, `#/components/schemas/${componentName}/${item.slice(2)}`],
        ];
      }
      return [[key, componentSchemaValue(item, componentName)]];
    }),
  );
}

const agentCircuitRequestSchema = componentSchema(
  AgentCircuitRequestJsonSchema as Record<string, unknown>,
  "agentCircuitRequest",
);
const agentCircuitResponseSchema = componentSchema(
  AgentCircuitResponseJsonSchema as Record<string, unknown>,
  "agentCircuitResponse",
);
const agentFileResourceRequestSchema = componentSchema(
  AgentFileResourceRequestJsonSchema as Record<string, unknown>,
  "agentFileResourceRequest",
);
const agentFileResourceResponseSchema = componentSchema(
  AgentFileResourceResponseJsonSchema as Record<string, unknown>,
  "agentFileResourceResponse",
);
const agentSimulationResourceRequestSchema = componentSchema(
  AgentSimulationResourceRequestJsonSchema as Record<string, unknown>,
  "agentSimulationResourceRequest",
);
const agentSimulationResourceResponseSchema = componentSchema(
  AgentSimulationResourceResponseJsonSchema as Record<string, unknown>,
  "agentSimulationResourceResponse",
);
const agentClaimRequestSchema = componentSchema(
  AgentClaimRequestJsonSchema as Record<string, unknown>,
  "agentClaimRequest",
);
const agentConnectorResumeRequestSchema = componentSchema(
  AgentConnectorResumeRequestJsonSchema as Record<string, unknown>,
  "agentConnectorResumeRequest",
);
const agentConnectionCredentialResponseSchema = componentSchema(
  AgentConnectionCredentialResponseJsonSchema as Record<string, unknown>,
  "agentClaimResponse",
);
const agentTransportErrorResponseSchema = componentSchema(
  AgentTransportErrorResponseJsonSchema as Record<string, unknown>,
  "agentTransportErrorResponse",
);
const agentCircuitRequestRef = {
  $ref: "#/components/schemas/agentCircuitRequest",
} as const;
const agentCircuitResponseRef = {
  $ref: "#/components/schemas/agentCircuitResponse",
} as const;
const agentFileResourceRequestRef = {
  $ref: "#/components/schemas/agentFileResourceRequest",
} as const;
const agentFileResourceResponseRef = {
  $ref: "#/components/schemas/agentFileResourceResponse",
} as const;
const agentSimulationResourceRequestRef = {
  $ref: "#/components/schemas/agentSimulationResourceRequest",
} as const;
const agentSimulationResourceResponseRef = {
  $ref: "#/components/schemas/agentSimulationResourceResponse",
} as const;

export const agentCircuitRequestExamples = {
  capabilities: {
    summary: "Discover the current four-operation contract and limits",
    value: {
      apiVersion: "2.0",
      requestId: "capabilities-1",
      operation: "capabilities",
    },
  },
  snapshot: {
    summary: "Read one complete authorized Document",
    value: {
      apiVersion: "2.0",
      requestId: "snapshot-1",
      operation: "snapshot",
      documentId: "document-main",
      includeSourceSpans: false,
    },
  },
  transactDryRun: {
    summary: "Dry-run one atomic edit batch before committing the same edits",
    value: {
      apiVersion: "2.0",
      requestId: "dry-run-1",
      operation: "transact",
      documentId: "document-main",
      transactionId: "place-vin-1",
      expectedRevision: 0,
      dryRun: true,
      edits: [
        {
          kind: "add_instance",
          instance: {
            id: "VIN",
            symbolId: "port",
            placement: {
              position: { x: 200, y: 260 },
              rotation: 0,
              mirror: "none",
            },
          },
        },
      ],
    },
  },
  render: {
    summary: "Render the formal scene after a successful commit",
    value: {
      apiVersion: "2.0",
      requestId: "render-1",
      operation: "render",
      documentId: "document-main",
      mode: "formal",
    },
  },
} as const;

export const agentClaimRequestExample = {
  claimCode: "session-id.claim-code",
} as const;

export const agentTransportErrorExamples = {
  "404": {
    ok: false,
    error: {
      code: "SESSION_NOT_FOUND",
      message: "Session is unknown or expired",
    },
  },
  "401": {
    ok: false,
    error: {
      code: "TOKEN_INVALID",
      message: "Bearer token is missing or unknown",
    },
  },
  "403": {
    ok: false,
    error: {
      code: "TOKEN_SCOPE_INSUFFICIENT",
      message: "Bearer token does not grant the required scope",
    },
  },
  "409": {
    ok: false,
    error: {
      code: "REQUEST_ID_REUSED",
      message: "requestId was already used with a different payload",
    },
  },
  "413": {
    ok: false,
    error: {
      code: "REQUEST_TOO_LARGE",
      message: "Request exceeds the byte limit",
    },
  },
  "429": {
    ok: false,
    error: { code: "RATE_LIMITED", message: "Session rate limit exceeded" },
  },
  "503": {
    ok: false,
    error: { code: "EDITOR_OFFLINE", message: "Editor is offline" },
  },
  "504": {
    ok: false,
    error: {
      code: "REQUEST_TIMEOUT",
      message: "The browser did not complete the request in time",
    },
  },
} as const;

function transportErrorResponse(
  example: (typeof agentTransportErrorExamples)[keyof typeof agentTransportErrorExamples],
) {
  return {
    description: "Typed Agent session transport error",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/agentTransportErrorResponse" },
        example,
      },
    },
  } as const;
}

const circuitSessionResponses = {
  "200": {
    description: "Circuit API response",
    content: { "application/json": { schema: agentCircuitResponseRef } },
  },
  "400": {
    description: "Malformed JSON or request-schema violation",
    content: {
      "application/json": {
        schema: agentCircuitResponseRef,
        example: {
          apiVersion: "2.0",
          requestId: "req-123",
          operation: "error",
          ok: false,
          error: {
            code: "INVALID_REQUEST",
            message: "Request does not match the Circuit API schema",
          },
          diagnostics: [
            {
              code: "SCHEMA_VIOLATION",
              domain: "schema",
              severity: "error",
              path: ["edits", 2, "instance", "symbolVariantId"],
              message: "Expected a non-empty string or omitted field",
            },
          ],
        },
      },
    },
  },
  "401": transportErrorResponse(agentTransportErrorExamples["401"]),
  "403": transportErrorResponse(agentTransportErrorExamples["403"]),
  "404": transportErrorResponse(agentTransportErrorExamples["404"]),
  "409": transportErrorResponse(agentTransportErrorExamples["409"]),
  "413": transportErrorResponse(agentTransportErrorExamples["413"]),
  "429": transportErrorResponse(agentTransportErrorExamples["429"]),
  "503": transportErrorResponse(agentTransportErrorExamples["503"]),
  "504": transportErrorResponse(agentTransportErrorExamples["504"]),
} as const;

const fileSessionResponses = {
  "200": {
    description:
      "Scoped file-resource response. Imported candidates remain browser-local until human approval.",
    content: { "application/json": { schema: agentFileResourceResponseRef } },
  },
  "400": transportErrorResponse(agentTransportErrorExamples["413"]),
  "401": transportErrorResponse(agentTransportErrorExamples["401"]),
  "403": transportErrorResponse(agentTransportErrorExamples["403"]),
  "404": transportErrorResponse(agentTransportErrorExamples["404"]),
  "409": transportErrorResponse(agentTransportErrorExamples["409"]),
  "413": transportErrorResponse(agentTransportErrorExamples["413"]),
  "429": transportErrorResponse(agentTransportErrorExamples["429"]),
  "503": transportErrorResponse(agentTransportErrorExamples["503"]),
  "504": transportErrorResponse(agentTransportErrorExamples["504"]),
} as const;

const simulationSessionResponses = {
  "200": {
    description:
      "Scoped simulation-resource response. A run that reached the simulator returns its result -- including a failed or timed-out outcome, whose diagnostics are ngspice's own words. A run that never happened returns a typed refusal saying why.",
    content: {
      "application/json": { schema: agentSimulationResourceResponseRef },
    },
  },
  "400": transportErrorResponse(agentTransportErrorExamples["413"]),
  "401": transportErrorResponse(agentTransportErrorExamples["401"]),
  "403": transportErrorResponse(agentTransportErrorExamples["403"]),
  "404": transportErrorResponse(agentTransportErrorExamples["404"]),
  "409": transportErrorResponse(agentTransportErrorExamples["409"]),
  "413": transportErrorResponse(agentTransportErrorExamples["413"]),
  "429": transportErrorResponse(agentTransportErrorExamples["429"]),
  "503": transportErrorResponse(agentTransportErrorExamples["503"]),
  "504": transportErrorResponse(agentTransportErrorExamples["504"]),
} as const;

const claimResponses = {
  "200": {
    description: "Claim redeemed",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/agentClaimResponse" },
      },
    },
  },
  "401": transportErrorResponse(agentTransportErrorExamples["401"]),
  "404": transportErrorResponse(agentTransportErrorExamples["404"]),
  "409": transportErrorResponse(agentTransportErrorExamples["409"]),
  "413": transportErrorResponse(agentTransportErrorExamples["413"]),
} as const;

export const agentCircuitOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Interactive Circuit Maker Agent Circuit API",
    version: AGENT_API_VERSION,
  },
  paths: {
    "/api/agent/claims": {
      post: {
        operationId: "agentClaimRedeem",
        description:
          "Exchange a short-lived claim code for a scoped, expiring bearer token. Repeating a valid claim replaces the prior token.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/agentClaimRequest" },
              example: agentClaimRequestExample,
            },
          },
        },
        responses: claimResponses,
      },
    },
    "/api/agent/connectors/resume": {
      post: {
        operationId: "agentConnectorResume",
        description:
          "Exchange a server-issued persistent connector credential for a fresh short-lived Circuit bearer. The connector remains revocable with its browser session.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/agentConnectorResumeRequest",
              },
            },
          },
        },
        responses: claimResponses,
      },
    },
    "/api/agent/sessions/{sessionId}/circuit": {
      post: {
        operationId: "agentSessionCircuit",
        description:
          "Send one Circuit API request over the session. The relay validates the strict payload and required token scopes, then forwards it to the live browser without applying or rewriting edits.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string", minLength: 1 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: agentCircuitRequestRef,
              examples: agentCircuitRequestExamples,
            },
          },
        },
        responses: circuitSessionResponses,
      },
    },
    "/api/agent/sessions/{sessionId}/files": {
      post: {
        operationId: "agentSessionFileResource",
        description:
          "Use formal Project/SVG/PNG/PDF download or stage a Project/structural-SPICE candidate in browser memory. Staging never changes the live Project; only a visible browser confirmation may accept it.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string", minLength: 1 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: agentFileResourceRequestRef },
          },
        },
        responses: fileSessionResponses,
      },
    },
    "/api/agent/sessions/{sessionId}/simulation": {
      post: {
        operationId: "agentSessionSimulationResource",
        description:
          "Prepare immutable structured or raw input; start returns a short run receipt. Read/cancel by run ID, export artifact references through the File Resource. Exact start request-ID retries never execute twice. Ordinary input and execution failures leave the session usable. Prepared inputs and receipts are session-local, not a durable job queue.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string", minLength: 1 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: agentSimulationResourceRequestRef },
          },
        },
        responses: simulationSessionResponses,
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      agentClaimRequest: agentClaimRequestSchema,
      agentConnectorResumeRequest: agentConnectorResumeRequestSchema,
      agentTransportErrorResponse: agentTransportErrorResponseSchema,
      agentCircuitRequest: agentCircuitRequestSchema,
      agentCircuitResponse: agentCircuitResponseSchema,
      agentFileResourceRequest: agentFileResourceRequestSchema,
      agentFileResourceResponse: agentFileResourceResponseSchema,
      agentSimulationResourceRequest: agentSimulationResourceRequestSchema,
      agentSimulationResourceResponse: agentSimulationResourceResponseSchema,
      agentClaimResponse: agentConnectionCredentialResponseSchema,
    },
  },
} as const;
