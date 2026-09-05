import {
  AGENT_API_VERSION,
  type AgentSimulationResourceRequest,
  type AgentSimulationResourceResponse,
} from "@icm/agent-adapter";
import type { CircuitProject } from "@icm/model";
import type {
  SimulationFiles,
  SimulationService,
} from "@icm/simulation-service";
export interface BrowserAgentSimulationHostOptions {
  getProjectSessionId: () => string;
  getProject: () => CircuitProject;
  files: SimulationFiles;
  fetch?: typeof fetch;
}
/** Live Project adapter; domain behavior belongs to the shared service. */
export class BrowserAgentSimulationHost {
  private service: Promise<SimulationService> | undefined;
  private boundProjectSessionId: string;
  constructor(private options: BrowserAgentSimulationHostOptions) {
    this.boundProjectSessionId = options.getProjectSessionId();
  }
  async clear() {
    const service = this.service;
    this.service = undefined;
    await service?.then(
      (host) => host.clear(),
      () => {},
    );
  }
  async handle(
    request: AgentSimulationResourceRequest,
  ): Promise<AgentSimulationResourceResponse> {
    const { apiVersion: _version, requestId, ...operation } = request;
    if (this.options.getProjectSessionId() !== this.boundProjectSessionId)
      return {
        apiVersion: AGENT_API_VERSION,
        requestId,
        operation: operation.operation,
        ok: false,
        error: {
          code: "PROJECT_REPLACED",
          message: "The bound Project changed",
          stage: "input",
          recovery: "reauthorize",
        },
      };
    try {
      this.service ??= import("@icm/simulation-service").then(
        ({ SimulationService, createHostedExecutor }) =>
          new SimulationService(
            this.options.files,
            createHostedExecutor(
              this.options.fetch ?? ((...args) => globalThis.fetch(...args)),
            ),
            this.options.getProject,
          ),
      );
      const result = await (await this.service).handle(operation, requestId);
      return {
        ...result,
        apiVersion: AGENT_API_VERSION,
        requestId,
        operation: operation.operation,
      };
    } catch {
      this.service = undefined;
      return {
        apiVersion: AGENT_API_VERSION,
        requestId,
        operation: operation.operation,
        ok: false,
        error: {
          code: "SIMULATION_HOST_UNAVAILABLE",
          message:
            "The simulation module could not load. The editor session remains available.",
          stage: "read",
          recovery: "retry-after",
        },
      };
    }
  }
}
