import {
  AGENT_API_VERSION,
  type AgentSimulationResourceRequest,
  type AgentSimulationResourceResponse,
} from "@icm/agent-adapter";
import {
  BrowserSimulationSession,
  type BrowserSimulationSessionOptions,
} from "../features/simulation/browser-simulation-session";

export type BrowserAgentSimulationHostOptions = BrowserSimulationSessionOptions;
/** Transport/auth facade only; GUI and Agent use identical service semantics. */
export class BrowserAgentSimulationHost {
  private session: BrowserSimulationSession;
  constructor(options: BrowserAgentSimulationHostOptions) {
    this.session = new BrowserSimulationSession(options);
  }
  clear() {
    return this.session.clear();
  }
  async handle(
    request: AgentSimulationResourceRequest,
  ): Promise<AgentSimulationResourceResponse> {
    const { apiVersion: _version, requestId, ...operation } = request;
    return {
      ...(await this.session.handle(operation, requestId)),
      apiVersion: AGENT_API_VERSION,
      requestId,
      operation: operation.operation,
    };
  }
}
