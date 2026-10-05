import { describe, expect, it } from "vitest";

import { createRecoveryScheduler } from "./recovery-scheduler";
import type {
  RecoveryClearTimeout,
  RecoverySetTimeout,
} from "./recovery-scheduler";

// A minimal fake timer that does not touch real time. Captures the queued
// callback and the delay it was scheduled with, and lets the test fire it
// (advancing time conceptually) or inspect pending state.
interface FakeTimer {
  delay: number;
  fire: () => void;
}

function fakes() {
  let current: FakeTimer | null = null;
  const queue: FakeTimer[] = [];
  const setTimeout: RecoverySetTimeout = (fn, ms) => {
    const timer: FakeTimer = { delay: ms, fire: fn };
    current = timer;
    queue.push(timer);
    return timer;
  };
  const clearTimeout: RecoveryClearTimeout = (handle) => {
    const timer = handle as FakeTimer;
    if (current === timer) current = null;
    const index = queue.indexOf(timer);
    if (index >= 0) queue.splice(index, 1);
  };
  const fire = () => {
    // Fire the most recently scheduled (head of queue) timer, mirroring how a
    // coalescing scheduler only ever has one timer armed.
    const timer = queue.shift();
    current = queue.length > 0 ? queue[queue.length - 1]! : null;
    timer?.fire();
  };
  const fireAll = () => {
    while (queue.length > 0) fire();
  };
  const armedCount = () => queue.length;
  return { setTimeout, clearTimeout, fire, fireAll, armedCount };
}

describe("recovery scheduler", () => {
  it("coalesces a burst of schedules into one write of the latest project", () => {
    const written: unknown[] = [];
    const timers = fakes();
    const scheduler = createRecoveryScheduler({
      delayMs: 400,
      write: (project) => written.push(project),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });

    scheduler.schedule("rev-1");
    scheduler.schedule("rev-2");
    scheduler.schedule("rev-3");

    // Three edits but exactly one timer armed; nothing written yet.
    expect(timers.armedCount()).toBe(1);
    expect(written).toEqual([]);

    timers.fire();

    expect(written).toEqual(["rev-3"]);
    expect(scheduler.isPending).toBe(false);
  });

  it("flush writes the pending project immediately and clears the timer", () => {
    const written: unknown[] = [];
    const timers = fakes();
    const scheduler = createRecoveryScheduler({
      delayMs: 400,
      write: (project) => written.push(project),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });

    scheduler.schedule("rev-1");
    scheduler.flush();

    expect(written).toEqual(["rev-1"]);
    expect(timers.armedCount()).toBe(0);

    // Firing the timer after flush must be a no-op (it was cleared).
    timers.fireAll();
    expect(written).toEqual(["rev-1"]);
  });

  it("flush is idempotent when nothing is pending", () => {
    const written: unknown[] = [];
    const timers = fakes();
    const scheduler = createRecoveryScheduler({
      delayMs: 400,
      write: (project) => written.push(project),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });

    scheduler.flush(); // nothing scheduled
    scheduler.flush();
    expect(written).toEqual([]);
    expect(scheduler.isPending).toBe(false);
  });

  it("cancel drops the pending write without writing", () => {
    const written: unknown[] = [];
    const timers = fakes();
    const scheduler = createRecoveryScheduler({
      delayMs: 400,
      write: (project) => written.push(project),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });

    scheduler.schedule("rev-1");
    expect(scheduler.isPending).toBe(true);

    scheduler.cancel();
    expect(scheduler.isPending).toBe(false);
    expect(written).toEqual([]);
    expect(timers.armedCount()).toBe(0);

    // A late timer fire after cancel must not write the stale project.
    timers.fireAll();
    expect(written).toEqual([]);
  });

  it("cancel followed by a new schedule writes only the new project", () => {
    const written: unknown[] = [];
    const timers = fakes();
    const scheduler = createRecoveryScheduler({
      delayMs: 400,
      write: (project) => written.push(project),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });

    scheduler.schedule("old-project");
    scheduler.cancel();
    scheduler.schedule("new-project");

    timers.fire();

    // The old project was cancelled and must never be written.
    expect(written).toEqual(["new-project"]);
  });

  it("uses the configured delay for each scheduled timer", () => {
    let observedDelay = -1;
    const timers = fakes();
    const setTimeout: RecoverySetTimeout = (fn, ms) => {
      observedDelay = ms;
      return timers.setTimeout(fn, ms);
    };
    const scheduler = createRecoveryScheduler({
      delayMs: 250,
      write: () => {},
      setTimeout,
      clearTimeout: timers.clearTimeout,
    });

    scheduler.schedule("rev-1");
    expect(observedDelay).toBe(250);
  });

  it("dispose cancels a pending write and remains safe to call repeatedly", () => {
    const written: unknown[] = [];
    const timers = fakes();
    const scheduler = createRecoveryScheduler({
      delayMs: 400,
      write: (project) => written.push(project),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });

    scheduler.schedule("outgoing-project");
    scheduler.dispose();
    scheduler.dispose();
    timers.fireAll();

    expect(scheduler.isPending).toBe(false);
    expect(written).toEqual([]);
  });
});
