import { describe, expect, it } from "vitest";

import { AgentTransportErrorCodeSchema } from "./envelope.js";
import {
  AGENT_TRANSPORT_ERRORS,
  agentTransportErrorCategory,
  agentTransportErrorMessage,
  agentTransportErrorStatus,
} from "./transport-errors.js";

describe("agent transport error table", () => {
  it("describes every wire error code with a status, category and message", () => {
    const categories = new Set([
      "unrecoverable-credential",
      "editor-offline",
      "retryable",
      "request-rejected",
    ]);
    for (const code of AgentTransportErrorCodeSchema.options) {
      const descriptor = AGENT_TRANSPORT_ERRORS[code];
      expect(descriptor, code).toBeDefined();
      expect(Number.isInteger(descriptor.status), code).toBe(true);
      expect(descriptor.status, code).toBeGreaterThanOrEqual(400);
      expect(categories.has(descriptor.category), code).toBe(true);
      expect(descriptor.message.length, code).toBeGreaterThan(0);
    }
  });

  it("keeps status and category orthogonal per code", () => {
    // Both are 409 responses, but only the expired session invalidates the
    // stored credential; the client must not discard a reusable pairing.
    expect(agentTransportErrorStatus("SESSION_EXPIRED")).toBe(409);
    expect(agentTransportErrorCategory("SESSION_EXPIRED")).toBe(
      "unrecoverable-credential",
    );
    expect(agentTransportErrorCategory("SESSION_PAUSED")).toBe(
      "request-rejected",
    );
  });

  it("preserves the wire projections the worker and client relied on", () => {
    expect(agentTransportErrorStatus("TOKEN_INVALID")).toBe(401);
    expect(agentTransportErrorCategory("TOKEN_INVALID")).toBe(
      "unrecoverable-credential",
    );
    expect(agentTransportErrorStatus("SESSION_NOT_FOUND")).toBe(404);
    expect(agentTransportErrorStatus("FILE_TOO_LARGE")).toBe(413);
    expect(agentTransportErrorStatus("RATE_LIMITED")).toBe(429);
    expect(agentTransportErrorCategory("RATE_LIMITED")).toBe("retryable");
    expect(agentTransportErrorStatus("EDITOR_OFFLINE")).toBe(503);
    expect(agentTransportErrorCategory("EDITOR_OFFLINE")).toBe(
      "editor-offline",
    );
    expect(agentTransportErrorStatus("REQUEST_TIMEOUT")).toBe(504);
    expect(agentTransportErrorCategory("REQUEST_TIMEOUT")).toBe("retryable");
    expect(agentTransportErrorMessage("EDITOR_OFFLINE")).toBe(
      "The authorized browser editor is offline",
    );
  });

  it("treats codes outside the enum as rejected requests", () => {
    expect(agentTransportErrorCategory("SOMETHING_NEW")).toBe(
      "request-rejected",
    );
  });
});
