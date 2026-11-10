import { randomUUID } from "node:crypto";
import { AGENT_API_VERSION } from "@icm/agent-adapter";
import { AgentSessionError, type AgentSessionClient } from "@icm/agent-client";
import { requestFailure } from "./local-source.js";

/** What Canvas holds for an imported netlist now: completeness and changes. */
export async function reviewDelivery(client: AgentSessionClient) {
  const send = () =>
    client.fileResource({
      apiVersion: AGENT_API_VERSION,
      requestId: `review-${randomUUID()}`,
      operation: "review",
    });
  // A delivery opened in the foreground of a Claim-paired tab publishes a
  // new context. The refusal ran nothing, and the client has refreshed.
  const first = await send().catch((error: unknown) => {
    if (
      error instanceof AgentSessionError &&
      error.code === "PROJECT_CONTEXT_STALE"
    )
      return null;
    throw error;
  });
  const response =
    !first || (!first.ok && first.error.code === "PROJECT_CONTEXT_STALE")
      ? await send()
      : first;
  if (!response.ok || response.operation !== "review")
    throw requestFailure(
      response.ok ? "REVIEW_LOAD_UNCONFIRMED" : response.error.code,
      response.ok
        ? "Canvas did not confirm the review"
        : response.error.message,
    );
  return {
    ok: true,
    delivery: response.delivery,
    comparison: response.comparison,
  };
}
