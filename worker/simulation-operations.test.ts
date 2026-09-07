import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

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
  it("requires a principal before accepting computation", async () => {
    const { env } = harness();
    const response = await routeManagedSimulationRequest(startRequest(), env, {
      principalOf: async () => null,
      now: () => 100,
      uuid: () => "unused",
    });
    expect(response?.status).toBe(401);
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
