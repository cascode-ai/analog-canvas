import { describe, expect, it } from "vitest";

import {
  canTransitionAgentSession,
  transitionAgentSession,
} from "./agent-session-state-machine";

describe("Agent session state machine", () => {
  it("admits the normal claim, work, pause, reconnect, and revoke paths", () => {
    expect(canTransitionAgentSession("idle", "creating")).toBe(true);
    expect(canTransitionAgentSession("creating", "waiting-for-agent")).toBe(
      true,
    );
    expect(canTransitionAgentSession("waiting-for-agent", "connected")).toBe(
      true,
    );
    expect(canTransitionAgentSession("connected", "working")).toBe(true);
    expect(canTransitionAgentSession("working", "connected")).toBe(true);
    expect(canTransitionAgentSession("connected", "paused")).toBe(true);
    expect(canTransitionAgentSession("paused", "reconnecting")).toBe(true);
    expect(canTransitionAgentSession("reconnecting", "connected")).toBe(true);
    expect(canTransitionAgentSession("connected", "revoked")).toBe(true);
  });

  it("ignores impossible transport jumps", () => {
    expect(canTransitionAgentSession("idle", "working")).toBe(false);
    expect(transitionAgentSession("idle", "working")).toBe("idle");
    expect(canTransitionAgentSession("revoked", "connected")).toBe(false);
  });

  it("allows explicit replacement from active states and failed recovery to retry", () => {
    for (const state of [
      "connected",
      "working",
      "paused",
      "waiting-for-agent",
    ] as const)
      expect(transitionAgentSession(state, "creating")).toBe("creating");
    expect(transitionAgentSession("reconnecting", "idle")).toBe("idle");
  });
});
