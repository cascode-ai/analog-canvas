import { describe, expect, it } from "vitest";
import type { AgentConnectionStatus } from "./connect-agent-panel";
import {
  agentPairingCompleted,
  agentPresence,
  agentPresenceLabel,
  nextAgentLink,
  type AgentLink,
  type AgentPresence,
} from "./agent-presence";

function linkAfter(statuses: readonly AgentConnectionStatus[]): AgentLink {
  return statuses.reduce<AgentLink>(nextAgentLink, "unpaired");
}

/** The mark the Agent button shows after each status in turn. */
function presenceAfter(
  statuses: readonly AgentConnectionStatus[],
): AgentPresence {
  return agentPresence(linkAfter(statuses));
}

/** A Claim handed off, redeemed, and the editor's context acknowledged. */
const PAIRED: readonly AgentConnectionStatus[] = [
  "creating",
  "reconnecting",
  "waiting-for-agent",
  "reconnecting",
  "connected",
];

describe("the Agent button's connection mark", () => {
  it("shows nothing for a connection never paired", () => {
    expect(presenceAfter(["idle"])).toBeNull();
    expect(presenceAfter(["idle", "creating", "waiting-for-agent"])).toBeNull();
    // The relay socket resuming before any Agent redeemed the Claim.
    expect(
      presenceAfter(["creating", "reconnecting", "waiting-for-agent"]),
    ).toBeNull();
    // A redeemed Claim resumes before the editor's context is acknowledged.
    expect(presenceAfter(PAIRED.slice(0, -1))).toBeNull();
    // A Claim that lapsed, or setup that was cancelled, lost no Agent.
    expect(presenceAfter(["creating", "waiting-for-agent", "expired"])).toBe(
      null,
    );
    expect(presenceAfter(["creating", "waiting-for-agent", "revoked"])).toBe(
      null,
    );
    expect(presenceAfter(["creating", "offline"])).toBeNull();
  });

  it("is connected while a paired Agent is connected or working", () => {
    expect(presenceAfter(PAIRED)).toBe("connected");
    expect(presenceAfter([...PAIRED, "working"])).toBe("connected");
    expect(presenceAfter([...PAIRED, "working", "connected"])).toBe(
      "connected",
    );
  });

  it("is lost once a paired Agent's connection pauses, drops or ends", () => {
    for (const status of [
      "paused",
      "reconnecting",
      "offline",
      "revoked",
      "expired",
    ] as const)
      expect(presenceAfter([...PAIRED, status])).toBe("lost");
    expect(presenceAfter([...PAIRED, "offline", "reconnecting"])).toBe("lost");
    expect(presenceAfter([...PAIRED, "reconnecting", "connected"])).toBe(
      "connected",
    );
  });

  it("is lost while a saved session resumes as the page opens", () => {
    expect(presenceAfter(["idle", "reconnecting"])).toBe("lost");
    expect(presenceAfter(["idle", "reconnecting", "connected"])).toBe(
      "connected",
    );
  });

  it("clears when a new connection starts or the session goes idle", () => {
    expect(presenceAfter([...PAIRED, "expired", "creating"])).toBeNull();
    expect(presenceAfter([...PAIRED, "revoked", "idle"])).toBeNull();
  });

  it("names its state for assistive technology", () => {
    expect(agentPresenceLabel("connected")).toBe("Agent connected");
    expect(agentPresenceLabel("lost")).toBe("Agent disconnected");
    expect(agentPresenceLabel(null)).toBe("Agent");
  });
});

describe("pairing completed", () => {
  it("is the step from a Claim handoff to a connected Agent", () => {
    expect(agentPairingCompleted("pairing", "connected")).toBe(true);
    expect(
      agentPairingCompleted(linkAfter(PAIRED.slice(0, -1)), linkAfter(PAIRED)),
    ).toBe(true);
  });

  it("is not a resumed, already-paired or unpaired connection", () => {
    expect(agentPairingCompleted("lost", "connected")).toBe(false);
    expect(agentPairingCompleted("connected", "connected")).toBe(false);
    expect(agentPairingCompleted("unpaired", "connected")).toBe(false);
    expect(agentPairingCompleted("pairing", "unpaired")).toBe(false);
  });
});
