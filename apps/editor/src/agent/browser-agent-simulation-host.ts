import {
  AGENT_API_VERSION,
  type AgentSimulationResourceRequest,
  type AgentSimulationResourceResponse,
} from "@icm/agent-adapter";
import {
  BrowserSimulationSession,
  type BrowserSimulationSessionOptions,
} from "../features/simulation/browser-simulation-session";
import type { SimulationOperation } from "@icm/simulation-service/contract";

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
    const { apiVersion: _version, requestId, ...payload } = request;
    const waitMs = "waitMs" in payload ? payload.waitMs : undefined;
    const operation = { ...payload } as SimulationOperation & {
      waitMs?: number;
    };
    delete operation.waitMs;
    let result = await this.session.handle(
      operation,
      requestId,
      waitMs === undefined ? {} : { waitMs },
    );
    if (
      waitMs &&
      (operation.operation === "run" || operation.operation === "start") &&
      result.ok &&
      "run" in result &&
      ["running", "cancelling"].includes(result.run.state)
    ) {
      const waited = await this.session.handle(
        { operation: "read", runId: result.run.id },
        crypto.randomUUID(),
        { waitMs },
      );
      // Preserve the accepted run identity if the follow-up read fails.
      if (waited.ok) result = waited;
    }
    return {
      ...result,
      apiVersion: AGENT_API_VERSION,
      requestId,
      operation: operation.operation,
    };
  }
}
