import { afterEach, expect, it, vi } from "vitest";
import entry from "./regional-entry";
import { RegionalProjectDO } from "./regional-projects";
import { GalleryDO } from "./gallery-do";
import { regionalRuntimeBindings } from "./regional-entry.test-support";
import {
  environment,
  makerOf,
  ORIGIN,
  saveRequest,
  sqliteState,
} from "./gallery.test-support";

const loopback = "http://127.0.0.1:18082";
const controlPath = "/__regional/project-create-receipt";
const dispatchPath = "/__regional/project-create";
const ticket = Date.now().toString(16).padStart(12, "0") + "a".repeat(52);

async function fixture() {
  const source = environment();
  const cookie = await makerOf(source);
  const state = sqliteState();
  const restart = () => new GalleryDO(state, { PROJECT_REGION: "cn" });
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
    AUTH_REGIONAL_CLIENT: JSON.stringify({
      origin: "https://authority.test",
      clientOrigin: ORIGIN,
      secret: "regional-runtime-client-secret-0123456789",
    }),
  };
  return {
    control: (action: string, id = ticket, host = loopback, address?: string) =>
      entry.fetch(
        new Request(host + controlPath, {
          method: "POST",
          body: JSON.stringify({ action, ticket: id, address }),
        }),
        env,
      ),
    create: (
      id = ticket,
      name = "Receipt test",
      headers: Record<string, string> = {},
    ) => {
      const req = new Request(
        loopback + dispatchPath,
        saveRequest(cookie, name),
      );
      req.headers.set("Idempotency-Key", "stable-project-key");
      req.headers.set("x-icm-project-create-ticket", id);
      for (const [key, value] of Object.entries(headers))
        req.headers.set(key, value);
      return entry.fetch(req, env);
    },
    restart: () => {
      local = restart();
    },
    state,
  };
}

afterEach(() => vi.unstubAllGlobals());

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
