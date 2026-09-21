import type { AgentSessionClient } from "@icm/agent-client";
import type { AgentSimulationResourceResponse } from "@icm/agent-adapter";
import { AGENT_API_VERSION } from "@icm/agent-adapter";

/** Bounded client-side polling over the existing read operation. Never starts a run. */
export async function waitForSimulation(
  client: AgentSessionClient,
  initial: AgentSimulationResourceResponse,
  waitMs: number,
): Promise<AgentSimulationResourceResponse> {
  const deadline = Date.now() + waitMs;
  let response = initial;
  let delay = 250;
  while (
    response.ok &&
    "run" in response &&
    ["running", "cancelling"].includes(response.run.state)
  ) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(delay, remaining)),
    );
    if (Date.now() >= deadline) break;
    response = await client.simulationResource({
      apiVersion: AGENT_API_VERSION,
      requestId: crypto.randomUUID(),
      operation: "read",
      runId: response.run.id,
    });
    delay = Math.min(delay * 2, 2000);
  }
  return response;
}
