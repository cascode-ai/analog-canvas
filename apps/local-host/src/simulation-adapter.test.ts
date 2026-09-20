import { describe, expect, it, vi } from "vitest";
import { SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES } from "@icm/spice-run";
import { createLocalSimulationHandler } from "./simulation-adapter.js";

const request = (body: unknown) =>
  new Request("http://localhost/api/simulate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      authorization: "Bearer browser-secret",
      cookie: "private=1",
      origin: "http://localhost",
    },
  });
describe("explicit local executor adapter", () => {
  it.each([
    "https://127.0.0.1:9000",
    "http://localhost:9000",
    "http://example.com:9000",
    "http://0.0.0.0:9000",
    "http://127.0.0.1",
    "http://127.0.0.1:0",
    "http://user:secret@127.0.0.1:9000",
    "http://127.0.0.1:9000/run",
    "http://127.0.0.1:9000/?other=1",
    "http://127.0.0.1:9000/#fragment",
  ])("rejects nonliteral or ambiguous executor origin %s", (url) => {
    expect(() => createLocalSimulationHandler(url)).toThrow();
  });
  it("forwards unchanged input only to the fixed endpoint, strips caller credentials and preserves busy", async () => {
    const forward = vi.fn(async () =>
      Response.json(
        { error: "simulator-busy" },
        {
          status: 429,
          headers: { "retry-after": "2", "set-cookie": "executor=private" },
        },
      ),
    );
    const handler = createLocalSimulationHandler(
      "http://127.0.0.1:9000",
      forward,
    );
    const body = {
      language: "vacask",
      files: [{ path: "run.sim", text: "native" }],
      runToken: "same-token",
    };
    const reply = await handler(request(body));
    expect(reply.status).toBe(429);
    expect(reply.headers.get("retry-after")).toBe("2");
    expect(reply.headers.get("set-cookie")).toBeNull();
    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:9000/api/simulate"),
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          "x-analog-execution-transfer": "receipt-v1",
        },
      }),
    );
  });
  it.each([
    [undefined, "simulator-unreachable", 502],
    ["cancel", "cancel-response-unknown", 502],
    ["capabilities", "simulation-executor-unavailable", 503],
  ])(
    "does not retry an uncertain %s request",
    async (operation, error, status) => {
      const forward = vi.fn(async () => {
        throw new Error("connection lost");
      });
      const reply = await createLocalSimulationHandler(
        "http://[::1]:9000",
        forward,
      )(request({ operation }));
      expect(reply.status).toBe(status);
      expect(await reply.json()).toMatchObject({ error });
      expect(forward).toHaveBeenCalledTimes(1);
    },
  );
  it("bounds a streaming reply and treats the dispatched run as uncertain", async () => {
    const cancelled = vi.fn();
    const forward = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
            cancel: cancelled,
          }),
        ),
    );
    const reply = await createLocalSimulationHandler(
      "http://127.0.0.1:9000",
      forward,
    )(request({}));
    await expect(reply.text()).rejects.toThrow("Executor response too large");
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
  });
  it("returns before the body completes and propagates consumer cancellation", async () => {
    const cancelled = vi.fn();
    let pulls = 0;
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1024));
      },
      cancel: cancelled,
    });
    const reply = await createLocalSimulationHandler(
      "http://127.0.0.1:9000",
      async () => new Response(upstream),
    )(request({}));
    expect(pulls).toBeLessThanOrEqual(2);
    const reader = reply.body!.getReader();
    expect((await reader.read()).value).toHaveLength(1024);
    await reader.cancel("not needed");
    expect(cancelled).toHaveBeenCalledWith("not needed");
  });
  it("forwards a multi-analysis envelope at the shared ceiling without losing bytes", async () => {
    const text = "x".repeat(SIMULATION_EXECUTOR_RESPONSE_MAX_BYTES);
    const forward = vi.fn(async () => new Response(text));
    const reply = await createLocalSimulationHandler(
      "http://127.0.0.1:9000",
      forward,
    )(request({}));
    expect(reply.status).toBe(200);
    expect(await reply.text()).toBe(text);
    expect(forward).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed operations before contacting the executor", async () => {
    const forward = vi.fn();
    const handler = createLocalSimulationHandler(
      "http://127.0.0.1:9000",
      forward,
    );
    for (const body of [null, [], { operation: "install" }])
      expect((await handler(request(body))).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });
});
