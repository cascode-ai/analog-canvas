import type { AgentSessionClient } from "@icm/agent-client";
import { AgentSessionError } from "@icm/agent-client";
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

async function legacyWait(
  client: AgentSessionClient,
  initial: AgentSimulationResourceResponse,
  waitMs: number,
): Promise<AgentSimulationResourceResponse> {
  const deadline = Date.now() + waitMs;
  let response = initial;
  let delay = 250;
  while (true) {
    const runId = activeRunId(response);
    if (!runId) break;
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
      runId,
    });
    delay = Math.min(delay * 2, 2000);
  }
  return response;
}

/** One bounded Agent read, with polling only for an older browser contract. */
export async function waitForSimulation(
  client: AgentSessionClient,
  initial: AgentSimulationResourceResponse,
  waitMs: number,
): Promise<AgentSimulationResourceResponse> {
  const runId = activeRunId(initial);
  if (!runId || waitMs <= 0) return initial;
  try {
    const response = await client.simulationResource({
      apiVersion: AGENT_API_VERSION,
      requestId: crypto.randomUUID(),
      operation: "read",
      runId,
      waitMs,
    });
    if (!response.ok && response.error.code === "SIMULATION_REQUEST_INVALID")
      return legacyWait(client, initial, waitMs);
    return response;
  } catch (error) {
    if (
      error instanceof AgentSessionError &&
      error.code === "SIMULATION_REQUEST_INVALID"
    )
      return legacyWait(client, initial, waitMs);
    throw error;
  }
}
