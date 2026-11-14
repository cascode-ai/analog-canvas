import { afterEach, describe, expect, it, vi } from "vitest";
import { accounts, transportOrigin } from "./regional-auth.test-support";
import {
  ORIGIN,
  ownerAccountOf,
  makerOf,
  sqliteState,
  wiredProjectText,
} from "./gallery.test-support";
import { TopologyTaskDO, routeTopologyTaskRequest } from "./topology-task";
import { createSimulationOperationsHarness } from "./simulation-operations.test-fixture";
import { routeManagedSimulationRequest } from "./simulation-operations";
import {
  nativeInput,
  nativeStreamingReply,
  nativeWorkerEnv,
} from "./simulation.test-fixture";

afterEach(() => vi.unstubAllGlobals());

async function pair(options: { legacy?: boolean } = {}) {
  const auth = accounts();
  const cookie = await ownerAccountOf(auth.source);
  const cnCookie = await auth.connect(cookie);
  const make = (region: "cn" | "overseas") => {
    const h = createSimulationOperationsHarness("alarm");
    const env = {
      ...h.env,
      ...(region === "cn" ? auth.resources : auth.source),
      RESOURCE_REGION: options.legacy ? "" : region,
      RESOURCE_ACTION_PEER: options.legacy
        ? ""
        : region === "cn"
          ? transportOrigin
          : "https://china.test",
    };
    let alarmPause: (() => Promise<void>) | undefined;
    const tasks = new Map<string, TopologyTaskDO>();
    const topology = {
      ...env,
      TOPOLOGY_TASK: {
        getByName: (name: string) => ({
          fetch: (input: string, init?: RequestInit) => {
            if (!tasks.has(name))
              tasks.set(
                name,
                new TopologyTaskDO(
                  {
                    storage: {
                      ...sqliteState().storage,
                      setAlarm: async () => {
                        await alarmPause?.();
                      },
                      deleteAlarm: async () => {},
                    },
                  },
                  env,
                ),
              );
            return tasks.get(name)!.fetch(new Request(input, init));
          },
        }),
      },
    };
    const route = async (request: Request) =>
      (await routeTopologyTaskRequest(request, topology)) ??
      (await routeManagedSimulationRequest(request, env)) ??
      new Response(null, { status: 404 });
    const call = (path: string, method = "GET", body?: unknown) =>
      route(
        new Request(ORIGIN + path, {
          method,
          headers: {
            origin: ORIGIN,
            cookie: region === "cn" ? cnCookie : cookie,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    return {
      ...h,
      executionEnv: h.env,
      env,
      route,
      call,
      enableRouting() {
        env.RESOURCE_REGION = region;
        topology.RESOURCE_REGION = region;
        env.RESOURCE_ACTION_PEER =
          region === "cn" ? transportOrigin : "https://china.test";
        topology.RESOURCE_ACTION_PEER = env.RESOURCE_ACTION_PEER;
      },
      removePeer() {
        env.RESOURCE_ACTION_PEER = "";
        topology.RESOURCE_ACTION_PEER = "";
      },
      pauseAdmission() {
        let release!: () => void,
          reached!: () => void,
          arrivals = 0;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const waiting = new Promise<void>((resolve) => {
          reached = resolve;
        });
        alarmPause = async () => {
          if (++arrivals === 1) reached();
          await gate;
        };
        return {
          waiting,
          release: () => {
            alarmPause = undefined;
            release();
          },
        };
      },
    };
  };
  const cn = make("cn"),
    overseas = make("overseas");
  let offline = false,
    loseAction = "";
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init),
        url = new URL(request.url);
      if (url.pathname.startsWith("/api/auth/"))
        return auth.source.authDurable.fetch(request);
      if (offline) throw new Error("Peer unreachable");
      const action = (await request.clone().json()).action;
      const response = await (
        url.origin === transportOrigin ? overseas : cn
      ).route(request);
      if (action === loseAction && response.ok) {
        loseAction = "";
        throw new Error("Reply lost after commit");
      }
      return response;
    },
  );
  return {
    cn,
    overseas,
    auth,
    cookie,
    offline: (value: boolean) => {
      offline = value;
    },
    loseReply: (action: string) => {
      loseAction = action;
    },
  };
}

const startBody = () => ({
  requestId: "same-intent",
  preparedId: "prepared",
  preparedDigest: "a".repeat(64),
  input: nativeInput(),
});

describe("regional managed jobs", () => {
  it("fails closed when a regional deployment is missing its peer configuration", async () => {
    const { cn, overseas } = await pair();
    try {
      cn.removePeer();
      expect(
        (await cn.call("/api/simulation/runs", "POST", startBody())).status,
      ).toBe(503);
      expect(
        (
          await cn.call("/api/topology-task", "POST", {
            id: "missing-peer-job",
            projectText: wiredProjectText(),
          })
        ).status,
      ).toBe(503);
    } finally {
      cn.close();
      overseas.close();
    }
  });
  it("keeps an established local topology task usable without a cross-border poll", async () => {
    const h = await pair();
    try {
      const id = "local-during-peer-outage";
      expect(
        (
          await h.cn.call("/api/topology-task", "POST", {
            id,
            projectText: wiredProjectText(),
          })
        ).status,
      ).toBe(200);
      h.offline(true);
      expect((await h.cn.call("/api/topology-task")).status).toBe(200);
      expect(
        (await h.cn.call("/api/topology-task?id=" + id, "DELETE")).status,
      ).toBe(200);
      expect((await h.overseas.call("/api/topology-task")).status).toBe(503);
    } finally {
      h.cn.close();
      h.overseas.close();
    }
  });
  it("does not let a cross-site request turn a browser session into a peer start command", async () => {
    const { cn, overseas, cookie } = await pair();
    try {
      const response = await overseas.route(
        new Request(ORIGIN + "/api/simulation/runs", {
          method: "POST",
          headers: {
            cookie,
            origin: "https://untrusted.test",
            "sec-fetch-site": "cross-site",
          },
          body: JSON.stringify(startBody()),
        }),
      );
      expect(response.status).toBe(403);
    } finally {
      cn.close();
      overseas.close();
    }
  });
  it("reserves one execution for simultaneous opposite-entry retries", async () => {
    const { cn, overseas } = await pair();
    try {
      const results = await Promise.all([
        cn.call("/api/simulation/runs", "POST", startBody()),
        overseas.call("/api/simulation/runs", "POST", startBody()),
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([
        200, 202,
      ]);
      const records = await Promise.all(
        results.map((response) => response.json()),
      );
      expect(records[0].run.id).toBe(records[1].run.id);
      expect(
        (await (await cn.call("/api/simulation/runs")).json()).runs,
      ).toHaveLength(1);
    } finally {
      cn.close();
      overseas.close();
    }
  });
  it("preserves conflicting legacy topology jobs and still allows stopping either by ID", async () => {
    const { cn, overseas } = await pair({ legacy: true });
    try {
      const body = { projectText: wiredProjectText() };
      await cn.call("/api/topology-task", "POST", {
        ...body,
        id: "legacy-china-job",
      });
      await overseas.call("/api/topology-task", "POST", {
        ...body,
        id: "legacy-overseas-job",
      });
      cn.enableRouting();
      overseas.enableRouting();
      const conflict = await cn.call("/api/topology-task");
      expect(conflict.status).toBe(409);
      expect(
        (await conflict.json()).jobs
          .map((job: { id: string }) => job.id)
          .sort(),
      ).toEqual(["legacy-china-job", "legacy-overseas-job"]);
      expect(
        (
          await overseas.call(
            "/api/topology-task?id=legacy-china-job",
            "DELETE",
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await (
            await cn.call("/api/topology-task?id=legacy-overseas-job")
          ).json()
        ).job,
      ).toMatchObject({ id: "legacy-overseas-job", running: true });
    } finally {
      cn.close();
      overseas.close();
    }
  });
  it("keeps legacy tasks reachable and adopts their execution region before a retry", async () => {
    const { cn, overseas } = await pair({ legacy: true });
    try {
      const original = await cn.call(
        "/api/simulation/runs",
        "POST",
        startBody(),
      );
      const id = (await original.json()).run.id;
      const task = {
        id: "legacy-topology-job",
        projectText: wiredProjectText(),
      };
      expect((await cn.call("/api/topology-task", "POST", task)).status).toBe(
        200,
      );
      cn.enableRouting();
      overseas.enableRouting();
      const retried = await overseas.call(
        "/api/simulation/runs",
        "POST",
        startBody(),
      );
      expect(retried.status).toBe(200);
      expect((await retried.json()).run.id).toBe(id);
      expect(
        (await (await overseas.call("/api/topology-task")).json()).job.id,
      ).toBe(task.id);
    } finally {
      cn.close();
      overseas.close();
    }
  });
  it("retains a reservation after its acknowledgement is lost, and refuses incomplete lists or new work during peer loss", async () => {
    const h = await pair();
    try {
      h.loseReply("reserve");
      expect(
        (await h.cn.call("/api/simulation/runs", "POST", startBody())).status,
      ).toBe(503);
      const retry = await h.overseas.call(
        "/api/simulation/runs",
        "POST",
        startBody(),
      );
      expect(retry.status).toBe(202);
      const id = (await retry.json()).run.id;
      h.offline(true);
      expect((await h.cn.call(`/api/simulation/runs/${id}`)).status).toBe(200);
      expect((await h.cn.call("/api/simulation/runs")).status).toBe(503);
      expect(
        (
          await h.overseas.call("/api/simulation/runs", "POST", {
            ...startBody(),
            requestId: "offline-start",
          })
        ).status,
      ).toBe(503);
      expect(
        (
          await h.cn.call("/api/topology-task", "POST", {
            id: "offline-topology",
            projectText: wiredProjectText(),
          })
        ).status,
      ).toBe(503);
      h.offline(false);
      expect(
        (await (await h.cn.call("/api/simulation/runs")).json()).runs.map(
          (run: { id: string }) => run.id,
        ),
      ).toEqual([id]);
      expect(
        (await (await h.cn.call("/api/topology-task")).json()).job,
      ).toBeNull();
    } finally {
      h.cn.close();
      h.overseas.close();
    }
  });
  it("streams the original result across entries and keeps another account and forged peer commands out", async () => {
    const { cn, overseas, auth } = await pair();
    try {
      cn.executionEnv.VACASK = nativeWorkerEnv(async (_url, init) =>
        nativeStreamingReply(JSON.parse(String(init?.body)), false),
      ).VACASK;
      const started = await cn.call(
        "/api/simulation/runs",
        "POST",
        startBody(),
      );
      const id = (await started.json()).run.id;
      const queued = await overseas.call(`/api/simulation/runs/${id}/result`);
      expect(queued.status).toBe(409);
      expect((await queued.json()).error).toBe("RESULT_NOT_READY");
      const stranger = await makerOf(auth.source);
      const denied = await overseas.route(
        new Request(ORIGIN + `/api/simulation/runs/${id}/cancel`, {
          method: "POST",
          headers: { cookie: stranger, origin: ORIGIN },
        }),
      );
      expect(denied.status).toBe(404);
      const forged = await cn.route(
        new Request(ORIGIN + "/api/resource-actions/simulation-job", {
          method: "POST",
          headers: { authorization: "Bearer forged" },
          body: JSON.stringify({
            action: "local",
            method: "POST",
            path: `/api/simulation/runs/${id}/cancel`,
            body: null,
            target: "cn",
          }),
        }),
      );
      expect(forged.status).toBe(401);
      expect(
        (await (await cn.call(`/api/simulation/runs/${id}`)).json()).run.state,
      ).toBe("queued");
      await cn.control.alarm();
      const result = await overseas.call(`/api/simulation/runs/${id}/result`);
      expect(result.status).toBe(200);
      expect((await result.json()).outcome.status).toBe("completed");
    } finally {
      cn.close();
      overseas.close();
    }
  });
  it("admits only one of concurrent topology starts for an account", async () => {
    const { cn, overseas } = await pair();
    try {
      const body = { projectText: wiredProjectText() };
      const results = await Promise.all([
        cn.call("/api/topology-task", "POST", {
          ...body,
          id: "concurrent-job-one",
        }),
        cn.call("/api/topology-task", "POST", {
          ...body,
          id: "concurrent-job-two",
        }),
        overseas.call("/api/topology-task", "POST", {
          ...body,
          id: "concurrent-job-three",
        }),
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([
        200, 409, 409,
      ]);
    } finally {
      cn.close();
      overseas.close();
    }
  });
  it("does not replace an accepted topology snapshot while alarm storage is delayed", async () => {
    const { cn, overseas } = await pair();
    try {
      // Establish the account route without accepting a job.
      expect(
        (
          await cn.call("/api/topology-task", "POST", {
            id: "invalid-job-123",
            projectText: "invalid",
          })
        ).status,
      ).toBe(400);
      const delay = cn.pauseAdmission();
      const first = cn.call("/api/topology-task", "POST", {
        id: "delayed-job-one",
        projectText: wiredProjectText(),
      });
      const second = overseas.call("/api/topology-task", "POST", {
        id: "delayed-job-two",
        projectText: wiredProjectText(),
      });
      await delay.waiting;
      delay.release();
      expect(
        (await Promise.all([first, second]))
          .map((response) => response.status)
          .sort(),
      ).toEqual([200, 409]);
    } finally {
      cn.close();
      overseas.close();
    }
  });
  it("keeps the same account topology task across entries, including retry, cancellation and dismissal", async () => {
    const { cn, overseas } = await pair();
    try {
      const body = { id: "topology-job-123", projectText: wiredProjectText() };
      expect((await cn.call("/api/topology-task", "POST", body)).status).toBe(
        200,
      );
      const other = await overseas.call("/api/topology-task");
      expect((await other.json()).job?.id).toBe(body.id);
      const retry = await overseas.call("/api/topology-task", "POST", body);
      expect((await retry.json()).job.id).toBe(body.id);
      expect(
        (
          await overseas.call("/api/topology-task", "POST", {
            ...body,
            id: "another-task-123",
          })
        ).status,
      ).toBe(409);
      expect(
        (await overseas.call("/api/topology-task?id=" + body.id, "DELETE"))
          .status,
      ).toBe(200);
      expect(
        (await overseas.call("/api/topology-task?id=" + body.id, "PATCH"))
          .status,
      ).toBe(200);
      expect(
        (await (await cn.call("/api/topology-task")).json()).job,
      ).toMatchObject({ id: body.id, running: false, dismissed: true });
    } finally {
      cn.close();
      overseas.close();
    }
  });
  it("keeps one run when the first acknowledgement is lost and the same request crosses entries", async () => {
    const { cn, overseas } = await pair();
    try {
      const accepted = await cn.call(
        "/api/simulation/runs",
        "POST",
        startBody(),
      );
      expect(accepted.status).toBe(202);
      const first = (await accepted.json()).run;
      const retry = await overseas.call(
        "/api/simulation/runs",
        "POST",
        startBody(),
      );
      expect(retry.status).toBe(200);
      expect((await retry.json()).run.id).toBe(first.id);
      const list = await overseas.call("/api/simulation/runs");
      expect(
        (await list.json()).runs.map((run: { id: string }) => run.id),
      ).toEqual([first.id]);
      const changed = await overseas.call("/api/simulation/runs", "POST", {
        ...startBody(),
        preparedId: "different-input",
      });
      expect(changed.status).toBe(409);
    } finally {
      cn.close();
      overseas.close();
    }
  });
  it("reads and cancels a simulation from the other entry without duplicating its execution", async () => {
    const { cn, overseas } = await pair();
    try {
      const started = await cn.call(
        "/api/simulation/runs",
        "POST",
        startBody(),
      );
      expect(started.status).toBe(202);
      const { run } = await started.json();
      const elsewhere = await overseas.call(`/api/simulation/runs/${run.id}`);
      expect(elsewhere.status).toBe(200);
      expect((await elsewhere.json()).run.id).toBe(run.id);
      const cancel = await overseas.call(
        `/api/simulation/runs/${run.id}/cancel`,
        "POST",
      );
      expect(cancel.status).toBe(200);
      expect((await cancel.json()).run.state).toBe("cancelled");
      expect(
        (await (await cn.call(`/api/simulation/runs/${run.id}`)).json()).run
          .state,
      ).toBe("cancelled");
    } finally {
      cn.close();
      overseas.close();
    }
  });
});
