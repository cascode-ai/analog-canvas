// Recovery persistence scheduler.
//
// The editor persists recovery snapshots of committed Projects so unsaved
// edits survive a crash or accidental close. Writing on every committed
// transaction made large schematics feel janky, because each edit blocked
// the main thread, so this module coalesces a burst of successive edits into
// a single write, delayed by `delayMs`. The latest Project wins; earlier ones
// are dropped. The single correctness risk this introduces is losing the
// last pending write when the tab is hidden or closed before the timer
// fires, so callers MUST flush on `visibilitychange` (→ hidden) and
// `pagehide`, and MUST cancel before any whole-project replacement
// (Save/Discard/Open/Import/Restore) so a stale pending write for the old
// project cannot revive after the user moved on.
//
// The scheduler holds no React state: it owns only a timer handle and the most
// recently scheduled project. It is deliberately injectable (timer + write)
// so the unit test can drive it with fake timers and an inspectable write sink.

// Sentinel distinct from any valid Project (which is always an object), so the
// scheduler can distinguish "nothing scheduled" from "scheduled project is
// null/undefined" without an extra boolean flag.
const NOTHING: unique symbol = Symbol("icm.recovery.nothing");

/**
 * The scheduler intentionally treats timer handles as opaque. Browser and
 * Node timer implementations return different handle shapes, and callers
 * need only pass the same handle back to their paired clear function.
 */
export type RecoveryTimerHandle = unknown;
export type RecoverySetTimeout = (
  handler: () => void,
  delayMs: number,
) => RecoveryTimerHandle;
export type RecoveryClearTimeout = (handle: RecoveryTimerHandle) => void;

export interface RecoverySchedulerOptions<Project = unknown> {
  /** Delay before a scheduled write actually fires. */
  readonly delayMs: number;
  /**
   * Invoked with the latest Project when the timer fires or `flush()` is
   * called. Implementations serialize and persist it. Must be idempotent under
   * repeated calls with the same value.
   */
  readonly write: (project: Project) => void;
  /** Injectable for tests; defaults to the global timer. */
  readonly setTimeout?: RecoverySetTimeout;
  /** Injectable for tests; defaults to the global timer. */
  readonly clearTimeout?: RecoveryClearTimeout;
}

export interface RecoveryScheduler<Project = unknown> {
  /**
   * Schedule (or reschedule) a write of `project`. Any previously pending
   * write for an earlier project is cancelled — the newest Project always
   * wins.
   */
  schedule(project: Project): void;
  /**
   * Write the latest pending Project immediately if one is pending, then clear
   * the timer and pending value. Idempotent: a second call with nothing
   * pending writes nothing.
   */
  flush(): void;
  /**
   * Drop any pending write WITHOUT writing it. Used before a whole-project
   * replacement so the old project's recovery data cannot be revived.
   */
  cancel(): void;
  /**
   * End this scheduler's lifetime. Dispose is intentionally cancel-only: a
   * page lifecycle handler is responsible for flushing before an actual page
   * hide; a React unmount must never write a stale session.
   */
  dispose(): void;
  /** Whether a write is currently pending (timer armed, project held). */
  readonly isPending: boolean;
}

export function createRecoveryScheduler<Project = unknown>(
  options: RecoverySchedulerOptions<Project>,
): RecoveryScheduler<Project> {
  const timer: RecoverySetTimeout =
    options.setTimeout ??
    ((handler: () => void, ms: number) => globalThis.setTimeout(handler, ms));
  const cancelTimer: RecoveryClearTimeout =
    options.clearTimeout ??
    ((handle: RecoveryTimerHandle) =>
      globalThis.clearTimeout(
        handle as ReturnType<typeof globalThis.setTimeout>,
      ));

  let handle: RecoveryTimerHandle | null = null;
  let pending: Project | typeof NOTHING = NOTHING;

  function clearTimer(): void {
    if (handle !== null) {
      cancelTimer(handle);
      handle = null;
    }
  }

  function resetPending(): void {
    pending = NOTHING;
  }

  const scheduler: RecoveryScheduler<Project> = {
    schedule(project: Project): void {
      pending = project;
      clearTimer();
      handle = timer(() => {
        handle = null;
        const current = pending;
        resetPending();
        if (current === NOTHING) return;
        options.write(current);
      }, options.delayMs);
    },

    flush(): void {
      if (pending === NOTHING) {
        clearTimer();
        return;
      }
      clearTimer();
      const current = pending;
      resetPending();
      options.write(current);
    },

    cancel(): void {
      clearTimer();
      resetPending();
    },

    dispose(): void {
      this.cancel();
    },

    get isPending(): boolean {
      return pending !== NOTHING;
    },
  };

  return scheduler;
}
