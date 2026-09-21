import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionTransport } from "./session-transport";

class Socket extends EventTarget {
  readyState = 0;
  close = vi.fn((code = 1000, reason = "") => {
    this.readyState = 3;
    this.dispatchEvent(
      Object.assign(new Event("close"), { code, reason, wasClean: true }),
    );
  });
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
}

function fixture() {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", { OPEN: 1, CONNECTING: 0 });
  const sockets: Socket[] = [];
  const options = {
    createSocket: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    bind: vi.fn(),
    sendHeartbeat: vi.fn(),
    opened: vi.fn(),
    reconnecting: vi.fn(),
    needsAuthorizationCheck: vi.fn(() => false),
    checkAuthorization: vi.fn(async () => true),
    random: () => 0.5,
  };
  const transport = new SessionTransport(options);
  void transport.connect();
  sockets[0]!.open();
  return { transport, options, sockets };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Project session transport", () => {
  it("probes a stale socket on wake and accepts only the current probe pong", async () => {
    const { transport, options, sockets } = fixture();
    vi.setSystemTime(Date.now() + 120_000);
    transport.wake();
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    const nonce = options.sendHeartbeat.mock.lastCall![1];
    transport.received("old-pong");
    await vi.advanceTimersByTimeAsync(4_999);
    transport.received(nonce);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    transport.stop();
  });

  it("closes only after an unanswered fresh probe, reconnects once and stops terminally", async () => {
    const { transport, sockets } = fixture();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets[0]!.close).toHaveBeenCalledWith(
      4000,
      "heartbeat probe timeout",
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets).toHaveLength(2);
    expect(transport.diagnostics[0]).toMatchObject({
      code: 4000,
      reason: "probe-timeout",
    });
    transport.stop();
    transport.wake();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(sockets).toHaveLength(2);
  });

  it("uses validated business traffic as liveness without adding status probes", async () => {
    const { transport, options, sockets } = fixture();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      transport.received();
    }
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    expect(options.checkAuthorization).not.toHaveBeenCalled();
    transport.stop();
  });

  it("checks a stale lease without closing a healthy socket or extending the lease locally", async () => {
    const { transport, options, sockets } = fixture();
    options.needsAuthorizationCheck.mockReturnValue(true);
    options.checkAuthorization.mockResolvedValue(false);
    transport.wake();
    await Promise.resolve();
    expect(options.checkAuthorization).toHaveBeenCalledTimes(1);
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    transport.stop();
  });
});
