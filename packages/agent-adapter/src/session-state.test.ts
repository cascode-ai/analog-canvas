import { describe, expect, it } from "vitest";

import type { AgentSessionScope } from "./envelope.js";

import {
  AgentSessionMachine,
  constantTimeEqual,
  type AgentSessionLimits,
} from "./session-state.js";

const scopes: AgentSessionScope[] = [
  "circuit.snapshot",
  "circuit.render",
  "circuit.edit.geometry",
];

function setup(overrides: Partial<AgentSessionLimits> = {}) {
  let counter = 0;
  const random = () => `rand-${counter++}`;
  let time = 1_000_000;
  const now = () => time;
  const advance = (ms: number) => {
    time += ms;
  };
  const created = AgentSessionMachine.create({
    limits: overrides,
    projectSessionId: "project-session-1",
    projectId: "project-1",
    documentIds: ["document-1"],
    scopes,
    now: now(),
    random,
  });
  return {
    machine: created.machine,
    session: created.session,
    random,
    now,
    advance,
  };
}

// WP-WA4: the relay's authorization/idempotency/expiry/limit guarantees are
// exercised here with fake time. The machine never touches a Project or edit.

describe("AgentSessionMachine", () => {
  it("creates a session, returns secrets once, and authenticates the editor", () => {
    const { machine, session, now } = setup();
    expect(session.sessionId).toMatch(/^rand-/u);
    expect(session.editorSecret).toMatch(/^rand-/u);
    expect(session.claimCode).toMatch(/^rand-/u);
    expect(session.claimExpiresAt - now()).toBe(30 * 60 * 1_000);
    expect(session.expiresAt - now()).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(machine.authorizeEditor(session.editorSecret)).toBe(true);
    expect(machine.authorizeEditor("wrong")).toBe(false);
  });

  it("reissues a token for a valid claim and invalidates the earlier bearer", () => {
    const { machine, session, now } = setup();
    expect(machine.claimed).toBe(false);
    const first = machine.redeemClaim(session.claimCode, now());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(machine.claimed).toBe(true);
    expect(first.claim.scopes).toEqual(scopes);

    const auth = machine.authorize(first.claim.agentToken, now());
    expect(auth.ok).toBe(true);

    const retry = machine.redeemClaim(session.claimCode, now());
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.claim.agentToken).not.toBe(first.claim.agentToken);
    const priorToken = machine.authorize(first.claim.agentToken, now());
    expect(priorToken.ok).toBe(false);
    if (!priorToken.ok) expect(priorToken.code).toBe("TOKEN_INVALID");
    expect(machine.authorize(retry.claim.agentToken, now()).ok).toBe(true);
  });

  it("resumes a connector with a fresh bearer and revokes both together", () => {
    const { machine, session, now } = setup();
    const claimed = machine.redeemClaim(session.claimCode, now());
    if (!claimed.ok) throw new Error("claim failed");
    const resumed = machine.resumeConnector(
      claimed.claim.connectorToken,
      now(),
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.claim.agentToken).not.toBe(claimed.claim.agentToken);
    expect(machine.authorize(claimed.claim.agentToken, now()).ok).toBe(false);
    expect(machine.authorize(resumed.claim.agentToken, now()).ok).toBe(true);

    machine.revoke();
    expect(
      machine.resumeConnector(claimed.claim.connectorToken, now()),
    ).toMatchObject({ ok: false, code: "SESSION_REVOKED" });
  });

  it("records one-shot artifacts without retaining or replaying their bytes", () => {
    const { machine, now } = setup();
    expect(machine.beginRequest("artifact", now(), "artifact-hash")).toEqual({
      kind: "proceed",
    });
    machine.completeRequestWithoutResult("artifact", now());
    expect(machine.beginRequest("artifact", now(), "artifact-hash")).toEqual({
      kind: "rejected",
      code: "REQUEST_RESULT_UNAVAILABLE",
    });
  });

  it("rejects an unknown claim code", () => {
    const { machine, now } = setup();
    const result = machine.redeemClaim("not-the-code", now());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CLAIM_INVALID");
  });

  it("expires an unused claim after its TTL", () => {
    const { machine, session, now, advance } = setup({ claimTtlMs: 60_000 });
    advance(60_001);
    const result = machine.redeemClaim(session.claimCode, now());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CLAIM_EXPIRED");
  });

  it("rejects a wrong token and an expired token", () => {
    const { machine, session, now, advance } = setup({ tokenTtlMs: 60_000 });
    const redeemed = machine.redeemClaim(session.claimCode, now());
    if (!redeemed.ok) throw new Error("claim failed");

    expect(machine.authorize("wrong-token", now()).ok).toBe(false);
    advance(60_001);
    const expired = machine.authorize(redeemed.claim.agentToken, now());
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.code).toBe("TOKEN_EXPIRED");
  });

  it("expires the whole session even with a live-looking token", () => {
    const { machine, session, now, advance } = setup({ sessionTtlMs: 120_000 });
    const redeemed = machine.redeemClaim(session.claimCode, now());
    if (!redeemed.ok) throw new Error("claim failed");
    advance(120_001);
    const result = machine.authorize(redeemed.claim.agentToken, now());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SESSION_EXPIRED");
  });

  it("pauses and resumes; revoke is terminal", () => {
    const { machine, session, now } = setup();
    const redeemed = machine.redeemClaim(session.claimCode, now());
    if (!redeemed.ok) throw new Error("claim failed");
    const token = redeemed.claim.agentToken;

    machine.pause();
    let auth = machine.authorize(token, now());
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.code).toBe("SESSION_PAUSED");

    machine.resume();
    auth = machine.authorize(token, now());
    expect(auth.ok).toBe(true);

    machine.revoke();
    auth = machine.authorize(token, now());
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.code).toBe("SESSION_REVOKED");
  });

  it("enforces scopes on an authorized session", () => {
    const { machine } = setup();
    expect(machine.assertScope(scopes, "circuit.snapshot").ok).toBe(true);
    expect(machine.assertScope(scopes, "circuit.edit.connectivity").ok).toBe(
      false,
    );
  });

  it("binds requests to the authorized Project and Document set", () => {
    const { machine } = setup();
    expect(machine.assertDocument("project-1", "document-1").ok).toBe(true);
    expect(machine.assertDocument("project-2", "document-1").ok).toBe(false);
    expect(machine.assertDocument("project-1", "document-2").ok).toBe(false);
    expect(machine.updateEditorDocuments("project-2", ["document-2"])).toBe(
      false,
    );
    expect(machine.assertDocument("project-1", "document-2").ok).toBe(false);
    expect(
      machine.updateEditorDocuments("project-1", ["document-1", "document-2"]),
    ).toBe(true);
    expect(machine.assertDocument("project-1", "document-2").ok).toBe(true);
    expect(machine.updateEditorDocuments("project-1", ["document-1"])).toBe(
      true,
    );
    expect(machine.assertDocument("project-1", "document-2").ok).toBe(false);
  });

  it("serves the cached result for a repeated requestId and never re-runs", () => {
    const { machine, now, advance } = setup();
    const begin = machine.beginRequest("request-1", now());
    expect(begin.kind).toBe("proceed");

    machine.completeRequest("request-1", { revision: 7, ok: true }, now());

    // A retry within the cache TTL returns the same terminal result.
    advance(1_000);
    const replay = machine.beginRequest("request-1", now());
    expect(replay.kind).toBe("cached");
    if (replay.kind === "cached")
      expect(replay.result).toEqual({ revision: 7, ok: true });

    // A new requestId proceeds normally.
    const next = machine.beginRequest("request-2", now());
    expect(next.kind).toBe("proceed");
  });

  it("blocks concurrent duplicates and requestId reuse with another payload", () => {
    const { machine, now } = setup();
    expect(machine.beginRequest("request-1", now(), "hash-a").kind).toBe(
      "proceed",
    );
    const concurrent = machine.beginRequest("request-1", now(), "hash-a");
    expect(concurrent).toEqual({
      kind: "rejected",
      code: "REQUEST_IN_PROGRESS",
    });
    const conflicting = machine.beginRequest("request-1", now(), "hash-b");
    expect(conflicting).toEqual({
      kind: "rejected",
      code: "REQUEST_ID_REUSED",
    });

    machine.completeRequest("request-1", { ok: true }, now());
    expect(machine.beginRequest("request-1", now(), "hash-a").kind).toBe(
      "cached",
    );
    expect(machine.beginRequest("request-1", now(), "hash-b")).toEqual({
      kind: "rejected",
      code: "REQUEST_ID_REUSED",
    });
  });

  it("bounds the in-memory terminal-result cache by count", () => {
    const { machine, now } = setup({ resultCacheMaxEntries: 2 });
    for (const requestId of ["one", "two", "three"]) {
      machine.beginRequest(requestId, now());
      machine.completeRequest(requestId, { requestId }, now());
    }
    expect(machine.beginRequest("one", now()).kind).toBe("proceed");
    expect(machine.beginRequest("two", now()).kind).toBe("cached");
    expect(machine.beginRequest("three", now()).kind).toBe("cached");
  });

  it("retains an unknown request ledger entry without retaining its result", () => {
    const { machine, now } = setup();
    machine.beginRequest("uncertain", now(), "payload-hash");
    machine.failRequest("uncertain", false);
    const restored = AgentSessionMachine.restore(
      machine.serialize(),
      () => "next-token",
    );
    expect(restored.beginRequest("uncertain", now(), "payload-hash").kind).toBe(
      "proceed",
    );
    expect(restored.beginRequest("uncertain", now(), "different-hash")).toEqual(
      { kind: "rejected", code: "REQUEST_ID_REUSED" },
    );
  });

  it("serializes hashed verifiers without persisting circuit-bearing caches", () => {
    const { machine, session, now } = setup();
    const redeemed = machine.redeemClaim(session.claimCode, now());
    if (!redeemed.ok) throw new Error("claim failed");
    machine.beginRequest("pending", now(), "payload-hash");
    machine.completeRequest(
      "pending",
      { snapshot: "circuit-response-marker" },
      now(),
    );

    const state = machine.serialize();
    expect(JSON.stringify(state)).not.toContain(session.editorSecret);
    expect(JSON.stringify(state)).not.toContain(session.claimCode);
    expect(JSON.stringify(state)).not.toContain(redeemed.claim.agentToken);
    expect(JSON.stringify(state)).toContain("payload-hash");
    expect(JSON.stringify(state)).not.toContain("circuit-response-marker");

    const restored = AgentSessionMachine.restore(state, () => "next-token");
    expect(restored.authorizeEditor(session.editorSecret)).toBe(true);
    expect(restored.authorize(redeemed.claim.agentToken, now()).ok).toBe(true);
    expect(restored.beginRequest("pending", now(), "payload-hash").kind).toBe(
      "proceed",
    );
  });

  it("rate-limits requests over the configured window", () => {
    const { machine, now } = setup({
      rateLimit: { windowMs: 60_000, maxRequests: 3 },
    });
    expect(machine.beginRequest("a", now()).kind).toBe("proceed");
    expect(machine.beginRequest("b", now()).kind).toBe("proceed");
    expect(machine.beginRequest("c", now()).kind).toBe("proceed");
    const limited = machine.beginRequest("d", now());
    expect(limited.kind).toBe("rejected");
    if (limited.kind === "rejected") expect(limited.code).toBe("RATE_LIMITED");
  });

  it("enforces the relay request-size ceiling", () => {
    const { machine } = setup({ maxRequestBytes: 128 });
    expect(machine.checkSize(100).ok).toBe(true);
    const tooLarge = machine.checkSize(129);
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.code).toBe("REQUEST_TOO_LARGE");
  });

  it("enforces the browser-message ceiling independently", () => {
    const { machine } = setup({ maxMessageBytes: 256 });
    expect(machine.checkMessageSize(256).ok).toBe(true);
    const tooLarge = machine.checkMessageSize(257);
    expect(tooLarge).toEqual({ ok: false, code: "MESSAGE_TOO_LARGE" });
  });

  it("revokes the session on Project replacement and invalidates the token", () => {
    const { machine, session, now } = setup();
    const redeemed = machine.redeemClaim(session.claimCode, now());
    if (!redeemed.ok) throw new Error("claim failed");
    const token = redeemed.claim.agentToken;

    machine.replaceProject();
    expect(machine.statusAt(now())).toBe("revoked");

    const auth = machine.authorize(token, now());
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.code).toBe("SESSION_REVOKED");
  });

  it("compares secrets in constant time for equal-length inputs", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
    expect(constantTimeEqual("abc123", "abc1234")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});
