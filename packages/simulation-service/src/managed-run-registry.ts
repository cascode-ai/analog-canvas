import {
  DEFAULT_MANAGED_RUN_POLICY,
  createManagedRun,
  isManagedRunTerminal,
  transitionManagedRun,
  type ManagedRunAdmission,
  type ManagedRunEvent,
  type ManagedRunPolicy,
  type ManagedRunRecord,
  type ManagedRunTransition,
} from "./managed-run.js";

export type ManagedRunAdmissionResult =
  | { ok: true; run: ManagedRunRecord; accepted: boolean }
  | {
      ok: false;
      code:
        | "REQUEST_ID_REUSED"
        | "OWNER_QUEUE_LIMIT"
        | "OWNER_ACTIVE_LIMIT"
        | "GLOBAL_QUEUE_LIMIT";
      retryAfterMs?: number;
    };

/** Local registry and behavioral oracle for durable storage adapters. */
export class InMemoryManagedRunRegistry {
  private readonly runs = new Map<string, ManagedRunRecord>();
  private readonly requests = new Map<
    string,
    { fingerprint: string; runId: string }
  >();

  constructor(
    private readonly policy: ManagedRunPolicy = DEFAULT_MANAGED_RUN_POLICY,
    private readonly now: () => number = Date.now,
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {}

  accept(admission: ManagedRunAdmission): ManagedRunAdmissionResult {
    this.prune();
    const requestKey = `${admission.ownerId}\u0000${admission.requestId}`;
    const previous = this.requests.get(requestKey);
    if (previous) {
      if (previous.fingerprint !== admission.requestFingerprint)
        return { ok: false, code: "REQUEST_ID_REUSED" };
      const run = this.runs.get(previous.runId);
      if (run) return { ok: true, run: structuredClone(run), accepted: false };
      return { ok: false, code: "REQUEST_ID_REUSED" };
    }

    const records = [...this.runs.values()];
    const queued = records.filter((run) => run.state === "queued");
    if (queued.length >= this.policy.maxQueuedGlobal)
      return { ok: false, code: "GLOBAL_QUEUE_LIMIT", retryAfterMs: 2_000 };
    if (
      queued.filter((run) => run.ownerId === admission.ownerId).length >=
      this.policy.maxQueuedPerOwner
    )
      return { ok: false, code: "OWNER_QUEUE_LIMIT", retryAfterMs: 2_000 };
    if (
      records.filter(
        (run) =>
          run.ownerId === admission.ownerId &&
          (run.state === "running" || run.state === "cancelling"),
      ).length >= this.policy.maxActivePerOwner
    )
      return { ok: false, code: "OWNER_ACTIVE_LIMIT", retryAfterMs: 2_000 };

    const run = createManagedRun(this.id(), admission, this.now());
    this.runs.set(run.id, run);
    this.requests.set(requestKey, {
      fingerprint: admission.requestFingerprint,
      runId: run.id,
    });
    return { ok: true, run: structuredClone(run), accepted: true };
  }

  read(runId: string): ManagedRunRecord | null {
    this.prune();
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : null;
  }

  transition(runId: string, event: ManagedRunEvent): ManagedRunTransition {
    const run = this.runs.get(runId);
    if (!run)
      return { ok: false, code: "INVALID_RUN_TRANSITION", state: "expired" };
    const result = transitionManagedRun(run, event);
    if (result.ok) this.runs.set(runId, result.run);
    return result.ok ? { ...result, run: structuredClone(result.run) } : result;
  }

  list(ownerId?: string): ManagedRunRecord[] {
    this.prune();
    return [...this.runs.values()]
      .filter((run) => ownerId === undefined || run.ownerId === ownerId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((run) => structuredClone(run));
  }

  private prune(): void {
    const now = this.now();
    for (const [runId, run] of this.runs) {
      if (
        run.state === "queued" &&
        run.queuedAt + this.policy.maxQueueWaitMs <= now
      ) {
        const expired = transitionManagedRun(run, {
          kind: "queue-expired",
          at: now,
          error: {
            code: "QUEUE_WAIT_EXPIRED",
            message: "The run exceeded the queue wait limit.",
            stage: "start",
            recovery: "retry-after",
          },
        });
        if (expired.ok) this.runs.set(runId, expired.run);
        continue;
      }
      if (
        isManagedRunTerminal(run.state) &&
        run.state !== "expired" &&
        run.finishedAt !== undefined &&
        run.finishedAt + this.policy.retentionMs <= now
      ) {
        const expired = transitionManagedRun(run, { kind: "expired", at: now });
        if (expired.ok) this.runs.set(runId, expired.run);
      }
    }
  }
}
