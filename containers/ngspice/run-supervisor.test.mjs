import { describe, expect, it, vi } from "vitest";

import {
  resolveRunTimeout,
  SimulationRunSupervisor,
} from "./run-supervisor.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("SimulationRunSupervisor", () => {
  it("only the owning token can cancel; cancellation during preparation kills on attach and releases normally", async () => {
    const held = deferred(),
      killed = vi.fn(),
      supervisor = new SimulationRunSupervisor({ terminate: killed });
    const child = { pid: 54 };
    const execution = supervisor.tryExecute({ token: "mine" }, async (run) => {
      await held.promise;
      run.attachProcess(child);
      expect(run.cancelled).toBe(true);
      expect(run.timedOut).toBe(false);
      run.detachProcess(child);
      run.phase("collecting");
      run.phase("cleaning");
    });
    expect(supervisor.cancel("other")).toBe(false);
    expect(killed).not.toHaveBeenCalled();
    expect(supervisor.cancel("mine")).toBe(true);
    held.resolve();
    await execution;
    expect(killed).toHaveBeenCalledWith(child, "SIGKILL");
    expect(supervisor.snapshot()).toEqual({ state: "idle" });
    expect((await supervisor.tryExecute({}, async () => "next")).kind).toBe(
      "completed",
    );
  });
  it("admits one lease, reports its phase, and refuses a second", async () => {
    const held = deferred();
    const supervisor = new SimulationRunSupervisor();
    const first = supervisor.tryExecute({ timeoutMs: 10_000 }, async (run) => {
      run.phase("collecting");
      await held.promise;
      run.phase("cleaning");
      return "done";
    });

    expect(supervisor.snapshot()).toMatchObject({
      state: "active",
      phase: "collecting",
    });
    await expect(
      supervisor.tryExecute({ timeoutMs: 10_000 }, () => "second"),
    ).resolves.toEqual({ kind: "busy", retryAfterSeconds: 2 });

    held.resolve();
    await expect(first).resolves.toEqual({ kind: "completed", value: "done" });
    expect(supervisor.snapshot()).toEqual({ state: "idle" });
  });

  it("owns process timeout and records why it terminated the tree", async () => {
    vi.useFakeTimers();
    try {
      const processEnded = deferred();
      const terminate = vi.fn(() => processEnded.resolve());
      const child = { pid: 42 };
      const supervisor = new SimulationRunSupervisor({
        now: () => Date.now(),
        terminate,
      });

      const execution = supervisor.tryExecute(
        { timeoutMs: 100 },
        async (run) => {
          run.attachProcess(child);
          await processEnded.promise;
          const timedOut = run.timedOut;
          run.detachProcess(child);
          run.phase("collecting");
          run.phase("cleaning");
          return timedOut;
        },
      );

      await vi.advanceTimersByTimeAsync(100);
      await expect(execution).resolves.toEqual({
        kind: "completed",
        value: true,
      });
      expect(terminate).toHaveBeenCalledWith(child, "SIGKILL");
      expect(supervisor.snapshot()).toEqual({ state: "idle" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fail-stops when an admitted operation never settles", async () => {
    vi.useFakeTimers();
    try {
      const never = deferred();
      const terminate = vi.fn();
      const failStop = vi.fn();
      const child = { pid: 77 };
      const supervisor = new SimulationRunSupervisor({
        lifecycleGraceMs: 25,
        now: () => Date.now(),
        terminate,
        failStop,
      });

      void supervisor.tryExecute({ timeoutMs: 100 }, async (run) => {
        run.attachProcess(child);
        await never.promise;
      });

      await vi.advanceTimersByTimeAsync(125);

      expect(terminate).toHaveBeenLastCalledWith(child, "SIGKILL");
      expect(failStop).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "simulation-run-watchdog",
          reason: "run-lease-expired",
        }),
      );
      expect(supervisor.snapshot()).toMatchObject({
        state: "fatal",
        phase: "fatal",
        terminationReason: "watchdog",
      });
      await expect(
        supervisor.tryExecute({}, () => "never admitted"),
      ).resolves.toMatchObject({ kind: "busy" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let health snapshots extend the hard deadline", async () => {
    vi.useFakeTimers();
    try {
      const failStop = vi.fn();
      const supervisor = new SimulationRunSupervisor({
        lifecycleGraceMs: 50,
        now: () => Date.now(),
        failStop,
      });
      const never = deferred();
      void supervisor.tryExecute({ timeoutMs: 100 }, () => never.promise);

      for (let elapsed = 0; elapsed < 150; elapsed += 10) {
        supervisor.snapshot();
        await vi.advanceTimersByTimeAsync(10);
      }

      expect(failStop).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid phase movement instead of hiding lifecycle drift", async () => {
    const supervisor = new SimulationRunSupervisor();
    await expect(
      supervisor.tryExecute({}, async (run) => {
        run.phase("cleaning");
        run.phase("running");
      }),
    ).rejects.toThrow("cleaning -> running");
    expect(supervisor.snapshot()).toEqual({ state: "idle" });
  });
});

describe("resolveRunTimeout", () => {
  const limits = { defaultTimeoutMs: 30_000, maxTimeoutMs: 120_000 };

  it("uses the default and clamps both ends", () => {
    expect(resolveRunTimeout(undefined, limits)).toBe(30_000);
    expect(resolveRunTimeout(-10, limits)).toBe(1);
    expect(resolveRunTimeout(900_000, limits)).toBe(120_000);
  });
});
