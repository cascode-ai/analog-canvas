import { afterEach, describe, expect, it, vi } from "vitest";
import { RegionalProjectDO } from "./regional-projects";
import { saveCloudProject } from "../apps/editor/src/features/editor-shell/cloud-projects";
import { parseProject } from "@icm/project-protocol";
import { GalleryDO } from "./gallery-do";
import {
  environment,
  makerOf,
  adminOf,
  route,
  saveRequest,
  sqliteState,
  ORIGIN,
  projectText,
} from "./gallery.test-support";

describe("regional private Projects over HTTP", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("retries a lost create response with the same key without consuming another project", async () => {
    const env = environment(),
      cookie = await makerOf(env);
    const store = new RegionalProjectDO(sqliteState(), {
      PROJECT_REGION: "overseas",
    });
    const regional = {
      ...env,
      PROJECTS: {
        getByName: () => ({
          fetch: (url: string, init?: RequestInit) =>
            store.fetch(new Request(url, init)),
        }),
      },
    };
    const create = () => {
      const req = saveRequest(cookie, "Retryable create");
      req.headers.set(
        "Idempotency-Key",
        "4bb23d26-4581-4f9d-8137-1b3dc8511a74",
      );
      return route(regional, req);
    };
    const first = await (await create()).json();
    const second = await (await create()).json();
    expect(second.project.id).toBe(first.project.id);
    expect(second.project.saveToken).toBe(first.project.saveToken);
    expect(second.project).not.toHaveProperty("projectText");
    const list = await (
      await route(
        regional,
        new Request(`${ORIGIN}/api/projects`, { headers: { Cookie: cookie } }),
      )
    ).json();
    expect(list.projects).toHaveLength(1);
  });
  it("fences restarted writes when the peer proves the restored local sequence is stale", async () => {
    const env = environment(),
      cookie = await makerOf(env),
      state = sqliteState();
    let store = new RegionalProjectDO(state, { PROJECT_REGION: "overseas" });
    const regional = {
      ...env,
      PROJECT_SYNC_TOKEN: "peer-secret",
      PROJECT_SYNC_ADMIN_TOKEN: "scheduler-secret",
      PROJECT_SYNC_PEER_URL: "https://cn.test",
      PROJECT_SYNC_PEER_TOKEN: "cn-secret",
      PROJECTS: {
        getByName: () => ({
          fetch: (url: string, init?: RequestInit) =>
            store.fetch(new Request(url, init)),
        }),
      },
    };
    expect(
      (await route(regional, saveRequest(cookie, "Acknowledged before backup")))
        .status,
    ).toBe(201);
    const before = await (
      await route(
        regional,
        new Request(`${ORIGIN}/api/project-sync/status`, {
          headers: { Authorization: "Bearer peer-secret" },
        }),
      )
    ).json();
    store = new RegionalProjectDO(state, { PROJECT_REGION: "overseas" });
    expect(
      (await route(regional, saveRequest(cookie, "Must wait for recovery")))
        .status,
    ).toBe(503);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          origin: "cn",
          epoch: "peer-epoch",
          sequence: 0,
          acknowledged: 0,
          received: {
            origin: "overseas",
            epoch: before.epoch,
            sequence: before.sequence + 1,
            hash: "higher-received-sequence",
          },
        }),
      ),
    );
    const tick = await route(
      regional,
      new Request(`${ORIGIN}/api/project-sync/run`, {
        method: "POST",
        headers: { Authorization: "Bearer scheduler-secret" },
      }),
    );
    expect((await tick.json()).status).toBe("blocked");
    expect(
      (await route(regional, saveRequest(cookie, "Still fenced"))).status,
    ).toBe(503);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) =>
        init?.method === "POST"
          ? Response.json({ epoch: before.epoch, acknowledged: 1 })
          : Response.json({
              origin: "cn",
              epoch: "peer-epoch",
              sequence: 0,
              received: null,
            }),
      ),
    );
    const resumed = await route(
      regional,
      new Request(`${ORIGIN}/api/project-sync/run`, {
        method: "POST",
        headers: { Authorization: "Bearer scheduler-secret" },
      }),
    );
    expect((await resumed.json()).status).toBe("blocked");
    const after = await (
      await route(
        regional,
        new Request(`${ORIGIN}/api/project-sync/status`, {
          headers: { Authorization: "Bearer peer-secret" },
        }),
      )
    ).json();
    expect(after).toMatchObject({
      fenced: true,
      pending: 1,
      delivery: { status: "blocked", retries: 2 },
    });
    expect(
      (
        await route(
          regional,
          saveRequest(cookie, "Peer cannot retract receipt"),
        )
      ).status,
    ).toBe(503);
  });
  it("refuses a save atomically when its durable replication journal has no capacity", async () => {
    const env = environment(),
      cookie = await makerOf(env);
    const store = new RegionalProjectDO(sqliteState(), {
      PROJECT_REGION: "overseas",
      PROJECT_SYNC_MAX_BYTES: 1,
    });
    const regional = {
      ...env,
      PROJECT_SYNC_TOKEN: "peer-secret",
      PROJECTS: {
        getByName: () => ({
          fetch: (url: string, init?: RequestInit) =>
            store.fetch(new Request(url, init)),
        }),
      },
    };
    expect(
      (await route(regional, saveRequest(cookie, "Cannot acknowledge"))).status,
    ).toBe(507);
    const list = await route(
      regional,
      new Request(`${ORIGIN}/api/projects`, { headers: { Cookie: cookie } }),
    );
    expect((await list.json()).projects).toEqual([]);
    const events = await route(
      regional,
      new Request(`${ORIGIN}/api/project-sync/events`, {
        headers: { Authorization: "Bearer peer-secret" },
      }),
    );
    expect((await events.json()).events).toEqual([]);
  });
  it("captures an existing source Project and its history before enabling regional saves", async () => {
    const env = environment(),
      cookie = await makerOf(env);
    const { project } = await (
      await route(env, saveRequest(cookie, "Before capture"))
    ).json();
    expect(
      (
        await route(
          env,
          new Request(`${ORIGIN}/api/projects/${project.id}`, {
            method: "PUT",
            headers: {
              Cookie: cookie,
              Origin: ORIGIN,
              "If-Match": "revision-1",
            },
            body: JSON.stringify({
              name: "Before activation",
              projectText: projectText("Before activation"),
            }),
          }),
        )
      ).status,
    ).toBe(200);
    const source = new GalleryDO(env.galleryStoreStates.get("gallery")!, {
      PROJECT_REGION: "overseas",
    });
    const regional = {
      ...env,
      PROJECT_SYNC_TOKEN: "peer-secret",
      PROJECTS: {
        getByName: () => ({
          fetch: (url: string, init?: RequestInit) =>
            source.fetch(new Request(url, init)),
        }),
      },
    };
    const opened = await route(
      regional,
      new Request(`${ORIGIN}/api/projects/${project.id}`, {
        headers: { Cookie: cookie },
      }),
    );
    expect((await opened.json()).project.saveToken).toMatch(/^head-/);
    const events = await (
      await route(
        regional,
        new Request(`${ORIGIN}/api/project-sync/events`, {
          headers: { Authorization: "Bearer peer-secret" },
        }),
      )
    ).json();
    expect(JSON.parse(events.events[0].payload).project.id).toBe(project.id);
    expect(JSON.parse(events.events[0].payload).versions[0].name).toBe(
      "Before capture",
    );
  });
  it("shares twenty creation slots across both regions rather than doubling the account quota", async () => {
    const env = environment(),
      cookie = await makerOf(env);
    const make = (region: "cn" | "overseas") => {
      const store = new RegionalProjectDO(sqliteState(), {
        PROJECT_REGION: region,
      });
      return {
        ...env,
        PROJECT_SYNC_TOKEN: `${region}-secret`,
        PROJECT_SYNC_PEER_URL: "https://overseas.test",
        PROJECT_SYNC_PEER_TOKEN: "overseas-secret",
        PROJECT_IDENTITY_URL:
          "https://identity.test/api/auth/regional/identities",
        PROJECT_IDENTITY_TOKEN: "identity-secret",
        PROJECTS: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              store.fetch(new Request(url, init)),
          }),
        },
      };
    };
    const a = make("overseas"),
      b = make("cn");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        const req = new Request(input, init);
        if (new URL(req.url).hostname === "identity.test") {
          const { userIds } = await req.json();
          return Response.json({
            identities: userIds.map((id: string) => ({
              id,
              status: "found",
              user: { id },
            })),
          });
        }
        return route(a, req);
      }),
    );
    for (let i = 0; i < 19; i++)
      expect(
        (await route(a, saveRequest(cookie, `Existing ${i}`))).status,
      ).toBe(201);
    for (let after = 0; after < 19; after++) {
      const { events } = await (
        await route(
          a,
          new Request(`${ORIGIN}/api/project-sync/events?after=${after}`, {
            headers: { Authorization: "Bearer overseas-secret" },
          }),
        )
      ).json();
      expect(
        (
          await route(
            b,
            new Request(`${ORIGIN}/api/project-sync/events`, {
              method: "POST",
              headers: { Authorization: "Bearer cn-secret" },
              body: JSON.stringify({ event: events[0] }),
            }),
          )
        ).status,
      ).toBe(200);
    }
    expect(
      (await route(b, saveRequest(cookie, "Twentieth in China"))).status,
    ).toBe(201);
    const granted = await (
      await route(
        a,
        new Request(`${ORIGIN}/api/project-sync/events?after=19`, {
          headers: { Authorization: "Bearer overseas-secret" },
        }),
      )
    ).json();
    expect(JSON.parse(granted.events[0].payload).kind).toBe("quota");
    expect(
      (await route(a, saveRequest(cookie, "Must refuse globally"))).status,
    ).toBe(409);
    expect(
      (await route(b, saveRequest(cookie, "Also refuse in China"))).status,
    ).toBe(409);
  });
  it("retries an interrupted delivery from the receiver's durable cursor without losing a save", async () => {
    const env = environment(),
      cookie = await makerOf(env);
    const make = (region: "cn" | "overseas") => {
      const store = new RegionalProjectDO(sqliteState(), {
        PROJECT_REGION: region,
      });
      return {
        ...env,
        PROJECT_SYNC_TOKEN: `${region}-secret`,
        PROJECT_SYNC_ADMIN_TOKEN: "scheduler-secret",
        PROJECT_SYNC_PEER_TOKEN:
          region === "cn" ? "overseas-secret" : "cn-secret",
        PROJECT_SYNC_PEER_URL:
          region === "cn" ? "https://overseas.test" : "https://cn.test",
        PROJECT_IDENTITY_URL:
          "https://identity.test/api/auth/regional/identities",
        PROJECT_IDENTITY_TOKEN: "identity-secret",
        PROJECTS: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              store.fetch(new Request(url, init)),
          }),
        },
      };
    };
    const a = make("overseas"),
      b = make("cn");
    const { project } = await (
      await route(a, saveRequest(cookie, "Retry safely"))
    ).json();
    let loseAck = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        const req = new Request(input, init),
          url = new URL(req.url);
        if (url.hostname === "identity.test") {
          const { userIds } = await req.json();
          return Response.json({
            identities: userIds.map((id: string) => ({
              id,
              status: "found",
              user: { id },
            })),
          });
        }
        const response = await route(b, req);
        if (req.method === "POST" && loseAck) {
          loseAck = false;
          throw new Error("Lost response after durable receive");
        }
        return response;
      }),
    );
    const tick = async () =>
      (
        await route(
          a,
          new Request(`${ORIGIN}/api/project-sync/run`, {
            method: "POST",
            headers: { Authorization: "Bearer scheduler-secret" },
          }),
        )
      ).json();
    expect((await tick()).status).toBe("retry");
    expect((await tick()).status).toBe("caught-up");
    const opened = await route(
      b,
      new Request(`${ORIGIN}/api/projects/${project.id}`, {
        headers: { Cookie: cookie },
      }),
    );
    expect((await opened.json()).project.name).toBe("Retry safely");
  });
  it("carries the regional save token through the editor Cloud Save client", async () => {
    const env = environment(),
      cookie = await makerOf(env);
    const store = new RegionalProjectDO(sqliteState(), {
      PROJECT_REGION: "overseas",
    });
    const regional = {
      ...env,
      PROJECTS: {
        getByName: () => ({
          fetch: (url: string, init?: RequestInit) =>
            store.fetch(new Request(url, init)),
        }),
      },
    };
    const fetchLike = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("Cookie", cookie);
      headers.set("Origin", ORIGIN);
      return route(
        regional,
        new Request(new URL(String(input), ORIGIN), { ...init, headers }),
      );
    }) as typeof fetch;
    const created = await saveCloudProject(
      parseProject(projectText("First")),
      null,
      fetchLike,
    );
    expect(created.status).toBe("saved");
    if (created.status !== "saved") throw new Error("save failed");
    const changed = await saveCloudProject(
      parseProject(projectText("Second")),
      created.project,
      fetchLike,
    );
    expect(changed.status).toBe("saved");
    const history = await (
      await route(
        regional,
        new Request(`${ORIGIN}/api/projects/${created.project.id}/versions`, {
          headers: { Cookie: cookie },
        }),
      )
    ).json();
    expect(history.saveToken).toBe(
      changed.status === "saved" ? changed.project.saveToken : "missing",
    );
    const restored = await route(
      regional,
      new Request(
        `${ORIGIN}/api/projects/${created.project.id}/versions/${history.versions[0].versionId}/restore`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: ORIGIN,
            "If-Match": history.saveToken,
          },
        },
      ),
    );
    expect(restored.status).toBe(200);
    expect((await restored.json()).project.name).toBe("First");
  });
  it("imports a verified owner's Project once and refuses an unknown owner without advancing", async () => {
    const env = environment();
    const cookie = await makerOf(env);
    const make = (region: "cn" | "overseas") => {
      const store = new RegionalProjectDO(sqliteState(), {
        PROJECT_REGION: region,
      });
      return {
        ...env,
        PROJECT_SYNC_TOKEN: "peer-secret",
        PROJECT_IDENTITY_URL:
          "https://identity.test/api/auth/regional/identities",
        PROJECT_IDENTITY_TOKEN: "identity-secret",
        PROJECTS: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              store.fetch(new Request(url, init)),
          }),
        },
      };
    };
    const source = make("overseas"),
      target = make("cn");
    const saved = await route(source, saveRequest(cookie, "Shared identity"));
    const { project } = await saved.json();
    const exported = await route(
      source,
      new Request(`${ORIGIN}/api/project-sync/events`, {
        headers: { Authorization: "Bearer peer-secret" },
      }),
    );
    const { events } = await exported.json();
    const ownerId = JSON.parse(events[0].payload).ownerUserId;
    const send = () =>
      route(
        target,
        new Request(`${ORIGIN}/api/project-sync/events`, {
          method: "POST",
          headers: {
            Authorization: "Bearer peer-secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ event: events[0] }),
        }),
      );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ identities: [{ id: ownerId, status: "missing" }] }),
      ),
    );
    expect((await send()).status).toBe(409);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          identities: [{ id: ownerId, status: "found", user: { id: ownerId } }],
        }),
      ),
    );
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const opened = await route(
      target,
      new Request(`${ORIGIN}/api/projects/${project.id}`, {
        headers: { Cookie: cookie },
      }),
    );
    expect(opened.status).toBe(200);
    expect((await opened.json()).project.name).toBe("Shared identity");
    const echoed = await route(
      target,
      new Request(`${ORIGIN}/api/project-sync/events`, {
        headers: { Authorization: "Bearer peer-secret" },
      }),
    );
    expect((await echoed.json()).events).toEqual([]);
  });
  it("preserves concurrent regional saves and lets deletion defeat a late update", async () => {
    const env = environment(),
      cookie = await makerOf(env);
    const make = (region: "cn" | "overseas") => {
      const store = new RegionalProjectDO(sqliteState(), {
        PROJECT_REGION: region,
      });
      return {
        ...env,
        PROJECT_SYNC_TOKEN: "peer-secret",
        PROJECT_IDENTITY_URL:
          "https://identity.test/api/auth/regional/identities",
        PROJECT_IDENTITY_TOKEN: "identity-secret",
        PROJECTS: {
          getByName: () => ({
            fetch: (url: string, init?: RequestInit) =>
              store.fetch(new Request(url, init)),
          }),
        },
      };
    };
    const a = make("overseas"),
      b = make("cn");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const { userIds } = JSON.parse(String(init?.body));
        return Response.json({
          identities: userIds.map((id: string) => ({
            id,
            status: "found",
            user: { id },
          })),
        });
      }),
    );
    const exchange = async (from: typeof a, to: typeof a, after: number) => {
      const response = await route(
        from,
        new Request(`${ORIGIN}/api/project-sync/events?after=${after}`, {
          headers: { Authorization: "Bearer peer-secret" },
        }),
      );
      const { events } = await response.json();
      const applied = await route(
        to,
        new Request(`${ORIGIN}/api/project-sync/events`, {
          method: "POST",
          headers: { Authorization: "Bearer peer-secret" },
          body: JSON.stringify({ event: events[0] }),
        }),
      );
      expect(applied.status).toBe(200);
    };
    const { project } = await (
      await route(a, saveRequest(cookie, "Base"))
    ).json();
    await exchange(a, b, 0);
    const update = (env: typeof a, name: string) =>
      route(
        env,
        new Request(`${ORIGIN}/api/projects/${project.id}`, {
          method: "PUT",
          headers: {
            Cookie: cookie,
            Origin: ORIGIN,
            "If-Match": project.saveToken,
          },
          body: JSON.stringify({ name, projectText: projectText(name) }),
        }),
      );
    expect((await update(a, "Overseas edit")).status).toBe(200);
    expect((await update(b, "Domestic edit")).status).toBe(200);
    await exchange(a, b, 1);
    await exchange(b, a, 0);
    for (const region of [a, b]) {
      const opened = await route(
        region,
        new Request(`${ORIGIN}/api/projects/${project.id}`, {
          headers: { Cookie: cookie },
        }),
      );
      expect(opened.status).toBe(409);
      const payload = await opened.json();
      expect(
        payload.conflicts.map((branch: { name: string }) => branch.name).sort(),
      ).toEqual(["Domestic edit", "Overseas edit"]);
    }
    const conflicted = await (
      await route(
        a,
        new Request(`${ORIGIN}/api/projects/${project.id}`, {
          headers: { Cookie: cookie },
        }),
      )
    ).json();
    const resolved = await route(
      a,
      new Request(`${ORIGIN}/api/projects/${project.id}`, {
        method: "PUT",
        headers: {
          Cookie: cookie,
          Origin: ORIGIN,
          "If-Match": conflicted.conflicts[0].head,
        },
        body: JSON.stringify({
          name: "Explicit merge",
          projectText: projectText("Explicit merge"),
          resolveHeads: conflicted.conflicts.map(
            (item: { head: string }) => item.head,
          ),
        }),
      }),
    );
    expect(resolved.status).toBe(200);
    await exchange(a, b, 2);
    expect(
      (
        await (
          await route(
            b,
            new Request(`${ORIGIN}/api/projects/${project.id}`, {
              headers: { Cookie: cookie },
            }),
          )
        ).json()
      ).project.name,
    ).toBe("Explicit merge");
    const removed = await route(
      b,
      new Request(`${ORIGIN}/api/projects/${project.id}`, {
        method: "DELETE",
        headers: { Cookie: cookie, Origin: ORIGIN },
      }),
    );
    expect(removed.status).toBe(200);
    await exchange(b, a, 1);
    expect(
      (
        await route(
          a,
          new Request(`${ORIGIN}/api/projects/${project.id}`, {
            headers: { Cookie: cookie },
          }),
        )
      ).status,
    ).toBe(404);
  });
  it("exports a durable save once and refuses browser credentials at the synchronization boundary", async () => {
    const env = environment();
    const state = sqliteState();
    const store = new RegionalProjectDO(state, { PROJECT_REGION: "overseas" });
    const regional = {
      ...env,
      PROJECT_SYNC_TOKEN: "peer-secret",
      PROJECTS: {
        getByName: () => ({
          fetch: (url: string, init?: RequestInit) =>
            store.fetch(new Request(url, init)),
        }),
      },
    };
    const cookie = await makerOf(env);
    const saved = await route(regional, saveRequest(cookie, "Queued offline"));
    expect(saved.status).toBe(201);
    const forbidden = await route(
      regional,
      new Request(`${ORIGIN}/api/project-sync/events`, {
        headers: { Cookie: cookie },
      }),
    );
    expect(forbidden.status).toBe(401);
    const exported = await route(
      regional,
      new Request(`${ORIGIN}/api/project-sync/events?after=0`, {
        headers: { Authorization: "Bearer peer-secret" },
      }),
    );
    expect(exported.status).toBe(200);
    const { events } = await exported.json();
    expect(events).toHaveLength(1);
    expect(events[0].sequence).toBe(1);
    expect(JSON.parse(events[0].payload).project.name).toBe("Queued offline");
  });
  it("keeps a unified account's saved Project across a process restart and refuses another account", async () => {
    const env = environment();
    const state = sqliteState();
    let store = new RegionalProjectDO(state, { PROJECT_REGION: "overseas" });
    const regional = {
      ...env,
      PROJECTS: {
        getByName: () => ({
          fetch: (url: string, init?: RequestInit) =>
            store.fetch(new Request(url, init)),
        }),
      },
    };
    const cookie = await makerOf(env);
    const created = await route(regional, saveRequest(cookie, "Domestic save"));
    expect(created.status).toBe(201);
    const { project } = await created.json();
    expect(project.saveToken).toMatch(/^head-/);
    store = new RegionalProjectDO(state, { PROJECT_REGION: "overseas" });
    const opened = await route(
      regional,
      new Request(`${ORIGIN}/api/projects/${project.id}`, {
        headers: { Cookie: cookie },
      }),
    );
    expect(opened.status).toBe(200);
    expect((await opened.json()).project.name).toBe("Domestic save");
    const other = await adminOf(env);
    expect(
      (
        await route(
          regional,
          new Request(`${ORIGIN}/api/projects/${project.id}`, {
            headers: { Cookie: other },
          }),
        )
      ).status,
    ).toBe(404);
  });
});
