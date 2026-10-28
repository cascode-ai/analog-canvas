import { afterEach, beforeEach, expect, it, vi } from "vitest";

const origin = "https://rich-netlist.github.io";
const features = ["requestId", "packages", "opener"];
let receive: (event: MessageEvent) => void;
let popup: {
  closed: boolean;
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
};
let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  popup = { closed: false, focus: vi.fn(), postMessage: vi.fn() };
  open = vi.fn(() => popup);
  vi.stubGlobal("location", { origin: "https://ac.example" });
  vi.stubGlobal("window", {
    open,
    addEventListener: vi.fn((type, listener) => {
      if (type === "message") receive = listener;
    }),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ rnl: 1, features })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function reply(
  data: Record<string, unknown>,
  source: unknown = popup,
  from = origin,
) {
  const token = new URL(open.mock.calls.at(-1)![0] as string).searchParams.get(
    "token",
  );
  receive({
    data: { rnl: 1, token, ...data },
    source,
    origin: from,
  } as MessageEvent);
}

it("opens synchronously, verifies the handshake, sends the exact export and reuses the tab", async () => {
  const { openRnlViewer } = await import("./rnl-viewer");
  const pending = openRnlViewer({
    name: "circuit.sp",
    text: "* export one\n.end\n",
  });
  expect(open).toHaveBeenCalledTimes(1);
  expect(open.mock.calls[0]![1]).toBe("rnl-viewer");
  expect(
    new URL(open.mock.calls[0]![0] as string).searchParams.get("origin"),
  ).toBe("https://ac.example");
  expect(open.mock.calls[0]![0]).not.toContain("export");
  reply({ type: "ready", features }, {}, origin);
  reply({ type: "ready", features }, popup, "https://wrong.example");
  reply({ type: "ready", features, token: "expired" });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(popup.postMessage).not.toHaveBeenCalled();
  reply({ type: "ready", features });
  await vi.waitFor(() => expect(popup.postMessage).toHaveBeenCalledTimes(1));
  const message = popup.postMessage.mock.calls[0]![0] as Record<
    string,
    unknown
  >;
  expect(message).toMatchObject({
    rnl: 1,
    type: "open",
    name: "circuit.sp",
    text: "* export one\n.end\n",
    packages: [{ name: "analog-canvas-extensions", version: "0.4" }],
  });
  expect(popup.postMessage.mock.calls[0]![1]).toBe(origin);
  reply({ type: "loaded", requestId: message.requestId });
  await pending;
  const next = openRnlViewer({ name: "circuit.scs", text: "// export two" });
  expect(open).toHaveBeenCalledTimes(1);
  const second = popup.postMessage.mock.calls[1]![0] as Record<string, unknown>;
  expect(second).toMatchObject({ name: "circuit.scs", text: "// export two" });
  expect(second.requestId).not.toBe(message.requestId);
  reply({ type: "error", requestId: message.requestId, message: "old error" });
  reply({ type: "loaded", requestId: second.requestId });
  await next;
});

it("reports blocked popups and an old Viewer without waiting for a handshake timeout", async () => {
  const { openRnlViewer } = await import("./rnl-viewer");
  open.mockReturnValueOnce(null);
  await expect(openRnlViewer({ name: "x.sp", text: "x" })).rejects.toThrow(
    "Allow pop-ups",
  );
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response("old viewer", { status: 404 }),
  );
  await expect(openRnlViewer({ name: "x.sp", text: "x" })).rejects.toThrow(
    "too old",
  );
});

it("reports correlated Viewer failures and a closed tab timeout", async () => {
  vi.useFakeTimers();
  const { openRnlViewer } = await import("./rnl-viewer");
  const pending = openRnlViewer({ name: "x.sp", text: "x" });
  reply({ type: "ready", features });
  await vi.advanceTimersByTimeAsync(0);
  const message = popup.postMessage.mock.calls[0]![0] as Record<
    string,
    unknown
  >;
  const failed = expect(pending).rejects.toThrow("declined");
  reply({ type: "error", requestId: message.requestId, message: "declined" });
  await failed;
  const retry = openRnlViewer({ name: "x.sp", text: "x" });
  const timedOut = expect(retry).rejects.toThrow("tab was closed");
  popup.closed = true;
  await vi.advanceTimersByTimeAsync(60_000);
  await timedOut;
});

it.each(["readiness", "capabilities"])(
  "restarts a timed-out %s handshake and imports successfully on retry",
  async (missing) => {
    vi.useFakeTimers();
    if (missing === "capabilities")
      vi.mocked(fetch).mockReturnValueOnce(new Promise(() => {}));
    const { openRnlViewer } = await import("./rnl-viewer");
    const pending = openRnlViewer({ name: "x.sp", text: "x" });
    const timedOut = expect(pending).rejects.toThrow("did not respond");
    if (missing === "capabilities") reply({ type: "ready", features });
    await vi.advanceTimersByTimeAsync(60_000);
    await timedOut;
    const retry = openRnlViewer({ name: "x.sp", text: "retry" });
    expect(open).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    reply({ type: "ready", features });
    await vi.advanceTimersByTimeAsync(0);
    const message = popup.postMessage.mock.calls.at(-1)![0] as Record<
      string,
      unknown
    >;
    expect(message.text).toBe("retry");
    reply({ type: "loaded", requestId: message.requestId });
    await retry;
  },
);
