/** Cross-tab lifetime protection for Project evidence. No timer or network lease. */
const lockName = (projectId: string) => `analog-canvas:evidence:${projectId}`;

export class ProjectEvidenceLease {
  private current: { ready: Promise<void>; release(): void } | undefined;
  constructor(
    private projectId: string,
    private locks: LockManager | undefined = globalThis.navigator?.locks,
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
      },
    };
    this.current = current;
    void this.locks
      .request(
        lockName(this.projectId),
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
    current?.release();
  }
}

/** Never wait for an active editor to close, and never steal its lock. */
export async function withExclusiveEvidence<T>(
  projectId: string,
  action: () => Promise<T>,
  locks: LockManager | undefined = globalThis.navigator?.locks,
): Promise<{ available: false } | { available: true; value: T }> {
  if (!locks) return { available: false };
  return locks.request(
    lockName(projectId),
    { mode: "exclusive", ifAvailable: true },
    async (lock) =>
      lock
        ? { available: true as const, value: await action() }
        : { available: false as const },
  );
}
