/**
 * Own one simulator process from admission through cleanup.
 *
 * This is deliberately not a queue and not a product Run resource. It is the
 * process-local safety boundary inside one harness: one active lease, one
 * process tree, and one finite lifetime. If that lifetime cannot be brought to
 * a clean end, the safe recovery is to retire the whole harness rather than
 * admit a second process beside an uncertain first one.
 */

const DEFAULT_RETRY_AFTER_SECONDS = 2;
const DEFAULT_LIFECYCLE_GRACE_MS = 10_000;

const TRANSITIONS = new Map([
  ["preparing", new Set(["running", "collecting", "cleaning"])],
  ["running", new Set(["terminating", "collecting", "cleaning"])],
  ["terminating", new Set(["collecting", "cleaning"])],
  ["collecting", new Set(["cleaning"])],
  ["cleaning", new Set()],
  ["fatal", new Set()],
]);

function positiveInteger(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

export function resolveRunTimeout(
  requested,
  { defaultTimeoutMs, maxTimeoutMs },
) {
  const fallback = positiveInteger(defaultTimeoutMs, 30_000);
  const maximum = positiveInteger(maxTimeoutMs, 120_000);
  if (!Number.isFinite(requested)) return Math.min(fallback, maximum);
  return Math.min(Math.max(Math.trunc(requested), 1), maximum);
}

/** Kill the detached simulator session, falling back to its direct PID. */
export function terminateProcessGroup(child, signal = "SIGKILL") {
  if (!child || typeof child.pid !== "number") return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process has already gone. Termination is idempotent.
    }
  }
}

function defaultFailStop(event) {
  // One bounded record, with no deck or user data, before PID 1 retires.
  console.error(JSON.stringify(event));
  process.exit(70);
}

export class SimulationRunSupervisor {
  #active = null;
  #sequence = 0;
  #defaultTimeoutMs;
  #maxTimeoutMs;
  #lifecycleGraceMs;
  #retryAfterSeconds;
  #now;
  #setTimer;
  #clearTimer;
  #terminate;
  #failStop;

  constructor({
    defaultTimeoutMs = 30_000,
    maxTimeoutMs = 120_000,
    lifecycleGraceMs = DEFAULT_LIFECYCLE_GRACE_MS,
    retryAfterSeconds = DEFAULT_RETRY_AFTER_SECONDS,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    terminate = terminateProcessGroup,
    failStop = defaultFailStop,
  } = {}) {
    this.#defaultTimeoutMs = positiveInteger(defaultTimeoutMs, 30_000);
    this.#maxTimeoutMs = positiveInteger(maxTimeoutMs, 120_000);
    this.#lifecycleGraceMs = positiveInteger(
      lifecycleGraceMs,
      DEFAULT_LIFECYCLE_GRACE_MS,
    );
    this.#retryAfterSeconds = positiveInteger(
      retryAfterSeconds,
      DEFAULT_RETRY_AFTER_SECONDS,
    );
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#terminate = terminate;
    this.#failStop = failStop;
  }

  get limits() {
    return {
      concurrentRuns: 1,
      defaultTimeoutMs: this.#defaultTimeoutMs,
      maxTimeoutMs: this.#maxTimeoutMs,
      lifecycleGraceMs: this.#lifecycleGraceMs,
    };
  }

  snapshot() {
    const active = this.#active;
    if (!active) return { state: "idle" };
    const now = this.#now();
    return {
      state: active.phase === "fatal" ? "fatal" : "active",
      phase: active.phase,
      heldMs: Math.max(0, now - active.acquiredAt),
      deadlineInMs: Math.max(0, active.hardDeadlineAt - now),
      ...(active.terminationReason
        ? { terminationReason: active.terminationReason }
        : {}),
    };
  }

  async tryExecute({ timeoutMs } = {}, operation) {
    if (typeof operation !== "function") {
      throw new TypeError("A supervised run needs an operation.");
    }
    if (this.#active) {
      return {
        kind: "busy",
        retryAfterSeconds: this.#retryAfterSeconds,
      };
    }

    const effectiveTimeoutMs = resolveRunTimeout(timeoutMs, {
      defaultTimeoutMs: this.#defaultTimeoutMs,
      maxTimeoutMs: this.#maxTimeoutMs,
    });
    const acquiredAt = this.#now();
    const active = {
      leaseId: ++this.#sequence,
      phase: "preparing",
      acquiredAt,
      timeoutMs: effectiveTimeoutMs,
      hardDeadlineAt: acquiredAt + effectiveTimeoutMs + this.#lifecycleGraceMs,
      child: null,
      processTimer: null,
      hardTimer: null,
      terminationReason: null,
    };
    this.#active = active;

    active.hardTimer = this.#setTimer(
      () => this.#expireLease(active),
      effectiveTimeoutMs + this.#lifecycleGraceMs,
    );
    active.hardTimer?.unref?.();

    const context = this.#context(active, effectiveTimeoutMs);
    try {
      return {
        kind: "completed",
        value: await operation(context),
      };
    } finally {
      // A fail-stop dependency is injectable in tests and may return. Never
      // turn a fatal lease back into an idle supervisor in that case.
      if (this.#active === active && active.phase !== "fatal") {
        this.#clearActive(active);
      }
    }
  }

  #context(active, effectiveTimeoutMs) {
    const ensureOwner = () => {
      if (this.#active !== active) {
        throw new Error("This run lease no longer owns the simulator slot.");
      }
      if (active.phase === "fatal") {
        throw new Error("This run lease has entered the fatal state.");
      }
    };

    return Object.freeze({
      timeoutMs: effectiveTimeoutMs,
      phase: (next) => {
        ensureOwner();
        if (next === active.phase) return;
        if (!TRANSITIONS.get(active.phase)?.has(next)) {
          throw new Error(
            `Invalid simulator run transition: ${active.phase} -> ${next}.`,
          );
        }
        active.phase = next;
      },
      attachProcess: (child) => {
        ensureOwner();
        if (active.child) {
          throw new Error("This run lease already owns a simulator process.");
        }
        if (active.phase !== "preparing") {
          throw new Error(
            `A simulator process cannot start during ${active.phase}.`,
          );
        }
        active.child = child;
        active.phase = "running";
        active.processTimer = this.#setTimer(() => {
          if (this.#active !== active || active.phase === "fatal") return;
          active.phase = "terminating";
          active.terminationReason = "timeout";
          this.#terminate(active.child, "SIGKILL");
        }, effectiveTimeoutMs);
        active.processTimer?.unref?.();
      },
      terminateAttachedProcess: () => {
        ensureOwner();
        this.#terminate(active.child, "SIGKILL");
      },
      detachProcess: (child) => {
        ensureOwner();
        if (active.child !== child) return;
        if (active.processTimer) this.#clearTimer(active.processTimer);
        active.processTimer = null;
        active.child = null;
      },
      get timedOut() {
        return active.terminationReason === "timeout";
      },
    });
  }

  #expireLease(active) {
    if (this.#active !== active || active.phase === "fatal") return;
    const previousPhase = active.phase;
    active.phase = "fatal";
    active.terminationReason = "watchdog";
    if (active.processTimer) this.#clearTimer(active.processTimer);
    active.processTimer = null;
    this.#terminate(active.child, "SIGKILL");
    this.#failStop({
      event: "simulation-run-watchdog",
      reason: "run-lease-expired",
      phase: previousPhase,
      heldMs: Math.max(0, this.#now() - active.acquiredAt),
      timeoutMs: active.timeoutMs,
      hardDeadlineAt: active.hardDeadlineAt,
      childAttached: active.child !== null,
    });
  }

  #clearActive(active) {
    if (active.processTimer) this.#clearTimer(active.processTimer);
    if (active.hardTimer) this.#clearTimer(active.hardTimer);
    active.processTimer = null;
    active.hardTimer = null;
    active.child = null;
    this.#active = null;
  }
}
