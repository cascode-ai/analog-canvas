import { describe, it, expect } from "vitest";
import {
  AgentSimulationResourceRequestSchema,
  AgentSimulationResourceResponseSchema,
} from "./simulation-resource.js";
import { AgentFileResourceRequestSchema } from "./file-resource.js";
import {
  simulationOperationScopes,
  fileOperationScopes,
} from "../../../worker/agent-session-runtime.js";

describe("Simulation sibling contract", () => {
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
});
