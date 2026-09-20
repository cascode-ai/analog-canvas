import { DatabaseSync } from "node:sqlite";
import { nativeWorkerEnv } from "./simulation.test-fixture";
import { SimulationControlDO } from "./simulation-control-do";
import type {
  SimulationArtifactBucket,
  SimulationArtifactObject,
  SimulationJobMessage,
  SimulationOperationsEnv,
} from "./simulation-operations";

// Real control/state-machine implementation and SQLite. Queue delivery and
// object storage are in-memory test adapters, not Cloudflare qualification.
function sqliteState() {
  const db = new DatabaseSync(":memory:");
  return {
    close: () => db.close(),
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
  async get(key: string): Promise<SimulationArtifactObject | null> {
    const value = this.objects.get(key);
    return value === undefined
      ? null
      : { body: new Blob([value]).stream(), text: async () => value };
  }
  async put(
    key: string,
    value: string | ReadableStream<Uint8Array>,
    options?: { sha256?: string },
  ) {
    const text =
      typeof value === "string" ? value : await new Response(value).text();
    if (options?.sha256) {
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      if (digest !== options.sha256) throw new Error("R2 digest mismatch");
    }
    this.objects.set(key, text);
    return {};
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

export function createSimulationOperationsHarness() {
  const state = sqliteState();
  const control = new SimulationControlDO(state, undefined, () => 100);
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
    ...nativeWorkerEnv(),
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
  return { bucket, control, env, jobs, runtime, close: state.close };
}
