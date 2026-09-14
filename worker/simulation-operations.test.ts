import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

import {
  buildSimulationDeck,
  createSimulationEnvironmentMetadata,
} from "@icm/spice-run";
import hostedSky130Profile from "../containers/ngspice/hosted-sky130-profile.json";

import { SimulationControlDO } from "./simulation-control-do";
import {
  consumeSimulationJobs,
  routeManagedSimulationRequest,
  type SimulationArtifactBucket,
  type SimulationJobMessage,
  type SimulationOperationsEnv,
  type SimulationQueueMessage,
} from "./simulation-operations";

function sqliteState() {
  const db = new DatabaseSync(":memory:");
  return {
    storage: {
      sql: {
        exec<T>(query: string, ...bindings: unknown[]) {
          const statement = db.prepare(query);
          if (/^\s*(select|with|pragma)/iu.test(query)) {
            const rows = statement.all(
              ...(bindings as (string | number | null)[]),
            ) as T[];
            return {
              toArray: () => rows,
              one: () => {
                if (rows.length !== 1) throw new Error("expected one row");
                return rows[0]!;
              },
            };
          }
          statement.run(...(bindings as (string | number | null)[]));
          return {
            toArray: () => [] as T[],
            one: () => {
              throw new Error("no rows");
            },
          };
        },
      },
      transactionSync<T>(callback: () => T): T {
        return callback();
      },
    },
  };
}

class MemoryBucket implements SimulationArtifactBucket {
  readonly objects = new Map<string, string>();
  async get(key: string) {
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value };
  }
  async put(key: string, value: string) {
    this.objects.set(key, value);
    return {};
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

const environment = await createSimulationEnvironmentMetadata({
  executor: "hosted-container",
  reproducibility: "observed",
  profileId: null,
  platform: "linux/x64",
  simulator: {
    name: "ngspice",
    version: "ngspice-47",
    binarySha256:
      "22d5cae2bd32b2e39157a8d27bf457122f68285b72a9ebefdf41551b628233ab",
  },
  models: {
    id: "sky130A",
    contentSha256:
      "17c208a699228f5acb87bf59c09c22a4c4d3937b6766b4957737d34e8e075f64",
  },
  startupSha256: null,
});

function harness() {
  const control = new SimulationControlDO(sqliteState(), undefined, () => 100);
  const bucket = new MemoryBucket();
  const jobs: SimulationJobMessage[] = [];
  const env: SimulationOperationsEnv = {
    SIMULATION_CONTROL: {
      getByName: () => ({
        fetch: (input, init) => control.fetch(new Request(input, init)),
      }),
    },
    SIMULATION_ARTIFACTS: bucket,
    SIMULATION_JOBS: {
      async send(message) {
        jobs.push(message);
      },
    },
    NGSPICE: {
      getByName: () => ({
        fetch: async () =>
          Response.json({
            environment,
            log: "Circuit: * divider\nv(in) = 1\n",
            exitCode: 0,
            timedOut: false,
            durationMs: 5,
          }),
      }),
    },
  };
  const principal = {
    id: "user-a",
    displayName: "User A",
    email: "a@example.test",
    provider: "test",
    role: "user",
    isAdmin: false,
  };
  const runtime = {
    principalOf: async () => principal,
    now: () => 100,
    uuid: () => "lease-a",
  };
  return { bucket, control, env, jobs, runtime };
}

function startRequest() {
  const netlist = "R1 in 0 1k";
  const testbench = "V1 in 0 1\n.op";
  return new Request("https://canvas.test/api/simulation/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "request-a",
      preparedId: "prepared-a",
      preparedDigest: "a".repeat(64),
      input: {
        mode: "structured",
        environment: {
          profileId: hostedSky130Profile.id,
          corner: "tt",
        },
        files: [],
        dependencies: [],
        netlist,
        testbench,
        preparedDeck: buildSimulationDeck({ netlist, testbench }, null),
        inputRevision: "revision-a",
      },
    }),
  });
}

describe("managed simulation operations", () => {
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
    env.NGSPICE = { getByName: () => ({ fetch: execute }) };
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
    const original = env.NGSPICE!.getByName("test");
    const execute = vi.fn(original.fetch);
    env.NGSPICE = { getByName: () => ({ fetch: execute }) };
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
      const original = env.NGSPICE!.getByName("test");
      const execute = vi.fn(async (url: string, init?: RequestInit) => {
        if (failure === "lost-response")
          throw new Error("response lost after admission");
        if (failure === "invalid-response") return new Response("broken JSON");
        return original.fetch(url, init);
      });
      env.NGSPICE = { getByName: () => ({ fetch: execute }) };
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
      env.NGSPICE = { getByName: () => ({ fetch: execute }) };
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
    env.NGSPICE = {
      getByName: () => ({
        fetch: async () =>
          Response.json(
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
