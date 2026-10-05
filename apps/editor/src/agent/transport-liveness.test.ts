import { describe, expect, it } from "vitest";

import { createHeartbeat, isHeartbeatAck } from "./transport-liveness";

describe("Agent transport liveness", () => {
  it("creates and recognizes only session-bound heartbeat control frames", () => {
    expect(createHeartbeat("session-1", "nonce-1")).toEqual({
      protocolVersion: "1.0",
      sessionId: "session-1",
      kind: "heartbeat",
      nonce: "nonce-1",
    });
    expect(
      isHeartbeatAck(
        {
          protocolVersion: "1.0",
          sessionId: "session-1",
          kind: "heartbeat-ack",
          nonce: "nonce-1",
        },
        "session-1",
      ),
    ).toBe(true);
    expect(
      isHeartbeatAck(
        {
          protocolVersion: "1.0",
          sessionId: "other-session",
          kind: "heartbeat-ack",
          nonce: "nonce-1",
        },
        "session-1",
      ),
    ).toBe(false);
  });
});
