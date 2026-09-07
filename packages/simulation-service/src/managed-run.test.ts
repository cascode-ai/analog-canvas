import { describe, expect, it } from "vitest";

import { InMemoryManagedRunRegistry } from "./managed-run-registry.js";
import {
  DEFAULT_MANAGED_RUN_POLICY,
  type ManagedRunAdmission,
} from "./managed-run.js";

const digest = (character: string) => character.repeat(64);

function admission(
  ownerId = "owner-a",
  requestId = "request-a",
): ManagedRunAdmission {
  return {
    ownerId,
    requestId,
    requestFingerprint: digest("a"),
    preparedId: "prepared-a",
    preparedDigest: digest("b"),
    inputRevision: "revision-a",
    environment: { profileId: "profile-a" },
    timeoutMs: 60_000,
    maxAttempts: 3,
    artifacts: [],
  };
}

describe("managed simulation run lifecycle", () => {
  it("accepts one idempotent start and rejects request-id reuse", () => {
    const registry = new InMemoryManagedRunRegistry(
      DEFAULT_MANAGED_RUN_POLICY,
      () => 100,
      () => "run-a",
    );
    const first = registry.accept(admission());
    const retry = registry.accept(admission());
    const changed = registry.accept({
      ...admission(),
      requestFingerprint: digest("c"),
    });

    expect(first).toMatchObject({
      ok: true,
      accepted: true,
      run: { id: "run-a", state: "queued", attempt: 0 },
    });
    expect(retry).toMatchObject({
      ok: true,
      accepted: false,
      run: { id: "run-a" },
    });
    expect(changed).toEqual({ ok: false, code: "REQUEST_ID_REUSED" });
  });

  it("leases, retries infrastructure failure, and completes", () => {
    let now = 100;
    const registry = new InMemoryManagedRunRegistry(
      DEFAULT_MANAGED_RUN_POLICY,
      () => now,
      () => "run-a",
    );
    const accepted = registry.accept(admission());
    if (!accepted.ok) throw new Error("run was not accepted");

    expect(
      registry.transition(accepted.run.id, {
        kind: "lease-acquired",
        lease: { id: "lease-1", acquiredAt: 110, expiresAt: 1_110 },
      }),
    ).toMatchObject({ ok: true, run: { state: "running", attempt: 1 } });
    expect(
      registry.transition(accepted.run.id, {
        kind: "infrastructure-failed",
        at: 120,
        error: {
          code: "HOST_UNREACHABLE",
          message: "host unavailable",
          stage: "start",
          recovery: "retry-after",
        },
      }),
    ).toMatchObject({ ok: true, enqueue: true, run: { state: "queued" } });
    expect(
      registry.transition(accepted.run.id, {
        kind: "lease-acquired",
        lease: { id: "lease-2", acquiredAt: 130, expiresAt: 1_130 },
      }),
    ).toMatchObject({ ok: true, run: { state: "running", attempt: 2 } });
    expect(
      registry.transition(accepted.run.id, {
        kind: "completed",
        at: 150,
        artifacts: [],
      }),
    ).toMatchObject({ ok: true, run: { state: "succeeded", finishedAt: 150 } });

    now = 150 + DEFAULT_MANAGED_RUN_POLICY.retentionMs;
    expect(registry.read(accepted.run.id)).toMatchObject({
      state: "expired",
      artifacts: [],
    });
  });

  it("cancels queued work and waits for running cleanup", () => {
    const registry = new InMemoryManagedRunRegistry(
      DEFAULT_MANAGED_RUN_POLICY,
      () => 100,
      (() => {
        let i = 0;
        return () => `run-${++i}`;
      })(),
    );
    const queued = registry.accept(admission());
    if (!queued.ok) throw new Error("queued run missing");
    expect(
      registry.transition(queued.run.id, {
        kind: "cancel-requested",
        at: 105,
      }),
    ).toMatchObject({ ok: true, run: { state: "cancelled" } });

    const running = registry.accept(admission("owner-b", "request-b"));
    if (!running.ok) throw new Error("running run missing");
    registry.transition(running.run.id, {
      kind: "lease-acquired",
      lease: { id: "lease-b", acquiredAt: 110, expiresAt: 1_110 },
    });
    expect(
      registry.transition(running.run.id, {
        kind: "cancel-requested",
        at: 115,
      }),
    ).toMatchObject({ ok: true, run: { state: "cancelling" } });
    expect(
      registry.transition(running.run.id, { kind: "cancelled", at: 120 }),
    ).toMatchObject({ ok: true, run: { state: "cancelled" } });
  });

  it("enforces owner and global queue admission", () => {
    const policy = {
      ...DEFAULT_MANAGED_RUN_POLICY,
      maxQueuedGlobal: 2,
      maxQueuedPerOwner: 1,
    };
    const registry = new InMemoryManagedRunRegistry(
      policy,
      () => 100,
      (() => {
        let i = 0;
        return () => `run-${++i}`;
      })(),
    );
    expect(registry.accept(admission("owner-a", "request-a"))).toMatchObject({
      ok: true,
    });
    expect(registry.accept(admission("owner-a", "request-b"))).toEqual({
      ok: false,
      code: "OWNER_QUEUE_LIMIT",
      retryAfterMs: 2_000,
    });
    expect(registry.accept(admission("owner-b", "request-c"))).toMatchObject({
      ok: true,
    });
    expect(registry.accept(admission("owner-c", "request-d"))).toEqual({
      ok: false,
      code: "GLOBAL_QUEUE_LIMIT",
      retryAfterMs: 2_000,
    });
  });

  it("expires an abandoned queue entry without retaining input artifacts", () => {
    let now = 100;
    const registry = new InMemoryManagedRunRegistry(
      DEFAULT_MANAGED_RUN_POLICY,
      () => now,
      () => "run-a",
    );
    const accepted = registry.accept({
      ...admission(),
      artifacts: [
        {
          id: "input-a",
          name: "managed-input.json",
          mediaType: "application/json",
          byteLength: 2,
          sha256: digest("d"),
        },
      ],
    });
    if (!accepted.ok) throw new Error("run was not accepted");
    now += DEFAULT_MANAGED_RUN_POLICY.maxQueueWaitMs;
    expect(registry.read(accepted.run.id)).toMatchObject({
      state: "expired",
      artifacts: [],
      error: { code: "QUEUE_WAIT_EXPIRED" },
    });
  });
});
