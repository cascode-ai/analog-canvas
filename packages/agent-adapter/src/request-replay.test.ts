import { describe, expect, it } from "vitest";
import {
  isReadOnlyCircuitRequest,
  isReadOnlyFileRequest,
  isReadOnlyProjectRequest,
  isReadOnlySimulationRequest,
} from "./request-replay.js";
import type { AgentCircuitRequest } from "./schema.js";
import type { AgentFileResourceRequest } from "./file-resource.js";
import type { AgentProjectResourceRequest } from "./project-resource.js";
import type { AgentSimulationResourceRequest } from "./simulation-resource.js";

describe("request replay classification", () => {
  it("reexecutes only circuit reads after result eviction", () => {
    expect(
      isReadOnlyCircuitRequest({
        operation: "snapshot",
      } as AgentCircuitRequest),
    ).toBe(true);
    expect(
      isReadOnlyCircuitRequest({
        operation: "transact",
      } as AgentCircuitRequest),
    ).toBe(false);
  });

  it("keeps source updates and download publication durable", () => {
    expect(
      isReadOnlyFileRequest({
        operation: "simulation-input",
        input: { action: "read" },
      } as AgentFileResourceRequest),
    ).toBe(true);
    for (const action of ["update", "download"]) {
      expect(
        isReadOnlyFileRequest({
          operation: "simulation-input",
          input: { action },
        } as AgentFileResourceRequest),
      ).toBe(false);
    }
  });

  it("keeps run creation and Project mutation durable", () => {
    expect(
      isReadOnlySimulationRequest({
        operation: "read",
      } as AgentSimulationResourceRequest),
    ).toBe(true);
    expect(
      isReadOnlySimulationRequest({
        operation: "start",
      } as AgentSimulationResourceRequest),
    ).toBe(false);
    expect(
      isReadOnlySimulationRequest({
        operation: "history-usage",
      } as AgentSimulationResourceRequest),
    ).toBe(true);
    expect(
      isReadOnlySimulationRequest({
        operation: "history-delete",
      } as AgentSimulationResourceRequest),
    ).toBe(false);
    expect(
      isReadOnlyProjectRequest({
        operation: "workspace",
        request: { action: "list" },
      } as AgentProjectResourceRequest),
    ).toBe(true);
    expect(
      isReadOnlyProjectRequest({
        operation: "workspace",
        request: { action: "copy" },
      } as AgentProjectResourceRequest),
    ).toBe(false);
  });
});
