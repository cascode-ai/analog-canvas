/** The unscoped name also respects consumers running the previous host version. */
export const evidenceLockName = (projectId: string, scope?: string) =>
  `analog-canvas:evidence:${projectId}${scope ? ":" + scope : ""}`;
const changes = new EventTarget();
const CHANGE_CHANNEL = "analog-canvas:evidence-changes";
export function announceEvidenceChange(projectId: string) {
  changes.dispatchEvent(new CustomEvent("change", { detail: projectId }));
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANGE_CHANNEL);
      channel.postMessage({ projectId });
      channel.close();
    }
  } catch {
    /* Notification never authorizes GC or changes a committed result. */
  }
}
export function subscribeEvidenceChanges(
  projectId: string,
  listener: () => void,
) {
  const local = (event: Event) => {
    if ((event as CustomEvent<string>).detail === projectId) listener();
  };
  changes.addEventListener("change", local);
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(CHANGE_CHANNEL);
    channel.onmessage = (event: MessageEvent<{ projectId?: string }>) => {
      if (event.data.projectId === projectId) listener();
    };
  } catch {
    /* Local notifications still work. */
  }
  return () => {
    changes.removeEventListener("change", local);
    channel?.close();
  };
}

export class ProjectEvidenceLease {
  private current:
    { ready: Promise<void>; release(): Promise<void> } | undefined;
  constructor(
    private projectId: string,
    private locks: LockManager | undefined = globalThis.navigator?.locks,
    private scope?: string,
  ) {}
  acquire(): Promise<void> {
    // Hosts without Web Locks may read/write, but cannot safely reclaim files.
    if (!this.locks) return Promise.resolve();
    if (this.current) return this.current.ready;
    const controller = new AbortController();
    let acquired = false;
    let finish!: () => void;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const held = new Promise<void>((done) => {
      finish = done;
    });
    const ready = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const current = {
      ready,
      release() {
        if (acquired) finish();
        else controller.abort();
        return done;
      },
    };
    this.current = current;
    const done = this.locks
      .request(
        evidenceLockName(this.projectId, this.scope),
        { mode: "shared", signal: controller.signal },
        async () => {
          acquired = true;
          resolve();
          await held;
        },
      )
      .catch((error) => {
        if (this.current === current) this.current = undefined;
        reject(error);
      });
    return ready;
  }
  release() {
    const current = this.current;
    this.current = undefined;
    return current?.release() ?? Promise.resolve();
  }
}

/** Never wait for an active editor to close, and never steal its lock. */
export async function withExclusiveEvidence<T>(
  projectId: string,
  action: () => Promise<T>,
  locks: LockManager | undefined = globalThis.navigator?.locks,
  scope?: string,
): Promise<{ available: false } | { available: true; value: T }> {
  if (!locks) return { available: false };
  return locks.request(
    evidenceLockName(projectId, scope),
    { mode: "exclusive", ifAvailable: true },
    async (lock) =>
      lock
        ? { available: true as const, value: await action() }
        : { available: false as const },
  );
}
