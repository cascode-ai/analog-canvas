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
function harness(publicProject = circuit("Public")) {
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
              previewRevision: "rev-1",
            },
            projectText: serializeProject(publicProject),
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
  it("shows no candidate for a circuit with no close relative, as the browser check does (#1443)", async () => {
    // Six resistors share one device with the source's one: comparable,
    // far from close.
    const unrelated = circuit("Public ladder");
    const resistor = unrelated.documents[0]!.instances[0]!;
    unrelated.documents[0]!.instances = Array.from({ length: 6 }, (_, n) => ({
      ...resistor,
      id: `R${n + 1}`,
      reference: `R${n + 1}`,
    }));
    unrelated.documents[0]!.nets = Array.from({ length: 7 }, (_, n) => ({
      id: `net-${n}`,
      terminals: [
        ...(n > 0 ? [{ instanceId: `R${n}`, pinName: "2" }] : []),
        ...(n < 6 ? [{ instanceId: `R${n + 1}`, pinName: "1" }] : []),
      ],
    }));
    const h = harness(unrelated);
    const object = h.create();
    await start(object);
    for (let run = 0; run < 3; run++) await object.alarm();
    expect((await read(object)).job.report).toMatchObject({
      complete: true,
      comparable: 7,
      exactMatches: 0,
      matches: [],
      omittedMatches: 0,
    });
  });
  it("shows three close candidates and counts the rest as omitted (#1443)", async () => {
    // Two resistors in series against the source's one: close, not exact.
    const pair = circuit("Public pair");
    const resistor = pair.documents[0]!.instances[0]!;
    pair.documents[0]!.instances = [
      resistor,
      { ...resistor, id: "R2", reference: "R2" },
    ];
    pair.documents[0]!.nets = [
      { id: "a", terminals: [{ instanceId: "R1", pinName: "1" }] },
      {
        id: "mid",
        terminals: [
          { instanceId: "R1", pinName: "2" },
          { instanceId: "R2", pinName: "1" },
        ],
      },
      { id: "b", terminals: [{ instanceId: "R2", pinName: "2" }] },
    ];
    const object = harness(pair).create();
    await start(object);
    for (let run = 0; run < 3; run++) await object.alarm();
    const { report } = (await read(object)).job;
    expect(report).toMatchObject({ complete: true, exactMatches: 0 });
    expect(report.matches).toHaveLength(3);
    expect(report.omittedMatches).toBe(4);
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
  it("keeps each account's check private, refuses signed-out and cross-origin starts", async () => {
    const objects = new Map<string, TopologyTaskDO>();
    const h = harness();
    const env = {
      ...h.env,
      // The session cookie names its account; any other cookie is no one.
      AUTH: {
        getByName: () => ({
          fetch: async (_input: Request | string, init?: RequestInit) => {
            const cookie = new Headers(init?.headers).get("cookie") ?? "";
            const id = /icm_session=(\w+)/u.exec(cookie)?.[1];
            return Response.json({
              user: id ? { id, displayName: id, isAdmin: false } : null,
            });
          },
        }),
      },
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
      account?: string,
      origin = "https://canvas.test",
    ) =>
      new Request("https://canvas.test/api/topology-task", {
        method,
        headers: {
          Origin: origin,
          ...(account ? { Cookie: `icm_session=${account}` } : {}),
        },
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                id: "job-12345678",
                projectText: serializeProject(circuit()),
              }),
            }
          : {}),
      });
    const route = (input: Request) =>
      routeTopologyTaskRequest(input, env) as Promise<Response>;
    expect(
      (await route(request("POST", "ada", "https://other.test"))).status,
    ).toBe(403);
    // Signed out, no check starts and a read finds none.
    const refused = await route(request("POST"));
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "sign-in-required" });
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect(await (await route(request("GET"))).json()).toEqual({ job: null });
    const created = await route(request("POST", "ada"));
    expect(created.status).toBe(200);
    expect(created.headers.get("cache-control")).toContain("no-store");
    expect(
      (await (await route(request("GET", "ada"))).json()).job.projectText,
    ).toContain("Frozen source");
    expect(await (await route(request("GET", "bob"))).json()).toEqual({
      job: null,
    });
    expect([...objects.keys()]).toEqual(["user:ada", "user:bob"]);
  });

  it("names the circuits it matched without handing out their drawings", async () => {
    const h = harness(),
      object = h.create();
    await start(object);
    for (let tick = 0; tick < 3; tick += 1) await object.alarm();
    const { job } = await read(object);
    expect(job.report.matches.length).toBeGreaterThan(0);
    for (const match of job.report.matches) {
      expect(match).not.toHaveProperty("candidate");
      expect(match.entry.previewRevision).toBe("rev-1");
    }
  });
});
