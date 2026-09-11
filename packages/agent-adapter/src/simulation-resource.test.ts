import { describe, it, expect } from "vitest";
import {
  AgentSimulationResourceRequestSchema,
  AgentSimulationResourceResponseSchema,
} from "./simulation-resource.js";
import { AgentFileResourceRequestSchema } from "./file-resource.js";
import { AgentFileResourceCapabilitySchema } from "./schema.js";
import {
  simulationOperationScopes,
  fileOperationScopes,
} from "../../../worker/agent-session-runtime.js";

describe("Simulation sibling contract", () => {
  it("limits human approval to Project replacement rather than raw workspace operations", () => {
    expect(
      AgentFileResourceCapabilitySchema.parse({
        path: "/api/agent/sessions/{sessionId}/files",
        operations: ["simulation-input", "request-approval"],
        maxBytes: 1500000,
        humanApprovalOperations: ["request-approval"],
      }).humanApprovalOperations,
    ).toEqual(["request-approval"]);
  });
  it("exposes async operations, not an ambiguous synchronous run", () => {
    const envelope = { apiVersion: "2.0", requestId: "test" };
    expect(
      AgentSimulationResourceRequestSchema.safeParse({
        ...envelope,
        operation: "run",
      }).success,
    ).toBe(false);
    const caps = AgentSimulationResourceRequestSchema.parse({
      ...envelope,
      operation: "capabilities",
    });
    expect(simulationOperationScopes(caps)).toEqual([]);
    const start = AgentSimulationResourceRequestSchema.parse({
      ...envelope,
      operation: "start",
      preparedId: "p",
      digest: "a".repeat(64),
    });
    expect(simulationOperationScopes(start)).toEqual(["simulation.run"]);
    const batch = AgentSimulationResourceRequestSchema.parse({
      ...envelope,
      operation: "prepare-batch",
      expectedStructureRevision: 3,
      items: [
        { id: "tt", setupId: "setup-tt" },
        { id: "ff", setupId: "setup-ff" },
      ],
    });
    expect(simulationOperationScopes(batch)).toEqual(["simulation.run"]);
    const sweep = AgentSimulationResourceRequestSchema.parse({
      ...envelope,
      operation: "prepare-sweep",
      setupId: "setup-ac",
      expectedStructureRevision: 4,
      axes: [{ kind: "temperature", values: [-40, 27, 125] }],
    });
    expect(simulationOperationScopes(sweep)).toEqual(["simulation.run"]);
    expect(
      AgentSimulationResourceRequestSchema.parse({
        ...envelope,
        operation: "prepare-sweep",
        setupId: "setup-ac",
        expectedStructureRevision: 4,
        axes: [{ kind: "variable", variableId: "load", values: ["1k", "2k"] }],
      }),
    ).toMatchObject({ axes: [{ kind: "variable", variableId: "load" }] });
    const files = AgentFileResourceRequestSchema.parse({
      ...envelope,
      operation: "simulation-input",
      input: { action: "create" },
    });
    expect(fileOperationScopes(files)).toEqual(["simulation.run"]);
  });
  it("retains recovery hints and located diagnostics in the shared envelope", () => {
    expect(
      AgentSimulationResourceResponseSchema.parse({
        apiVersion: "2.0",
        requestId: "bad-input",
        operation: "prepare",
        ok: false,
        error: {
          code: "MODEL_MISSING",
          message: "Set a model",
          stage: "prepare",
          recovery: "fix-input",
          diagnostics: [],
        },
      }),
    ).toMatchObject({ error: { recovery: "fix-input" } });
  });
  it("exports a specific simulation record through Files without a Canvas document", () => {
    const request = {
      apiVersion: "2.0",
      requestId: "plot",
      operation: "download",
      artifact: "simulation-plot",
    };
    expect(AgentFileResourceRequestSchema.safeParse(request).success).toBe(
      false,
    );
    const valid = {
      ...request,
      simulation: { runId: "run", analysisIndex: 1, format: "png" },
    };
    expect(AgentFileResourceRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      AgentFileResourceRequestSchema.safeParse({ ...valid, documentId: "main" })
        .success,
    ).toBe(false);
    expect(
      AgentFileResourceRequestSchema.safeParse({
        ...valid,
        artifact: "project",
      }).success,
    ).toBe(false);
  });
  it("accepts DC sweep capability and result data through the shared resource", () => {
    const response = AgentSimulationResourceResponseSchema.parse({
      apiVersion: "2.0",
      requestId: "dc-result",
      operation: "read",
      ok: true,
      run: {
        id: "run-dc",
        preparedId: "prepared-dc",
        inputRevision: "41",
        state: "finished",
        artifacts: [],
        result: {
          outcome: { status: "completed" },
          diagnostics: [],
          log: "ngspice completed",
          durationMs: 1,
          metadata: {
            schemaVersion: 1,
            input: {
              inputRevision: "41",
              netlistSha256: "b".repeat(64),
              testbenchSha256: "c".repeat(64),
              deckSha256: "d".repeat(64),
            },
            configuration: { modelLibrary: null },
            environment: {
              executor: "hosted-container",
              reproducibility: "pinned",
              profileId: "sky130-core-continuous-ngspice46-v1",
              platform: "linux/amd64",
              simulator: {
                name: "ngspice",
                version: "46",
                binarySha256: "e".repeat(64),
              },
              models: null,
              startupSha256: null,
              fingerprint: "profile-dc",
            },
          },
          data: {
            schemaVersion: 1,
            analyses: [
              {
                analysis: "dc",
                plotName: "DC transfer characteristic",
                sweep: {
                  name: "v-sweep",
                  quantity: "voltage",
                  unit: "V",
                  values: [0, 0.5, 1],
                },
                probes: [
                  {
                    name: "v(out)",
                    quantity: "voltage",
                    unit: "V",
                    value: [0, 0.25, 0.5],
                  },
                ],
              },
            ],
          },
        },
      },
    });

    expect(
      "run" in response ? response.run.result?.data?.analyses : [],
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ analysis: "dc" })]),
    );
  });
});
