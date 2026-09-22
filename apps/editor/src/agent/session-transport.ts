const RETRY_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
const PROBE_MS = 5_000;

export interface TransportDiagnostic {
  at: number;
  code: number;
  reason: string;
  clean: boolean;
  lastReceivedAt: number;
  lastSentAt: number;
  attempt: number;
  visibility: string;
}

/** One Project session owns one socket. React and wake events only signal it. */
export class SessionTransport {
  private socket: WebSocket | null = null;
  private stopped = false;
  private connecting = false;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private probe:
    { nonce: string; timer: ReturnType<typeof setTimeout> } | undefined;
  private lastReceivedAt = 0;
  private lastSentAt = 0;
  private lastTickAt = 0;
  private checking: Promise<boolean> | undefined;
  readonly diagnostics: TransportDiagnostic[] = [];

  constructor(
    private readonly options: {
      heartbeatIntervalMs: number;
      heartbeatTimeoutMs: number;
      createSocket: () => WebSocket;
      bind: (socket: WebSocket) => void;
      sendHeartbeat: (socket: WebSocket, nonce: string) => void;
      opened: () => void;
      reconnecting: () => void;
      needsAuthorizationCheck: () => boolean;
      checkAuthorization: () => Promise<boolean>;
      random?: () => number;
      visibility?: () => string;
    },
  ) {}

  private clearProbe() {
    if (this.probe) clearTimeout(this.probe.timer);
    this.probe = undefined;
  }

  /** Only validated same-session business frames or matching pong reach here. */
  received(nonce?: string) {
    if (nonce !== undefined && this.probe && nonce !== this.probe.nonce) return;
    this.lastReceivedAt = Date.now();
    this.attempt = 0;
    this.clearProbe();
  }

  private send(nonce: string) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.options.sendHeartbeat(this.socket, nonce);
    this.lastSentAt = Date.now();
  }

  private probeConnection() {
    if (this.probe || this.socket?.readyState !== WebSocket.OPEN) return;
    const socket = this.socket;
    const nonce = crypto.randomUUID();
    this.probe = {
      nonce,
      timer: setTimeout(() => {
        this.probe = undefined;
        if (
          Date.now() - this.lastTickAt >
          this.options.heartbeatIntervalMs * 2
        ) {
          this.lastTickAt = Date.now();
          this.probeConnection();
          return;
        }
        if (!this.stopped && this.socket === socket)
          socket.close(4000, "heartbeat probe timeout");
      }, PROBE_MS),
    };
    this.send(nonce);
  }

  private checkAuthorization() {
    if (!this.checking) {
      this.checking = this.options
        .checkAuthorization()
        .catch(() => false)
        .finally(() => {
          this.checking = undefined;
        });
    }
    return this.checking;
  }

  private tick() {
    if (this.stopped) return;
    const now = Date.now();
    // A suspended event loop cannot prove a missed probe. Give it a fresh one.
    if (now - this.lastTickAt > this.options.heartbeatIntervalMs * 2)
      this.clearProbe();
    this.lastTickAt = now;
    if (this.options.needsAuthorizationCheck()) void this.checkAuthorization();
    if (now - this.lastReceivedAt >= this.options.heartbeatTimeoutMs)
      this.probeConnection();
    else if (!this.probe) this.send(crypto.randomUUID());
  }

  wake() {
    if (this.stopped) return;
    this.clearProbe();
    this.lastTickAt = Date.now();
    if (this.options.needsAuthorizationCheck()) void this.checkAuthorization();
    if (this.socket?.readyState === WebSocket.OPEN) this.probeConnection();
    else if (this.socket?.readyState !== WebSocket.CONNECTING) {
      clearTimeout(this.retry);
      void this.connect();
    }
  }

  async connect() {
    if (
      this.stopped ||
      this.connecting ||
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    )
      return;
    this.connecting = true;
    try {
      if (
        this.options.needsAuthorizationCheck() &&
        !(await this.checkAuthorization())
      ) {
        this.schedule();
        return;
      }
      if (this.stopped) return;
      const socket = this.options.createSocket();
      this.socket = socket;
      this.options.bind(socket);
      let opened = false;
      socket.addEventListener("open", () => {
        if (this.stopped || this.socket !== socket) return;
        opened = true;
        this.lastReceivedAt = this.lastTickAt = Date.now();
        this.heartbeat = setInterval(
          () => this.tick(),
          this.options.heartbeatIntervalMs,
        );
        this.send(crypto.randomUUID());
        this.options.opened();
      });
      socket.addEventListener("close", (event) => {
        if (this.socket !== socket) return;
        this.diagnostics.push({
          at: Date.now(),
          code: event.code,
          reason:
            event.code === 4000
              ? "probe-timeout"
              : event.code === 4001
                ? "replaced"
                : "socket-closed",
          clean: event.wasClean,
          lastReceivedAt: this.lastReceivedAt,
          lastSentAt: this.lastSentAt,
          attempt: this.attempt,
          visibility: this.options.visibility?.() ?? "unknown",
        });
        if (this.diagnostics.length > 16) this.diagnostics.shift();
        this.socket = null;
        clearInterval(this.heartbeat);
        this.clearProbe();
        if (!this.stopped) {
          if (!opened) void this.checkAuthorization();
          this.schedule();
        }
      });
      socket.addEventListener("error", () => {
        if (this.socket === socket && !this.stopped) socket.close();
      });
    } catch {
      this.schedule();
    } finally {
      this.connecting = false;
    }
  }

  private schedule() {
    if (this.stopped) return;
    this.options.reconnecting();
    clearTimeout(this.retry);
    const delay = RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)]!;
    this.retry = setTimeout(
      () => void this.connect(),
      delay * (0.8 + (this.options.random ?? Math.random)() * 0.4),
    );
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    this.clearProbe();
    this.socket?.close(1000, "session transport stopped");
  }
}
