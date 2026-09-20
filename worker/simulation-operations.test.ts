import { createSimulationOperationsHarness as harness } from "./simulation-operations.test-fixture";
import { describe, expect, it, vi } from "vitest";
import { createManagedHostedExecutor } from "@icm/simulation-service";

import {
  nativeWorkerEnv,
  nativeInput,
  nativeHealth,
  nativeStreamingReply,
} from "./simulation.test-fixture";

import {
  consumeSimulationJobs,
  routeManagedSimulationRequest,
  type SimulationJobMessage,
  type SimulationQueueMessage,
} from "./simulation-operations";

function startRequest() {
  return new Request("https://canvas.test/api/simulation/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "request-a",
      preparedId: "prepared-a",
      preparedDigest: "a".repeat(64),
      input: nativeInput(),
    }),
  });
}

describe("managed simulation operations", () => {
  it.each([false, true])(
    "stores receipt-bound executor streams and refuses corrupt evidence (%s)",
    async (corrupt) => {
      const { env, jobs, runtime, bucket, close } = harness();
      const execute = vi.fn(async (_url: string, init?: RequestInit) =>
        nativeStreamingReply(JSON.parse(String(init?.body)), corrupt),
      );
      env.VACASK = nativeWorkerEnv(execute).VACASK;
      try {
        const accepted = await routeManagedSimulationRequest(
          startRequest(),
          env,
          runtime,
        );
        const id = (await accepted!.json()).run.id;
        const put = vi.spyOn(bucket, "put");
        const delivery = { body: jobs[0]!, ack: vi.fn(), retry: vi.fn() };
        await consumeSimulationJobs({ messages: [delivery] }, env, runtime);
        const responsePut = put.mock.calls.find(([key]) =>
          key.endsWith("response.json"),
        );
        expect(responsePut?.[1]).toBeInstanceOf(ReadableStream);
        expect(responsePut?.[2]?.sha256).toMatch(/^[a-f0-9]{64}$/u);
        const read = await routeManagedSimulationRequest(
          new Request(`https://canvas.test/api/simulation/runs/${id}`),
          env,
          runtime,
        );
        expect((await read!.json()).run.state).toBe(
          corrupt ? "infrastructure-failed" : "succeeded",
        );
        expect(delivery.ack).toHaveBeenCalledOnce();
        expect(delivery.retry).not.toHaveBeenCalled();
        expect(execute).toHaveBeenCalledOnce();
        expect(
          [...bucket.objects.keys()].some((key) =>
            key.endsWith("response.json"),
          ),
        ).toBe(!corrupt);
      } finally {
        close();
      }
    },
  );
  it("streams retained results without buffering and checks ownership before accessing bytes", async () => {
    const { env, jobs, runtime, bucket, close } = harness();
    try {
      const accepted = await routeManagedSimulationRequest(
        startRequest(),
        env,
        runtime,
      );
      const id = (await accepted!.json()).run.id;
      await consumeSimulationJobs(
        { messages: [{ body: jobs[0]!, ack: vi.fn(), retry: vi.fn() }] },
        env,
        runtime,
      );
      let emitted = 0;
      const chunk = new Uint8Array(64 * 1024).fill(65);
      const text = vi.fn(async () => {
        throw new Error("must not buffer retained evidence");
      });
      const get = vi.spyOn(bucket, "get").mockImplementation(async () => ({
        text,
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            if (emitted === 256) controller.close();
            else {
              emitted++;
              controller.enqueue(chunk);
            }
          },
        }),
      }));
      const url = `https://canvas.test/api/simulation/runs/${id}/result`;
      const denied = await routeManagedSimulationRequest(
        new Request(url),
        env,
        {
          ...runtime,
          principalOf: async () => ({
            ...(await runtime.principalOf()),
            id: "other-owner",
          }),
        },
      );
      expect(denied!.status).toBe(404);
      expect(get).not.toHaveBeenCalled();
      const response = await routeManagedSimulationRequest(
        new Request(url),
        env,
        runtime,
      );
      expect(emitted).toBeLessThanOrEqual(1);
      expect(response!.headers.get("cache-control")).toBe("private, no-store");
      const reader = response!.body!.getReader();
      let bytes = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        expect(next.value[0]).toBe(65);
      }
      expect(bytes).toBe(16 * 1024 * 1024);
      expect(text).not.toHaveBeenCalled();
      expect(get).toHaveBeenCalledOnce();
    } finally {
      close();
    }
  });
  it("reports queued cancellation as terminal, not result-not-ready, without dispatching", async () => {
    const { env, jobs, runtime, close } = harness();
    const execute = vi.fn();
    env.VACASK = nativeWorkerEnv(execute).VACASK;
    try {
      const accepted = await routeManagedSimulationRequest(
        startRequest(),
        env,
        runtime,
      );
      const id = (await accepted!.json()).run.id;
      const url = `https://canvas.test/api/simulation/runs/${id}`;
      const pending = await routeManagedSimulationRequest(
        new Request(`${url}/result`),
        env,
        runtime,
      );
      expect(await pending!.json()).toMatchObject({
        error: "RESULT_NOT_READY",
      });
      await routeManagedSimulationRequest(
        new Request(`${url}/cancel`, { method: "POST" }),
        env,
        runtime,
      );
      const message = { body: jobs[0]!, ack: vi.fn(), retry: vi.fn() };
      await consumeSimulationJobs({ messages: [message] }, env, runtime);
      expect(execute).not.toHaveBeenCalled();
      expect(message.ack).toHaveBeenCalledOnce();
      const cancelled = await routeManagedSimulationRequest(
        new Request(`${url}/result`),
        env,
        runtime,
      );
      expect(await cancelled!.json()).toMatchObject({
        error: "run-cancelled",
        state: "cancelled",
        recovery: "not-retryable",
      });
      expect(cancelled!.headers.has("retry-after")).toBe(false);
    } finally {
      close();
    }
  });
  it("carries native admission Problems through queued storage and permits a repaired run in the same client", async () => {
    const { env, jobs, runtime, close } = harness();
    const deliveries: SimulationQueueMessage<(typeof jobs)[number]>[] = [];
    const executor = createManagedHostedExecutor({
      fetch: async (path, init) =>
        (await routeManagedSimulationRequest(
          new Request(new URL(String(path), "https://canvas.test"), init),
          env,
          runtime,
        ))!,
      sleep: async () => {
        const body = jobs.shift()!;
        const message = { body, ack: vi.fn(), retry: vi.fn() };
        deliveries.push(message);
        await consumeSimulationJobs({ messages: [message] }, env, runtime);
      },
    });
    const identity = {
      preparedId: "prepared-a",
      preparedDigest: "a".repeat(64),
    };
    try {
      await expect(
        executor.execute(
          { ...nativeInput(), preparedDeck: "changed" },
          "bad-request",
          undefined,
          identity,
        ),
      ).rejects.toMatchObject({
        problem: {
          code: "prepared-input-changed",
          recovery: "reprepare",
          message: "Prepared entry and submitted source bytes differ.",
        },
      });
      await expect(
        executor.execute(nativeInput(), "fixed-request", undefined, identity),
      ).resolves.toMatchObject({
        result: { outcome: { status: "completed" } },
      });
      expect(deliveries).toHaveLength(2);
      for (const message of deliveries) {
        expect(message.ack).toHaveBeenCalledOnce();
        expect(message.retry).not.toHaveBeenCalled();
      }
    } finally {
      close();
    }
  });
  it("a consumer that failed before acquiring a lease cannot requeue another active attempt", async () => {
    const { env, jobs, runtime, control } = harness();
    const started = await routeManagedSimulationRequest(
      startRequest(),
      env,
      runtime,
    );
    const runId = (await started!.json()).run.id as string;
    await control.fetch(
      new Request(`https://simulation-control/runs/${runId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "lease-acquired",
          lease: { id: "other-consumer", acquiredAt: 100, expiresAt: 1000 },
        }),
      }),
    );
    const original = env.SIMULATION_CONTROL!.getByName("simulation");
    const fetchControl = vi
      .fn(original.fetch)
      .mockRejectedValueOnce(new Error("read interrupted"));
    env.SIMULATION_CONTROL = { getByName: () => ({ fetch: fetchControl }) };
    const execute = vi.fn();
    env.VACASK = nativeWorkerEnv(execute).VACASK;
    const delivery = { body: jobs[0]!, ack: vi.fn(), retry: vi.fn() };
    await consumeSimulationJobs({ messages: [delivery] }, env, runtime);
    expect(execute).not.toHaveBeenCalled();
    expect(delivery.retry).toHaveBeenCalledOnce();
    const response = await routeManagedSimulationRequest(
      new Request(`https://canvas.test/api/simulation/runs/${runId}`),
      env,
      runtime,
    );
    expect(await response!.json()).toMatchObject({
      run: { state: "running", attempt: 1, lease: { id: "other-consumer" } },
    });
  });
  it("can retry a storage failure before any executor dispatch", async () => {
    const { env, jobs, runtime, bucket } = harness();
    const original = env.VACASK!.getByName("test");
    const execute = vi.fn(original.fetch);
    env.VACASK = nativeWorkerEnv(execute).VACASK;
    const started = await routeManagedSimulationRequest(
      startRequest(),
      env,
      runtime,
    );
    const runId = (await started!.json()).run.id as string;
    vi.spyOn(bucket, "get").mockRejectedValueOnce(
      new Error("temporary read failure"),
    );
    const delivery = { body: jobs[0]!, ack: vi.fn(), retry: vi.fn() };
    await consumeSimulationJobs({ messages: [delivery] }, env, runtime);
    expect(execute).not.toHaveBeenCalled();
    expect(delivery.retry).toHaveBeenCalledOnce();
    await consumeSimulationJobs({ messages: [delivery] }, env, runtime);
    expect(execute).toHaveBeenCalledOnce();
    const response = await routeManagedSimulationRequest(
      new Request(`https://canvas.test/api/simulation/runs/${runId}`),
      env,
      runtime,
    );
    expect(await response!.json()).toMatchObject({
      run: { state: "succeeded", attempt: 2 },
    });
  });
  it.each(["lost-response", "invalid-response", "storage-failed"])(
    "does not execute again after %s, including duplicate Queue delivery",
    async (failure) => {
      const { env, jobs, runtime, bucket } = harness();
      const original = env.VACASK!.getByName("test");
      const execute = vi.fn(async (url: string, init?: RequestInit) => {
        if (failure === "lost-response")
          throw new Error("response lost after admission");
        if (failure === "invalid-response") return new Response("broken JSON");
        return original.fetch(url, init);
      });
      env.VACASK = nativeWorkerEnv(execute).VACASK;
      const started = await routeManagedSimulationRequest(
        startRequest(),
        env,
        runtime,
      );
      const runId = (await started!.json()).run.id as string;
      if (failure === "storage-failed")
        vi.spyOn(bucket, "put").mockRejectedValueOnce(
          new Error("storage down"),
        );
      const delivery = { body: jobs[0]!, ack: vi.fn(), retry: vi.fn() };
      await consumeSimulationJobs({ messages: [delivery] }, env, runtime);
      await consumeSimulationJobs({ messages: [delivery] }, env, runtime);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(delivery.retry).not.toHaveBeenCalled();
      expect(delivery.ack).toHaveBeenCalledTimes(2);
      const response = await routeManagedSimulationRequest(
        new Request(`https://canvas.test/api/simulation/runs/${runId}`),
        env,
        runtime,
      );
      expect(await response!.json()).toMatchObject({
        run: {
          state: "infrastructure-failed",
          attempt: 1,
          error: { recovery: "not-retryable" },
        },
      });
    },
  );

  it.each([false, true])(
    "retires expired execution without another dispatch or false cancellation (cancelling=%s)",
    async (cancelling) => {
      const { env, jobs, runtime, control } = harness();
      const execute = vi.fn();
      env.VACASK = nativeWorkerEnv(execute).VACASK;
      const started = await routeManagedSimulationRequest(
        startRequest(),
        env,
        runtime,
      );
      const runId = (await started!.json()).run.id as string;
      const transition = async (event: unknown) => {
        const reply = await control.fetch(
          new Request(`https://simulation-control/runs/${runId}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(event),
          }),
        );
        expect(reply.status).toBe(200);
      };
      await transition({
        kind: "lease-acquired",
        lease: { id: "expired", acquiredAt: 90, expiresAt: 99 },
      });
      if (cancelling) await transition({ kind: "cancel-requested", at: 95 });
      const delivery = { body: jobs[0]!, ack: vi.fn(), retry: vi.fn() };
      await consumeSimulationJobs({ messages: [delivery] }, env, runtime);
      expect(execute).not.toHaveBeenCalled();
      expect(delivery.retry).not.toHaveBeenCalled();
      expect(delivery.ack).toHaveBeenCalledOnce();
      const response = await routeManagedSimulationRequest(
        new Request(`https://canvas.test/api/simulation/runs/${runId}`),
        env,
        runtime,
      );
      expect(await response!.json()).toMatchObject({
        run: {
          state: "infrastructure-failed",
          error: { code: "RUN_LEASE_EXPIRED", recovery: "not-retryable" },
        },
      });
    },
  );

  it("keeps anonymous preview runs usable with an opaque session cookie", async () => {
    const { env } = harness();
    const started = await routeManagedSimulationRequest(startRequest(), env);
    expect(started?.status).toBe(202);
    const cookie = started?.headers.get("set-cookie");
    expect(cookie).toContain("icm_simulation_session=");
    const runId = ((await started!.json()) as { run: { id: string } }).run.id;
    const read = await routeManagedSimulationRequest(
      new Request(`https://canvas.test/api/simulation/runs/${runId}`, {
        headers: { cookie: cookie!.split(";")[0]! },
      }),
      env,
    );
    expect(read?.status).toBe(200);
  });

  it("requires a principal before accepting computation", async () => {
    const { env } = harness();
    const response = await routeManagedSimulationRequest(startRequest(), env, {
      principalOf: async () => null,
      now: () => 100,
      uuid: () => "unused",
    });
    expect(response?.status).toBe(401);
  });

  it("exposes drain and state counts only to administrators", async () => {
    const { env, runtime } = harness();
    const denied = await routeManagedSimulationRequest(
      new Request("https://canvas.test/api/simulation/operations"),
      env,
      runtime,
    );
    expect(denied?.status).toBe(403);
    const adminRuntime = {
      ...runtime,
      principalOf: async () => ({
        id: "admin-a",
        displayName: "Admin",
        email: "admin@example.test",
        provider: "test",
        role: "user",
        isAdmin: true,
      }),
    };
    const drained = await routeManagedSimulationRequest(
      new Request("https://canvas.test/api/simulation/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accepting: false }),
      }),
      env,
      adminRuntime,
    );
    expect(drained?.status).toBe(200);
    expect(await drained!.json()).toMatchObject({ accepting: false });
  });

  it("persists input, queues once, and finishes independently of a browser", async () => {
    const { bucket, env, jobs, runtime } = harness();
    const started = await routeManagedSimulationRequest(
      startRequest(),
      env,
      runtime,
    );
    expect(started?.status).toBe(202);
    const startBody = (await started!.json()) as {
      run: { id: string; state: string };
    };
    expect(startBody.run.state).toBe("queued");
    expect(jobs).toHaveLength(1);
    expect([...bucket.objects.keys()]).toEqual([
      expect.stringMatching(/^simulation-inputs\/user-a\/[a-f0-9]{64}\.json$/u),
    ]);
    expect(jobs[0]).toEqual({ schemaVersion: 1, runId: startBody.run.id });

    const delivery: SimulationQueueMessage<SimulationJobMessage> = {
      body: jobs[0]!,
      ack: () => undefined,
      retry: () => {
        throw new Error("successful run must not retry");
      },
    };
    await consumeSimulationJobs({ messages: [delivery] }, env, runtime);

    const read = await routeManagedSimulationRequest(
      new Request(
        `https://canvas.test/api/simulation/runs/${startBody.run.id}`,
      ),
      env,
      runtime,
    );
    expect(read?.status).toBe(200);
    expect(await read!.json()).toMatchObject({
      run: {
        id: startBody.run.id,
        state: "succeeded",
        attempt: 1,
        artifacts: [{ name: "managed-input.json" }, { name: "response.json" }],
      },
    });
    const result = await routeManagedSimulationRequest(
      new Request(
        `https://canvas.test/api/simulation/runs/${startBody.run.id}/result`,
      ),
      env,
      runtime,
    );
    expect(result?.status).toBe(200);
    expect(await result!.json()).toMatchObject({
      outcome: { status: "completed" },
      metadata: { input: { inputRevision: "revision-a" } },
    });
  });

  it("requeues infrastructure refusal under the same run", async () => {
    const { env, jobs, runtime } = harness();
    env.VACASK = {
      getByName: () => ({
        fetch: async (url) =>
          new URL(url).pathname === "/health"
            ? Response.json(nativeHealth)
            : Response.json(
                { error: "simulator-busy", message: "one circuit at a time" },
                { status: 503 },
              ),
      }),
    };
    const started = await routeManagedSimulationRequest(
      startRequest(),
      env,
      runtime,
    );
    const runId = ((await started!.json()) as { run: { id: string } }).run.id;
    let retried = false;
    await consumeSimulationJobs(
      {
        messages: [
          {
            body: jobs[0]!,
            ack: () => {
              throw new Error("busy run must not be acknowledged");
            },
            retry: () => {
              retried = true;
            },
          },
        ],
      },
      env,
      runtime,
    );
    expect(retried).toBe(true);
    const response = await routeManagedSimulationRequest(
      new Request(`https://canvas.test/api/simulation/runs/${runId}`),
      env,
      runtime,
    );
    expect(await response!.json()).toMatchObject({
      run: { state: "queued", attempt: 1 },
    });
  });
});
