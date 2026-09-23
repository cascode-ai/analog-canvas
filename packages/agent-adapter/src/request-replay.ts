import type { AgentCircuitRequest } from "./schema.js";
import type { AgentFileResourceRequest } from "./file-resource.js";
import type { AgentSimulationResourceRequest } from "./simulation-resource.js";
import type { AgentProjectResourceRequest } from "./project-resource.js";

// Only provably read-only operations may be re-executed after their short
// response cache is evicted. A new operation defaults to durable write replay.
export function isReadOnlyCircuitRequest(
  request: AgentCircuitRequest,
): boolean {
  return ["capabilities", "snapshot", "render"].includes(request.operation);
}

export function isReadOnlyFileRequest(
  request: AgentFileResourceRequest,
): boolean {
  return (
    request.operation === "inspect" ||
    (request.operation === "simulation-input" &&
      ["list", "read", "artifact"].includes(request.input.action))
  );
}

export function isReadOnlySimulationRequest(
  request: AgentSimulationResourceRequest,
): boolean {
  return [
    "authoring-help",
    "capabilities",
    "read",
    "catalog",
    "history",
    "read-batch",
  ].includes(request.operation);
}

export function isReadOnlyProjectRequest(
  request: AgentProjectResourceRequest,
): boolean {
  return (
    request.operation === "list-projects" ||
    request.operation === "list-cells" ||
    request.operation === "list-gallery" ||
    request.operation === "read-gallery-entry" ||
    request.operation === "read-gallery-entries" ||
    request.operation === "read-project-code" ||
    request.operation === "read-netlist" ||
    (request.operation === "workspace" && request.request.action === "list")
  );
}
