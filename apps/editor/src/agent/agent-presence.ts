import { useEffect, useRef, useState } from "react";
import type { AgentConnectionStatus } from "./connect-agent-panel";

/**
 * Where the workspace stands with its Agent: no Agent and no handoff, a
 * Claim handed off and not yet answered by a connected Agent, a paired Agent
 * connected, or a paired Agent whose connection was lost (paused, dropping,
 * resuming or ended).
 */
export type AgentLink = "unpaired" | "pairing" | "connected" | "lost";

/** The Agent button's mark: green connected, yellow lost, none otherwise. */
export type AgentPresence = "connected" | "lost" | null;

const LIVE: readonly AgentConnectionStatus[] = ["connected", "working"];

export function nextAgentLink(
  previous: AgentLink,
  status: AgentConnectionStatus,
): AgentLink {
  if (LIVE.includes(status)) return "connected";
  switch (status) {
    case "idle":
      return "unpaired";
    case "creating":
    case "waiting-for-agent":
      return "pairing";
    case "revoked":
    case "expired":
      // A Claim that lapsed, or setup that was cancelled, lost no Agent.
      return previous === "connected" || previous === "lost"
        ? "lost"
        : "unpaired";
    case "reconnecting":
      // A redeemed Claim resumes before it connects; any other resume is a
      // paired Agent's, a saved one's included.
      return previous === "pairing" ? "pairing" : "lost";
    default:
      return previous === "connected" || previous === "lost"
        ? "lost"
        : previous;
  }
}

export function agentPresence(link: AgentLink): AgentPresence {
  return link === "connected" || link === "lost" ? link : null;
}

/** The step from a Claim handoff to an Agent that redeemed it. */
export function agentPairingCompleted(
  previous: AgentLink,
  next: AgentLink,
): boolean {
  return previous === "pairing" && next === "connected";
}

export function agentPresenceLabel(presence: AgentPresence): string {
  return presence === "connected"
    ? "Agent connected"
    : presence === "lost"
      ? "Agent disconnected"
      : "Agent";
}

/** Follows the session's status; calls onPaired as an Agent pairs. */
export function useAgentPresence(
  status: AgentConnectionStatus,
  onPaired: () => void,
): AgentPresence {
  const [link, setLink] = useState<AgentLink>(() =>
    nextAgentLink("unpaired", status),
  );
  const paired = useRef(onPaired);
  paired.current = onPaired;
  const next = nextAgentLink(link, status);
  useEffect(() => {
    if (next === link) return;
    setLink(next);
    if (agentPairingCompleted(link, next)) paired.current();
  }, [link, next]);
  return agentPresence(next);
}
