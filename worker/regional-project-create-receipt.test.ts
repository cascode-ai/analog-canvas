import { afterEach, beforeEach, expect, it, vi } from "vitest";
import entry from "./regional-entry";
import operationFormat from "./project-create-operation-format.json";
import { RegionalProjectDO } from "./regional-projects";
import { GalleryDO } from "./gallery-do";
import { regionalRuntimeBindings } from "./regional-entry.test-support";
import {
  environment,
  adminOf,
  makerOf,
  ORIGIN,
  saveRequest,
  sqliteState,
} from "./gallery.test-support";

const loopback = "http://127.0.0.1:18082";
const controlPath = "/__regional/project-create-receipt";
const dispatchPath = "/__regional/project-create";
const ticket = Date.now().toString(16).padStart(12, "0") + "a".repeat(52);

async function fixture(admin = false) {
  const source = environment();
  const cookie = await (admin ? adminOf : makerOf)(source);
  const state = sqliteState();
  const restart = (capacity?: number) =>
    new GalleryDO(state, {
      PROJECT_REGION: "cn",
      ...(capacity ? { PROJECT_SYNC_MAX_BYTES: capacity } : {}),
    });
  let local = restart();
  const env = {
    ...source,
    AUTH: source.AUTH!,
    ...regionalRuntimeBindings(),
    PROJECTS: {
      getByName: () => ({
        fetch: (url: string, init?: RequestInit) =>
          local.fetch(new Request(url, init)),
      }),
    },
    PROJECT_REGION: "cn" as const,
    PROJECTS_STORE_NAME: "gallery" as const,
    PROJECT_WRITES_ENABLED: "true",
    REGIONAL_RATE_LIMITS: '{"API_RATE_LIMITER":{"limit":1,"period":60}}',
    PROJECT_SYNC_PEER_URL: "https://authority.test",
    PROJECT_SYNC_PEER_TOKEN: "peer-secret",
    PROJECT_IDENTITY_URL: "https://identity.test/api/auth/regional/identities",
    PROJECT_IDENTITY_TOKEN: "identity-secret",
    AUTH_REGIONAL_CLIENT: JSON.stringify({
      origin: "https://authority.test",
      clientOrigin: ORIGIN,
      secret: "regional-runtime-client-secret-0123456789",
    }),
  };
  return {
    retire: (userId: string) =>
      local.fetch(
        new Request("https://gallery/retire-account", {
          method: "POST",
          body: JSON.stringify({ userId }),
        }),
      ),
    capabilities: () =>
      entry.fetch(
        new Request(loopback + controlPath, {
          method: "POST",
          body: JSON.stringify({ action: "capabilities" }),
        }),
        env,
      ),
    tick: () =>
      entry.fetch(
        new Request(ORIGIN + "/api/project-sync/run", {
          method: "POST",
          headers: { authorization: "Bearer admin-test" },
        }),
        {
          ...env,
          PROJECT_SYNC_TOKEN: "token",
          PROJECT_SYNC_ADMIN_TOKEN: "admin-test",
        },
      ),
    control: (action: string, id = ticket, host = loopback, address?: string) =>
      entry.fetch(
        new Request(host + controlPath, {
          method: "POST",
          body: JSON.stringify({ action, ticket: id, address }),
        }),
        env,
      ),
    create: async (
      id = ticket,
      name = "Receipt test",
      headers: Record<string, string> = {},
      galleryEntryId?: string,
    ) => {
      const req = new Request(
        loopback + dispatchPath,
        saveRequest(cookie, name),
      );
      req.headers.set("Idempotency-Key", "stable-project-key");
      req.headers.set("x-icm-project-create-ticket", id);
      for (const [key, value] of Object.entries(headers))
        req.headers.set(key, value);
      return entry.fetch(
        galleryEntryId
          ? new Request(req, {
              body: JSON.stringify({
                ...(await req.clone().json()),
                galleryEntryId,
              }),
            })
          : req,
        env,
      );
    },
    restart: (capacity?: number) => {
      local = restart(capacity);
    },
    state,
  };
}

const shippedWriteVersion = operationFormat.write;
beforeEach(() => {
  operationFormat.write = 0;
});
afterEach(() => {
  operationFormat.write = shippedWriteVersion;
  vi.unstubAllGlobals();
});

it("accepts a keyed create with the shipped writer and retains it when the quota response is lost", async () => {
  operationFormat.write = shippedWriteVersion;
  const f = await fixture();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Lost quota response")),
  );
  await f.control("register");
  const reply = await f.create();
  expect(reply.status).toBe(503);
  expect(await reply.json()).toMatchObject({ error: "project-create-pending" });
  expect(await (await f.capabilities()).json()).toEqual({
    version: 2,
    operationVersions: [1],
    writeVersion: 1,
    pending: [{ operationVersion: 1, count: 1, blocked: 0 }],
  });
});

it("advertises the recoverable format before any writer is enabled", async () => {
  const f = await fixture();
  const caps = await f.capabilities();
  expect(caps.status).toBe(200);
  expect(await caps.json()).toEqual({
    version: 2,
    operationVersions: [1],
    writeVersion: operationFormat.write,
    pending: [],
  });
});

it("resumes a create after the existing journal gains room, without a browser retry", async () => {
  const f = await fixture(),
    peer = new RegionalProjectDO(sqliteState(), { PROJECT_REGION: "overseas" });
  operationFormat.write = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const req = new Request(input, init),
        url = new URL(req.url);
      if (url.pathname.endsWith("/status"))
        return peer.handle("sync-status", {});
      if (url.pathname.endsWith("/quota"))
        return peer.handle("sync-quota", await req.json());
      if (url.hostname === "identity.test") {
        const body = await req.json();
        return Response.json({
          identities: body.userIds.map((id: string) => ({
            id,
            status: "found",
            user: { id },
          })),
        });
      }
      return new Response(null, { status: 503 });
    }),
  );
  await f.control("register");
  expect(
    (
      await f.create(ticket, "Existing larger Project", {
        "idempotency-key": "first-created-project-with-a-longer-key",
      })
    ).status,
  ).toBe(201);
  const { bytes } = f.state.storage.sql
    .exec<{ bytes: number }>(
      "SELECT SUM(length(CAST(payload AS BLOB))) bytes FROM project_sync_payloads",
    )
    .one();
  f.restart(bytes + 1);
  await f.tick();
  const other = ticket.slice(0, -1) + "3";
  await f.control("register", other);
  const waiting = await f.create(other, "New");
  expect(await waiting.json()).toMatchObject({
    error: "project-create-pending",
  });
  expect((await f.control("handoff", other)).ok).toBe(true);
  f.restart();
  await f.tick();
  expect(await (await f.control("settle", other)).json()).toMatchObject({
    state: "committed",
  });
});

it("finishes a lost quota reply after restart without a browser and settles both exact attempts", async () => {
  const f = await fixture(),
    peer = new RegionalProjectDO(sqliteState(), { PROJECT_REGION: "overseas" });
  const retry = ticket.slice(0, -1) + "e";
  const previousFormat = operationFormat.write;
  operationFormat.write = 1;
  let lost = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const req = new Request(input, init);
      if (req.url.endsWith("/status")) return peer.handle("sync-status", {});
      if (!req.url.endsWith("/quota"))
        return new Response(null, { status: 503 });
      const granted = await peer.handle("sync-quota", await req.json());
      if (lost) throw new Error("after authority commit");
      return granted;
    }),
  );
  try {
    await f.control("register");
    const pending = await f.create();
    expect(await pending.json()).toMatchObject({
      error: "project-create-pending",
    });
    expect(pending.status).toBe(503);
    expect(pending.headers.get("retry-after")).toBeTruthy();
    await f.control("register", retry);
    expect(await (await f.create(retry)).json()).toMatchObject({
      error: "project-create-pending",
    });
    const proof = await (await f.control("handoff")).json();
    const conflict = ticket.slice(0, -1) + "4";
    await f.control("register", conflict);
    expect(
      await (await f.create(conflict, "Changed original")).json(),
    ).toMatchObject({ error: "create-key-reused" });
    expect(await (await f.control("settle", conflict)).json()).toMatchObject({
      state: "denied",
    });
    expect(proof).toMatchObject({
      version: 2,
      ticket,
      state: "handed-off",
      operationVersion: 1,
      operation: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await (await f.capabilities()).json()).toMatchObject({
      pending: [{ operationVersion: 1, count: 1, blocked: 0 }],
    });
    f.restart();
    lost = false;
    operationFormat.write = 0;
    const tick = await f.tick();
    expect(tick.status, await tick.clone().text()).toBe(200);
    for (const attempt of [ticket, retry])
      expect(
        await (await f.control("settle", attempt)).json(),
        JSON.stringify(
          f.state.storage.sql
            .exec(
              "SELECT reason,blocked,generation FROM project_create_operations",
            )
            .toArray(),
        ),
      ).toMatchObject({ ticket: attempt, state: "committed" });
    expect(await (await f.capabilities()).json()).toMatchObject({
      pending: [],
    });
    expect(
      f.state.storage.sql.exec("SELECT name FROM cloud_projects").toArray(),
    ).toEqual([{ name: "Receipt test" }]);
    expect(
      f.state.storage.sql
        .exec(
          "SELECT admission,handed,outcome,finished_by FROM project_create_audit ORDER BY admission",
        )
        .toArray(),
    ).toEqual([
      {
        admission: "accepted",
        handed: 1,
        outcome: "committed",
        finished_by: "timer",
      },
      {
        admission: "joined",
        handed: 0,
        outcome: "committed",
        finished_by: "timer",
      },
    ]);
    expect(
      f.state.storage.sql
        .exec("SELECT count(*) n FROM project_create_inputs")
        .one(),
    ).toEqual({ n: 0 });
  } finally {
    operationFormat.write = previousFormat;
  }
});

it("limits pending creates per account, expires private input and transfers only its proved scope", async () => {
  const f = await fixture();
  operationFormat.write = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  for (let i = 0; i <= 20; i++) {
    const t = ticket.slice(0, 60) + i.toString(16).padStart(4, "0");
    await f.control("register", t);
    const result = await f.create(t, "Waiting", {
      "idempotency-key": "waiting-" + i,
    });
    expect(result.status).toBe(i === 20 ? 429 : 503);
  }
  const first = ticket.slice(0, 60) + "0000";
  f.restart();
  const late = vi
    .spyOn(Date, "now")
    .mockReturnValue(Date.now() + 8 * 86_400_000);
  try {
    await f.tick();
    expect(
      f.state.storage.sql
        .exec("SELECT COUNT(*) n FROM project_create_inputs")
        .one(),
    ).toEqual({ n: 20 });
    const peer = new RegionalProjectDO(sqliteState(), {
      PROJECT_REGION: "overseas",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) =>
        String(input).endsWith("/status")
          ? peer.handle("sync-status", {})
          : new Response(null, { status: 503 }),
      ),
    );
    await f.tick();
    expect(
      f.state.storage.sql
        .exec("SELECT COUNT(*) n FROM project_create_inputs")
        .one(),
    ).toEqual({ n: 0 });
    expect(await (await f.control("handoff", first)).json()).toMatchObject({
      version: 2,
      state: "handed-off",
      ticket: first,
    });
    expect((await (await f.capabilities()).json()).pending).toEqual([
      { operationVersion: 1, count: 20, blocked: 20 },
    ]);
  } finally {
    late.mockRestore();
  }
});

it("fences a late first executor and permits another project while its quota reply is in flight", async () => {
  const f = await fixture(),
    pstate = sqliteState(),
    peer = new RegionalProjectDO(pstate, { PROJECT_REGION: "overseas" });
  const second = ticket.slice(0, -1) + "8",
    previous = operationFormat.write;
  operationFormat.write = 1;
  let seen!: () => void, release!: () => void;
  const firstGranted = new Promise<void>((r) => {
      seen = r;
    }),
    late = new Promise<void>((r) => {
      release = r;
    });
  let first = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const req = new Request(input, init),
        url = new URL(req.url);
      if (url.pathname.endsWith("/status"))
        return peer.handle("sync-status", {});
      const body = await req.json();
      if (url.hostname === "identity.test")
        return Response.json({
          identities: body.userIds.map((id: string) => ({
            id,
            status: "found",
            user: { id },
          })),
        });
      if (url.pathname.endsWith("/pull")) return peer.handle("sync-pull", body);
      if (url.pathname.endsWith("/quota")) {
        const grant = await peer.handle("sync-quota", body);
        if (first) {
          first = false;
          seen();
          await late;
        }
        return grant;
      }
      return new Response(null, { status: 503 });
    }),
  );
  try {
    await f.control("register");
    const old = f.create();
    await firstGranted;
    expect((await f.control("handoff")).ok).toBe(true);
    await f.control("register", second);
    expect(
      (
        await f.create(second, "Independent", {
          "idempotency-key": "other-key",
        })
      ).status,
    ).toBe(201);
    await f.tick();
    release();
    expect(await (await old).json()).toMatchObject({
      error: "create-executor-fenced",
    });
    expect(await (await f.control("settle")).json()).toMatchObject({
      state: "committed",
    });
    expect(
      f.state.storage.sql.exec("SELECT COUNT(*) n FROM cloud_projects").one(),
    ).toEqual({ n: 2 });
    expect(
      pstate.storage.sql
        .exec("SELECT COUNT(*) n FROM project_quota_reservations")
        .one(),
    ).toEqual({ n: 2 });
  } finally {
    release();
    operationFormat.write = previous;
  }
});

it("applies the preceding verified event before the returned quota grant within a bounded foreground catch-up", async () => {
  const f = await fixture(),
    peer = new RegionalProjectDO(sqliteState(), { PROJECT_REGION: "overseas" });
  await peer.handle("sync-quota", {
    id: "another-project",
    ownerUserId: "previous-owner",
  });
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const req = new Request(input, init),
        url = new URL(req.url);
      requests.push(url.pathname);
      const payload = await req.json();
      if (url.hostname === "identity.test")
        return Response.json({
          identities: payload.userIds.map((id: string) => ({
            id,
            status: "found",
            user: { id },
          })),
        });
      if (url.pathname === "/api/project-sync/quota")
        return peer.handle("sync-quota", payload);
      if (url.pathname === "/api/project-sync/pull")
        return peer.handle("sync-pull", payload);
      throw new Error("unexpected peer request");
    }),
  );
  const previous = operationFormat.write;
  operationFormat.write = 1;
  try {
    await f.control("register");
    const created = await f.create();
    expect(created.status, await created.clone().text()).toBe(201);
    expect(
      requests.filter((path) => path === "/api/project-sync/pull"),
    ).toHaveLength(1);
    expect(await (await f.control("settle")).json()).toMatchObject({
      state: "committed",
    });
    expect(
      f.state.storage.sql
        .exec("SELECT sequence FROM project_sync_receipts ORDER BY sequence")
        .toArray(),
    ).toEqual([{ sequence: 1 }, { sequence: 2 }]);
  } finally {
    operationFormat.write = previous;
  }
});

it("rejects an invalid authority grant without starting catch-up and erases private pending input on account retirement", async () => {
  const f = await fixture();
  operationFormat.write = 1;
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const req = new Request(input, init),
        body = await req.json();
      calls.push(new URL(req.url).pathname);
      return Response.json({
        ...body,
        reservation: "bad",
        event: { version: 1, payloadHash: "different" },
      });
    }),
  );
  await f.control("register");
  const result = await f.create();
  expect(await result.json()).toMatchObject({ error: "invalid-quota-grant" });
  expect(calls).toEqual(["/api/project-sync/quota"]);
  expect((await f.control("handoff")).status).toBe(409);
  const { owner_id } = f.state.storage.sql
    .exec<{ owner_id: string }>(
      "SELECT owner_id FROM project_create_operations",
    )
    .one();
  expect((await f.retire(owner_id)).ok).toBe(true);
  expect(
    f.state.storage.sql
      .exec("SELECT COUNT(*) n FROM project_create_inputs")
      .one(),
  ).toEqual({ n: 0 });
  expect(await (await f.control("settle")).json()).toMatchObject({
    state: "denied",
  });
  expect((await f.create()).status).toBe(403);
});

it("rechecks the current moderator grant before linking another owner's Gallery circuit", async () => {
  const f = await fixture(true),
    peer = new RegionalProjectDO(sqliteState(), { PROJECT_REGION: "overseas" });
  operationFormat.write = 1;
  f.state.storage.sql.exec(
    "INSERT INTO gallery_entries(id,name,author,description,created_at,schema_version,status,owner_user_id,project_text,svg_text) VALUES('linked','Circuit','Maker','','2026-01-01',1,'public','other-owner','{}','')",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const req = new Request(input, init),
        body = await req.json();
      if (req.url.endsWith("/quota")) return peer.handle("sync-quota", body);
      return Response.json({
        identities: body.userIds.map((id: string) => ({
          id,
          status: "found",
          user: { id, isAdmin: false, role: "member" },
        })),
      });
    }),
  );
  await f.control("register");
  const result = await f.create(ticket, "Linked", {}, "linked");
  expect(await result.json()).toMatchObject({
    error: "gallery-link-forbidden",
  });
  expect(
    f.state.storage.sql.exec("SELECT COUNT(*) n FROM cloud_projects").one(),
  ).toEqual({ n: 0 });
  expect(
    f.state.storage.sql
      .exec<{ chunk: string }>("SELECT chunk FROM project_create_inputs")
      .one().chunk,
  ).not.toContain("mayEditGallery");
  const later = vi
    .spyOn(Date, "now")
    .mockReturnValue(Date.now() + 8 * 86_400_000);
  try {
    await f.tick();
    expect((await f.control("handoff")).ok).toBe(true);
    expect(
      f.state.storage.sql
        .exec("SELECT COUNT(*) n FROM project_create_inputs")
        .one(),
    ).toEqual({ n: 0 });
  } finally {
    later.mockRestore();
  }
});

it("only the loopback receipt protocol can cancel an unclaimed create; a delayed create cannot reserve quota", async () => {
  const f = await fixture();
  vi.stubGlobal("fetch", vi.fn());
  expect((await f.control("register", ticket, ORIGIN)).status).toBe(404);
  expect(await (await f.control("settle")).json()).toEqual({
    version: 1,
    ticket,
    state: "unknown",
  });
  expect(await (await f.control("register")).json()).toEqual({
    version: 1,
    ticket,
    state: "registered",
  });
  expect(await (await f.control("settle")).json()).toMatchObject({
    state: "denied",
  });
  f.restart();
  expect(await (await f.control("register")).json()).toMatchObject({
    state: "denied",
  });
  expect((await f.create()).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
});

it("refuses a request that the previous public entrance forwards with a loopback Host", async () => {
  const f = await fixture();
  await f.control("register");
  vi.stubGlobal("fetch", vi.fn());
  const attempt = await f.create(ticket, "Receipt test", {
    "x-real-ip": "192.0.2.55",
    "x-icm-project-client-address": "192.0.2.10",
  });
  expect(attempt.status).toBe(404);
  expect(await (await f.control("settle")).json()).toMatchObject({
    state: "denied",
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("settles concurrent creates with the same owner and key but different drawings", async () => {
  const f = await fixture();
  const other = ticket.slice(0, -1) + "9";
  const peer = new RegionalProjectDO(sqliteState(), {
    PROJECT_REGION: "overseas",
  });
  let reachedFirst!: () => void,
    reachedSecond!: () => void,
    finishSecond!: () => void;
  const firstQuota = new Promise<void>((r) => {
    reachedFirst = r;
  });
  const secondQuota = new Promise<void>((r) => {
    reachedSecond = r;
  });
  const allowSecond = new Promise<void>((r) => {
    finishSecond = r;
  });
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const order = ++calls;
      const grant = await peer.handle(
        "sync-quota",
        await new Request(input, init).json(),
      );
      if (order === 1) {
        reachedFirst();
        await secondQuota;
      } else {
        reachedSecond();
        await allowSecond;
      }
      return grant;
    }),
  );
  await f.control("register");
  await f.control("register", other);
  const first = f.create();
  await firstQuota;
  const second = f.create(other, "Another drawing");
  expect((await first).status).toBe(201);
  finishSecond();
  const refused = await second;
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: "create-key-reused" });
  f.restart();
  expect(await (await f.control("settle")).json()).toMatchObject({
    state: "committed",
  });
  expect(await (await f.control("settle", other)).json()).toMatchObject({
    state: "denied",
  });
});

it("limits new registrations before storage and keeps existing attempts recoverable at capacity", async () => {
  const f = await fixture();
  const register = () => f.control("register", ticket, loopback, "192.0.2.111");
  expect((await register()).ok).toBe(true);
  expect((await register()).status).toBe(429);
  // Existing terminal receipts within retention occupy the bounded table.
  f.state.storage.sql.exec(
    "WITH RECURSIVE rows(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM rows WHERE n<99999) INSERT INTO project_create_receipts(ticket_hash,state,issued_at) SELECT printf('%064d',n),'committed',? FROM rows",
    Date.now(),
  );
  expect((await f.control("register", ticket.slice(0, -1) + "f")).status).toBe(
    503,
  );
  expect(await (await f.control("settle")).json()).toMatchObject({
    state: "denied",
  });
});

it("only a committed authorized create, including an idempotent retry, proves the outcome across a restart", async () => {
  const f = await fixture();
  const peer = new RegionalProjectDO(sqliteState(), {
    PROJECT_REGION: "overseas",
  });
  let grantQuota!: () => void;
  const paused = new Promise<void>((r) => {
    grantQuota = r;
  });
  let sawQuota!: () => void;
  const reachedQuota = new Promise<void>((r) => {
    sawQuota = r;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const granted = await peer.handle(
        "sync-quota",
        await new Request(input, init).json(),
      );
      sawQuota();
      await paused;
      return granted;
    }),
  );
  await f.control("register");
  const first = f.create();
  await reachedQuota;
  expect(await (await f.control("settle")).json()).toMatchObject({
    state: "claimed",
  });
  grantQuota();
  const saved = await first;
  expect(saved.status, await saved.clone().text()).toBe(201);
  expect(saved.headers.get("x-icm-project-create-protocol")).toBe("1");
  f.restart();
  expect(await (await f.control("settle")).json()).toMatchObject({
    state: "committed",
  });
  const sameKeyNewTicket = ticket.slice(0, -1) + "b";
  await f.control("register", sameKeyNewTicket);
  expect((await f.create(sameKeyNewTicket)).status).toBe(200);
  expect(
    await (await f.control("settle", sameKeyNewTicket)).json(),
  ).toMatchObject({ state: "committed" });
  const conflict = ticket.slice(0, -1) + "d";
  await f.control("register", conflict);
  const refused = await f.create(conflict, "Different drawing");
  expect(await refused.json()).toMatchObject({ error: "create-key-reused" });
  expect(await (await f.control("settle", conflict)).json()).toMatchObject({
    state: "denied",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("refuses an expired registration without reviving an old settled ticket", async () => {
  const f = await fixture();
  await f.control("register");
  const orphan = ticket.slice(0, -1) + "3";
  await f.control("register", orphan);
  await f.control("settle");
  const real = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(real + 11 * 60_000);
  try {
    expect(await (await f.control("register")).json()).toMatchObject({
      state: "unknown",
    });
    expect((await f.create()).status).toBe(409);
    expect(await (await f.control("settle", orphan)).json()).toMatchObject({
      state: "unknown",
    });
    expect((await f.create(orphan)).status).toBe(409);
  } finally {
    clock.mockRestore();
  }
});

it("separates a definite quota refusal from a lost quota response on another ticket", async () => {
  const f = await fixture();
  const other = ticket.slice(0, -1) + "c";
  await f.control("register");
  await f.control("register", other);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: "project-limit", projects: [] },
          { status: 409 },
        ),
      )
      .mockRejectedValueOnce(new Error("lost quota response")),
  );
  expect((await f.create()).status).toBe(409);
  expect((await f.create(other)).status).toBe(503);
  f.restart();
  expect(await (await f.control("settle")).json()).toMatchObject({
    state: "denied",
  });
  expect(await (await f.control("settle", other)).json()).toMatchObject({
    state: "claimed",
  });
});
