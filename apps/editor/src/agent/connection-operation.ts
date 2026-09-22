/** One owner for asynchronous connection controls, shared by both UI surfaces. */
export type ConnectionOperationKind =
  "creating" | "disconnecting" | "pausing" | "resuming";

export class ConnectionOperation {
  pending = true;
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(
    readonly kind: ConnectionOperationKind,
    timeoutMs = 15_000,
  ) {
    this.timer = setTimeout(
      () =>
        this.controller.abort(
          new Error("Agent connection operation timed out. Please retry."),
        ),
      timeoutMs,
    );
  }

  /** Also bounds non-cancellable work such as an IndexedDB recovery flush. */
  wait<T>(work: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(this.signal.reason);
      work
        .then(resolve, reject)
        .finally(() => this.signal.removeEventListener("abort", abort));
      if (this.signal.aborted) abort();
      else this.signal.addEventListener("abort", abort, { once: true });
    });
  }

  finish() {
    this.pending = false;
    clearTimeout(this.timer);
  }
  cancel() {
    this.finish();
    this.controller.abort(new Error("Connection operation superseded"));
  }
}
