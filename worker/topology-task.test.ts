import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { TopologyTaskDO, routeTopologyTaskRequest } from "./topology-task";

function circuit(name = "Frozen source") {
  const project = createEmptyProject("source", name);
  project.documents[0]!.instances = [
    {
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    },
  ];
  project.documents[0]!.nets = ["1", "2"].map((pinName) => ({
    id: `net-${pinName}`,
    terminals: [{ instanceId: "R1", pinName }],
  }));
  return project;
}
function harness() {
  const database = new DatabaseSync(":memory:");
  let time = 1_000_000;
  let alarm: number | null = null;
  let fail = false;
  const state = {
    storage: {
      sql: {
        exec<T>(query: string, ...values: unknown[]) {
          const rows = database
            .prepare(query)
            .all(...(values as (string | number | null)[])) as T[];
          return { toArray: () => rows };
        },
      },
      transactionSync<T>(callback: () => T): T {
        database.exec("BEGIN");
        try {
          const value = callback();
          database.exec("COMMIT");
          return value;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      },
      async setAlarm(value: number) {
        alarm = value;
      },
      async deleteAlarm() {
        alarm = null;
      },
    },
  };
  const entries = Array.from({ length: 7 }, (_, n) => `public-${n}`);
  const env = {
    GALLERY: {
      getByName: () => ({
        fetch: async (input: string, init?: RequestInit) => {
          if (fail) return new Response(null, { status: 503 });
          if (input.endsWith("/topology-inventory"))
            return Response.json({ ids: entries });
          const { id } = JSON.parse(init!.body as string);
          return Response.json({
            status: "public",
            entry: {
              id,
              name: "Public resistor",
              author: "Maker",
              createdAt: "2026-09-21",
              schemaVersion: 1,
            },
            projectText: serializeProject(circuit("Public")),
          });
        },
      }),
    },
  };
  const create = () => new TopologyTaskDO(state, env, () => time);
  return {
    create,
    env,
    state,
    advance: (ms: number) => {
      time += ms;
    },
    alarm: () => alarm,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
const start = (
  object: TopologyTaskDO,
  name = "Frozen source",
  id = "job-12345678",
) =>
  object.fetch(
    new Request("https://job/", {
      method: "POST",
      body: JSON.stringify({
        id,
        projectText: serializeProject(circuit(name)),
      }),
    }),
  );
const read = async (object: TopologyTaskDO) =>
  (await object.fetch(new Request("https://job/"))).json();

describe("durable topology tasks", () => {
  it("checkpoints without a browser, resumes after object eviction, and retains the clicked snapshot", async () => {
    const h = harness();
    let object = h.create();
    expect((await start(object)).status).toBe(200);
    expect((await read(object)).job.report.sourceError).toBeUndefined();
    expect(h.alarm()).not.toBeNull();
    await object.alarm();
    expect((await read(object)).job.report.scanned).toBe(3);
    // The same POST is idempotent; another tab cannot replace a running check.
    expect((await start(object)).status).toBe(200);
    expect((await start(object, "New", "job-other123")).status).toBe(409);
    object = h.create();
    await object.alarm();
    await object.alarm();
    const result = (await read(object)).job;
    expect(result).toMatchObject({
      running: false,
      report: {
        scanned: 7,
        total: 7,
        comparable: 7,
        complete: true,
        exactMatches: 7,
      },
    });
    expect(result.projectText).toContain("Frozen source");
    expect(result.report.matches[0].pairs).toHaveLength(1);
    expect(
      await (
        await object.fetch(
          new Request(
            `https://job/?id=${result.id}&revision=${result.revision}`,
          ),
        )
      ).json(),
    ).toEqual({ unchanged: true });
    await object.fetch(
      new Request(`https://job/?id=${result.id}`, { method: "PATCH" }),
    );
    expect((await read(h.create())).job.dismissed).toBe(true);
    h.advance(8 * 24 * 60 * 60_000);
    await object.alarm();
    expect((await read(object)).job).toBeNull();
  });
  it("preserves Unicode snapshots across SQLite chunk boundaries", async () => {
    const h = harness(),
      object = h.create();
    const name = "😅".repeat(80_000);
    expect((await start(object, name)).status).toBe(200);
    const snapshot = parseProject((await read(h.create())).job.projectText);
    expect(snapshot.name.length).toBe(name.length);
    expect(snapshot.name.includes("�")).toBe(false);
  });

  it("retries transient failures from the last checkpoint and cancels durably", async () => {
    const h = harness(),
      object = h.create();
    await start(object);
    await object.alarm();
    h.fail(true);
    await object.alarm();
    expect((await read(object)).job).toMatchObject({
      running: true,
      report: { scanned: 3 },
    });
    h.fail(false);
    await h.create().alarm();
    expect((await read(object)).job.report.scanned).toBe(6);
    expect(
      (
        await object.fetch(
          new Request("https://job/?id=wrong", { method: "DELETE" }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await object.fetch(
          new Request("https://job/?id=job-12345678", { method: "DELETE" }),
        )
      ).status,
    ).toBe(200);
    await h.create().alarm();
    expect((await read(object)).job).toMatchObject({
      running: false,
      report: { scanned: 6, complete: false },
    });
  });
  it("isolates anonymous browser jobs, refuses cross-origin starts and never makes sources public", async () => {
    const objects = new Map<string, TopologyTaskDO>();
    const h = harness();
    const env = {
      ...h.env,
      TOPOLOGY_TASK: {
        getByName(name: string) {
          if (!objects.has(name)) objects.set(name, harness().create());
          return {
            fetch: (input: string, init?: RequestInit) =>
              objects.get(name)!.fetch(new Request(input, init)),
          };
        },
      },
    };
    const request = (
      method: string,
      cookie?: string,
      origin = "https://canvas.test",
    ) =>
      new Request("https://canvas.test/api/topology-task", {
        method,
        headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                id: "job-12345678",
                projectText: serializeProject(circuit()),
              }),
            }
          : {}),
      });
    expect(
      (await routeTopologyTaskRequest(
        request("POST", undefined, "https://other.test"),
        env,
      ))!.status,
    ).toBe(403);
    const created = (await routeTopologyTaskRequest(request("POST"), env))!;
    const cookie = created.headers.get("set-cookie")!.split(";")[0]!;
    expect(created.headers.get("set-cookie")).toContain("HttpOnly");
    expect(created.headers.get("cache-control")).toContain("no-store");
    expect(
      (
        await (await routeTopologyTaskRequest(
          request("GET", cookie),
          env,
        ))!.json()
      ).job.projectText,
    ).toContain("Frozen source");
    expect(
      await (await routeTopologyTaskRequest(request("GET"), env))!.json(),
    ).toEqual({ job: null });
  });
});
