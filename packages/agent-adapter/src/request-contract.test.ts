import { describe, expect, it } from "vitest";

import {
  AgentClaimRequestSchema,
  AgentTransportErrorResponseSchema,
} from "./envelope.js";
import {
  AgentProductionCircuitRequestSchema,
  AgentCircuitResponseSchema,
} from "./schema.js";
import {
  agentCircuitOpenApi,
  agentCircuitRequestExamples,
  agentClaimRequestExample,
  agentTransportErrorExamples,
} from "./openapi.js";
import {
  invalidAgentRequestResponse,
  parseAgentCircuitRequest,
} from "./request-contract.js";

describe("Agent golden request contract", () => {
  it("validates every published Circuit example with the production schema", () => {
    for (const example of Object.values(agentCircuitRequestExamples)) {
      expect(
        AgentProductionCircuitRequestSchema.safeParse(example.value),
        example.summary,
      ).toMatchObject({ success: true });
    }
    expect(
      AgentClaimRequestSchema.safeParse(agentClaimRequestExample),
    ).toMatchObject({
      success: true,
    });
  });

  it("publishes claim, Circuit, and the separate File Resource paths", () => {
    for (const apiVersion of ["1.0", "3.0"] as const) {
      expect(
        AgentProductionCircuitRequestSchema.safeParse({
          apiVersion,
          requestId: `capabilities-${apiVersion}`,
          operation: "capabilities",
        }),
      ).toMatchObject({ success: false });
    }
    expect(Object.keys(agentCircuitOpenApi.paths).sort()).toEqual([
      "/api/agent/claims",
      "/api/agent/connectors/resume",
      "/api/agent/sessions/{sessionId}/circuit",
      "/api/agent/sessions/{sessionId}/files",
      "/api/agent/sessions/{sessionId}/simulation",
    ]);
  });

  it("returns every violation with a stable redacted path", () => {
    const parsed = parseAgentCircuitRequest({
      apiVersion: "2.0",
      requestId: "req-123",
      operation: "transact",
      documentId: "document-main",
      transactionId: "tx-1",
      expectedRevision: 0,
      edits: [
        { kind: "noop" },
        { kind: "noop" },
        {
          kind: "add_instance",
          instance: {
            id: "VIN",
            symbolId: "port",
            symbolVariantId: "",
            placement: null,
          },
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.response).toMatchObject({
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
    });
    expect(JSON.stringify(parsed.response)).not.toContain("agentToken");
  });

  it("uses the same envelope for malformed JSON without inventing a path", () => {
    const response = invalidAgentRequestResponse(undefined);
    expect(AgentCircuitResponseSchema.parse(response)).toMatchObject({
      requestId: "invalid-request",
      operation: "error",
      ok: false,
      error: { code: "INVALID_REQUEST" },
      diagnostics: [],
    });
  });

  it("rejects migration-only annotation and spice property writes", () => {
    const legacyAnnotation = AgentProductionCircuitRequestSchema.safeParse({
      apiVersion: "2.0",
      requestId: "legacy-annotation",
      operation: "transact",
      documentId: "document-main",
      transactionId: "legacy-annotation",
      expectedRevision: 0,
      edits: [
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "label-1",
            kind: "net-label",
            text: "V_in",
            position: { x: 0, y: 0 },
            offset: { x: 0, y: 0 },
            alignment: "start",
            rotation: 0,
            locked: false,
          },
        },
      ],
    });
    expect(legacyAnnotation.success).toBe(false);
    if (!legacyAnnotation.success) {
      expect(legacyAnnotation.error.issues[0]?.path).toEqual([
        "edits",
        0,
        "annotation",
        "anchor",
      ]);
    }

    const legacySpice = AgentProductionCircuitRequestSchema.safeParse({
      apiVersion: "2.0",
      requestId: "legacy-spice",
      operation: "transact",
      documentId: "document-main",
      transactionId: "legacy-spice",
      expectedRevision: 0,
      edits: [
        {
          kind: "patch_instance_properties",
          instanceId: "M1",
          set: { "spice.name": "XM1" },
        },
      ],
    });
    expect(legacySpice.success).toBe(false);

    const legacyVdd = AgentProductionCircuitRequestSchema.safeParse({
      apiVersion: "2.0",
      requestId: "legacy-vdd",
      operation: "transact",
      documentId: "document-main",
      transactionId: "legacy-vdd",
      expectedRevision: 0,
      edits: [
        {
          kind: "add_instance",
          instance: {
            id: "VDD1",
            symbolId: "vdd",
            placement: null,
          },
        },
      ],
    });
    expect(legacyVdd.success).toBe(false);
    if (!legacyVdd.success) {
      expect(legacyVdd.error.issues[0]?.path).toEqual([
        "edits",
        0,
        "instance",
        "symbolId",
      ]);
    }

    expect(
      AgentProductionCircuitRequestSchema.safeParse({
        apiVersion: "2.0",
        requestId: "vdd-rail",
        operation: "transact",
        documentId: "document-main",
        transactionId: "vdd-rail",
        expectedRevision: 0,
        edits: [
          {
            kind: "add_power_rail",
            netId: "net-vdd",
            routeId: "route-vdd",
            startJunctionId: "junction-vdd-left",
            endJunctionId: "junction-vdd-right",
            labelId: "label-vdd",
            netName: "VDD",
            scope: "local",
            powerDomain: "vdd",
            start: { x: 20, y: 20 },
            end: { x: 180, y: 20 },
          },
        ],
      }),
    ).toMatchObject({ success: true });
  });

  it("declares every public Circuit transport outcome explicitly", () => {
    const responses =
      agentCircuitOpenApi.paths["/api/agent/sessions/{sessionId}/circuit"].post
        .responses;
    expect(Object.keys(responses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "413",
      "429",
      "503",
      "504",
    ]);
    const invalidExample = responses["400"].content["application/json"].example;
    expect(AgentCircuitResponseSchema.safeParse(invalidExample)).toMatchObject({
      success: true,
    });
    for (const example of Object.values(agentTransportErrorExamples)) {
      expect(
        AgentTransportErrorResponseSchema.safeParse(example),
      ).toMatchObject({ success: true });
    }
    const claimResponses =
      agentCircuitOpenApi.paths["/api/agent/claims"].post.responses;
    expect(Object.keys(claimResponses).sort()).toEqual([
      "200",
      "401",
      "404",
      "409",
      "413",
    ]);
  });
});
