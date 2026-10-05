import type { AgentSessionClient } from "@icm/agent-client";
import type { AgentSimulationResourceResponse } from "@icm/agent-adapter";
import { AGENT_API_VERSION } from "@icm/agent-adapter";

const activeStates = new Set(["running", "cancelling"]);

function activeRunId(
  response: AgentSimulationResourceResponse,
): string | undefined {
  return response.ok &&
    "run" in response &&
    activeStates.has(response.run.state)
    ? response.run.id
    : undefined;
}

/** One bounded Agent read of a run that is still going. */
export async function waitForSimulation(
  client: AgentSessionClient,
  initial: AgentSimulationResourceResponse,
  waitMs: number,
): Promise<AgentSimulationResourceResponse> {
  const runId = activeRunId(initial);
  if (!runId || waitMs <= 0) return initial;
  return client.simulationResource({
    apiVersion: AGENT_API_VERSION,
    requestId: crypto.randomUUID(),
    operation: "read",
    runId,
    waitMs,
  });
}
