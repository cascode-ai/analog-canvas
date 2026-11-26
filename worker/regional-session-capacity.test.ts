import { expect, it } from "vitest";
import {
  adminOf,
  makerOf,
  ownerAccountOf,
  ORIGIN,
  saveRequest,
  submitOne,
  wiredProjectText,
} from "./gallery.test-support";
import canvas from "./index";
import { regionalRuntimeBindings } from "./regional-entry.test-support";
import { accounts, config } from "./regional-auth.test-support";
import { RegionalSessionDO } from "./regional-session";
import { REGIONAL_LEASE_MS } from "./regional-auth-contract";

it("parks an idle login and shares one authority check when two tabs return", async () => {
  const h = accounts();
  const cookie = await h.connect(await makerOf(h.source));
  let renewals = 0;
  const transport = h.region.fetchLike;
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  h.region.fetchLike = async (input, init) => {
    if (String(input).endsWith("/renew")) {
      renewals++;
      started.resolve();
      if (waking) await release.promise;
    }
    return transport(input, init);
  };
  let waking = false;
  h.advance(300_001);
  await h.region.alarm();
  expect(renewals).toBe(0);
  waking = true;
  const returning = Promise.all([
    h.call("/api/auth/me", cookie),
    h.call("/api/auth/me", cookie),
  ]);
  await started.promise;
  release.resolve();
  for (const response of await returning)
    expect((await response.json()).authorization).toBe("active");
  expect(renewals).toBe(1);
});

it("keeps an idle login across an outage and commits only an explicit retry of a Cloud Project save", async () => {
  const h = accounts();
  const env = { ...h.resources, ...regionalRuntimeBindings() };
  const cookie = await h.connect(await makerOf(h.source));
  const transport = h.region.fetchLike;
  h.region.fetchLike = async () => {
    throw new Error("authority offline");
  };
  expect(
    (await canvas.fetch(saveRequest(cookie, "Active save"), env)).status,
  ).toBe(201);
  h.advance(300_001);
  const attempt = () =>
    canvas.fetch(saveRequest(cookie, "Returning save"), env);
  const blocked = await attempt();
  expect(blocked.status).toBe(503);
  expect(blocked.headers.has("set-cookie")).toBe(false);
  h.region.fetchLike = transport;
  expect((await attempt()).status).toBe(201);
  const list = await canvas.fetch(
    new Request(ORIGIN + "/api/projects", { headers: { cookie } }),
    env,
  );
  expect(
    (await list.json()).projects.map((p: { name: string }) => p.name).sort(),
  ).toEqual(["Active save", "Returning save"]);
});

it("rejects a Gallery withdrawal immediately after authority logout despite a live local lease", async () => {
  const h = accounts();
  const source = await makerOf(h.source);
  const cookie = await h.connect(source);
  const id = await submitOne(h.source, "Withdrawal fixture", {
    cookie: source,
    text: wiredProjectText("Withdrawal fixture"),
  });
  const inFlight = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const transport = h.region.fetchLike;
  let first = true;
  h.region.fetchLike = async (input, init) => {
    const response = await transport(input, init);
    if (String(input).endsWith("/renew") && first) {
      first = false;
      inFlight.resolve();
      await release.promise;
    }
    return response;
  };
  h.advance(30_000);
  const alarm = h.region.alarm();
  await inFlight.promise;
  await h.source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/logout", {
      method: "POST",
      headers: { origin: ORIGIN, cookie: source },
    }),
  );
  const withdrawal = canvas.fetch(
    new Request(ORIGIN + "/api/gallery/" + id + "/recycle", {
      method: "POST",
      headers: { origin: ORIGIN, cookie },
    }),
    { ...h.resources, ...regionalRuntimeBindings() },
  );
  await h.call("/api/auth/me", cookie);
  release.resolve();
  await alarm;
  expect((await withdrawal).status).toBe(401);
  expect(await (await h.call("/api/auth/me", cookie)).json()).toMatchObject({
    user: null,
    authorization: "anonymous",
  });
});

it("a returning save cannot use an alarm response from before the idle boundary", async () => {
  const h = accounts();
  const source = await makerOf(h.source);
  const cookie = await h.connect(source);
  const env = { ...h.resources, ...regionalRuntimeBindings() };
  const transport = h.region.fetchLike;
  const answered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let checks = 0;
  h.region.fetchLike = async (input, init) => {
    const reply = await transport(input, init);
    if (String(input).endsWith("/renew") && ++checks === 1) {
      answered.resolve();
      await release.promise;
    }
    return reply;
  };
  h.advance(299_000);
  const alarm = h.region.alarm();
  await answered.promise;
  await h.source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/logout", {
      method: "POST",
      headers: { cookie: source, origin: ORIGIN },
    }),
  );
  h.advance(1001);
  const lookup = Promise.withResolvers<void>();
  const clock = h.region.now;
  h.region.now = () => {
    lookup.resolve();
    return clock();
  };
  const save = canvas.fetch(saveRequest(cookie, "Revoked save"), env);
  await lookup.promise;
  release.resolve();
  await alarm;
  expect((await save).status).toBe(401);
  expect(checks).toBe(2);
});

it("applies an authority role change before reading the Gallery moderation bin", async () => {
  const h = accounts();
  const cookie = await h.connect(await adminOf(h.source));
  const env = { ...h.resources, ...regionalRuntimeBindings() };
  const bin = () =>
    canvas.fetch(
      new Request(ORIGIN + "/api/gallery/recycled", { headers: { cookie } }),
      env,
    );
  expect((await bin()).status).toBe(200);
  h.source.authSql.exec(
    "UPDATE users SET email=? WHERE email=?",
    "former@example.com",
    "owner@example.com",
  );
  expect((await bin()).status).toBe(401);
  expect(
    (await (await h.call("/api/auth/me", cookie)).json()).user.isAdmin,
  ).toBe(false);
});

it("does not keep a regional Owner active through simulation progress polling", async () => {
  const h = accounts();
  const cookie = await h.connect(await ownerAccountOf(h.source));
  const env = { ...h.resources, ...regionalRuntimeBindings() };
  const poll = (polling: boolean) =>
    canvas.fetch(
      new Request(
        ORIGIN + "/api/gallery/simulation-checks" + (polling ? "?poll=1" : ""),
        { headers: { cookie } },
      ),
      env,
    );
  for (let minute = 0; minute < 4; minute++) {
    h.advance(60_000);
    expect((await poll(true)).status).toBe(200);
  }
  h.advance(60_001);
  expect((await poll(true)).status).toBe(401);
  expect((await poll(false)).status).toBe(200);
});

it("renews 1000 sessions across restart with two-second transport and processing overhead", async () => {
  const h = accounts();
  const source = await makerOf(h.source);
  let nextAlarm = 0;
  h.state.storage.setAlarm = async (at) => {
    nextAlarm = at;
  };
  const cookies: string[] = [];
  for (let offset = 0; offset < 1000; offset += 100)
    cookies.push(
      ...(await Promise.all(
        Array.from({ length: 100 }, () => h.connect(source)),
      )),
    );
  const began = h.region.now();
  let region = h.region;
  let restarted = false;
  const sourceTransport = h.region.fetchLike;
  let transportReleased = Promise.resolve();
  const transport: typeof fetch = async (input, init) => {
    const released = transportReleased;
    const response = await sourceTransport(input, init);
    if (String(input).endsWith("/renew")) await released;
    return response;
  };
  region.fetchLike = transport;
  const states = async () =>
    Promise.all(
      cookies.map(
        async (cookie) =>
          (
            await (
              await region.fetch(
                new Request(ORIGIN + "/api/auth/me", { headers: { cookie } }),
              )
            ).json()
          ).authorization,
      ),
    );
  // The runtime invokes its next persisted alarm only after this alarm ends.
  // Model two seconds of transport plus 200ms of processing. A batch ends
  // before the runtime can deliver its next persisted alarm.
  while (h.region.now() - began < 120_000) {
    h.advance(Math.max(0, nextAlarm - h.region.now()));
    expect(new Set(await states())).toEqual(new Set(["active"]));
    const release = Promise.withResolvers<void>();
    transportReleased = release.promise;
    const pending = region.alarm();
    h.advance(2200);
    // Check while replies are still in flight: checking only after renewal
    // can miss a transient expiry that a real browser observes mid-batch.
    const duringRenewal = new Set(await states());
    release.resolve();
    await pending;
    expect(duringRenewal).toEqual(new Set(["active"]));
    expect(new Set(await states())).toEqual(new Set(["active"]));
    if (!restarted && h.region.now() - began >= 90_000) {
      region = new RegionalSessionDO(h.state, { AUTH_REGIONAL_CLIENT: config });
      region.now = h.region.now;
      region.fetchLike = transport;
      restarted = true;
    }
  }
  expect(restarted).toBe(true);
  region.fetchLike = async () => {
    throw new Error("isolated outage");
  };
  h.advance(REGIONAL_LEASE_MS + 1);
  await region.alarm();
  expect(new Set(await states())).toEqual(new Set(["expired"]));
}, 60_000);
